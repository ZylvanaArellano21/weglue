// Delivers queued push notifications through the Expo Push API and
// reconciles delivery receipts.
//
// Invoked every minute by pg_cron (invoke_push_dispatch → pg_net), and only
// when work exists. Auth: the caller must present the PUSH_DISPATCH_SECRET
// bearer (stored in Vault for the cron job and in function secrets here) —
// this endpoint is never called by clients.
//
// One run:
//   1. Claims up to three batches of pending push_queue rows (claim_push_batch —
//      FOR UPDATE SKIP LOCKED, so concurrent runs never double-send).
//   2. Loads each recipient's ACTIVE device tokens; a user with none is
//      'skipped' (they may re-register later; the in-app row still exists).
//   3. Sends in chunks of ≤100 (the Expo API limit). Per-ticket
//      DeviceNotRegistered marks that token invalid immediately.
//   4. Stores ticket ids (push_tickets) and, on later runs, checks receipts
//      for tickets older than 15 minutes — the authoritative APNs/FCM
//      outcome — invalidating dead tokens (the token-cleanup loop).
//   5. Failures retry with backoff (scheduled_for) up to 3 attempts.
//
// The iOS app-icon badge is sent with each push as the recipient's total
// unread (inbox + threads) so the icon number matches the in-app state.
//
// Env (Supabase function secrets):
//   PUSH_DISPATCH_SECRET — shared bearer secret with the cron job (required)
//   EXPO_ACCESS_TOKEN    — optional; only if Expo enhanced push security is on

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const BATCH_SIZE = 100;
const MAX_ROWS_PER_CLAIM = 200;
const MAX_ROWS_PER_INVOCATION = 600;
// PostgREST encodes .in() filters in the URL. Keep UUID lists well below
// common gateway URL limits, including when one claim contains 200 users.
const ID_FILTER_SIZE = 40;
// A fanout statement can enqueue 500 notifications but now wakes this worker
// once. Drain up to three existing claim batches, then request another
// asynchronous dispatch when the third batch is full.
const MAX_CLAIM_BATCHES = 3;
const MAX_ATTEMPTS = 3;
// Bound concurrent per-recipient RPCs so one 200-row claim cannot open
// hundreds of simultaneous gateway requests.
const RPC_CONCURRENCY = 20;
// supabase-js reports a request that never received an HTTP response as
// status 0. Queue/ticket writes are idempotent, so retry those once.
const TRANSPORT_RETRY_DELAY_MS = 250;

type PushRow = {
  id: string;
  user_id: string;
  notification_id: string | null;
  category: string;
  title: string | null;
  body: string | null;
  route: Record<string, unknown>;
  attempts: number;
  source_message_id: string | null;
};

type TokenRow = {
  id: string;
  user_id: string;
  token: string;
  platform: "ios" | "android";
};

async function updateByIds(
  admin: SupabaseClient,
  table: "push_queue" | "push_tokens" | "push_tickets",
  column: "id" | "ticket_id",
  ids: string[],
  values: Record<string, unknown>,
  stage: string,
) {
  for (let i = 0; i < ids.length; i += ID_FILTER_SIZE) {
    const { error } = await withTransportRetry(() =>
      admin.from(table).update(values).in(column, ids.slice(i, i + ID_FILTER_SIZE))
    );
    if (error) {
      console.error(`${stage} update failed`, error.code ?? "database error");
      throw new Error(`${stage} update failed`);
    }
  }
}

async function withTransportRetry<T extends { error: unknown; status: number }>(
  request: () => PromiseLike<T>,
): Promise<T> {
  const first = await request();
  if (!first.error || first.status !== 0) return first;
  console.warn("push write transport retry");
  await new Promise((resolve) => setTimeout(resolve, TRANSPORT_RETRY_DELAY_MS));
  return await request();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function pushTitle(row: PushRow): string {
  const clubName = row.route && typeof row.route.clubName === "string"
    ? row.route.clubName.trim()
    : "";
  return clubName || row.title?.trim() || "We Glue";
}

// Android channel per category — must match lib/notifications/channels.ts.
const CATEGORY_CHANNEL: Record<string, string> = {
  messages: "messages",
  events: "events",
  clubs: "clubs",
  social: "clubs",
  social_proof: "clubs",
  account: "account",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("PUSH_DISPATCH_SECRET");
  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!secret || !bearer || bearer !== secret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const invocationId = crypto.randomUUID();
  const sent = { claimed: 0, sent: 0, skipped: 0, failed: 0 };
  let remainingClaimBudget = MAX_ROWS_PER_INVOCATION;
  let totalClaimedThisInvocation = 0;
  let reachedClaimLimit = false;
  for (let batchNumber = 0; batchNumber < MAX_CLAIM_BATCHES; batchNumber++) {
    if (remainingClaimBudget <= 0) break;
    const requestedClaimSize = Math.min(MAX_ROWS_PER_CLAIM, remainingClaimBudget);
    const { data, error } = await admin.rpc("claim_push_batch", { p_limit: requestedClaimSize });
    if (error) {
      console.error("push claim failed", { invocationId, claimSequence: batchNumber + 1, code: error.code ?? "database error" });
      return json({ ok: false, error: "push claim failed" }, 500);
    }
    const actualClaimed = Array.isArray(data) ? data.length : -1;
    if (actualClaimed < 0 || actualClaimed > requestedClaimSize ||
        totalClaimedThisInvocation + actualClaimed > MAX_ROWS_PER_INVOCATION) {
      console.error("push claim invariant violation", {
        invocationId, claimSequence: batchNumber + 1, requestedClaimSize,
        actualClaimed, totalClaimedThisInvocation, remainingClaimBudget,
      });
      return json({ ok: false, error: "push claim invariant violation" }, 500);
    }
    totalClaimedThisInvocation += actualClaimed;
    remainingClaimBudget -= actualClaimed;
    console.info("push claim", {
      invocationId, claimSequence: batchNumber + 1, requestedClaimSize,
      actualClaimed, totalClaimedThisInvocation, remainingClaimBudget,
    });
    sent.claimed = totalClaimedThisInvocation;
    if (actualClaimed === 0) break;

    const batch = await deliverPending(admin, data as PushRow[]);
    sent.sent += batch.sent;
    sent.skipped += batch.skipped;
    sent.failed += batch.failed;
    if (batchNumber === MAX_CLAIM_BATCHES - 1 && actualClaimed === requestedClaimSize) {
      reachedClaimLimit = true;
    }
    if (actualClaimed < requestedClaimSize) break;
  }
  if (reachedClaimLimit) {
    // The RPC only queues pg_net work if due rows remain. Await that database
    // operation, not the next Edge invocation; cron recovers a failed wakeup.
    try {
      const { error } = await admin.rpc("invoke_push_dispatch");
      if (error) console.error("push continuation dispatch request failed");
      console.info("push continuation", { invocationId, requested: error === null });
    } catch {
      console.error("push continuation dispatch request failed");
      console.info("push continuation", { invocationId, requested: false });
    }
  }
  const receipts = await reconcileReceipts(admin);

  return json({ ok: true, ...sent, ...receipts });
});

async function deliverPending(admin: SupabaseClient, rows: PushRow[]) {
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const tokenData: TokenRow[] = [];
  for (let i = 0; i < userIds.length; i += ID_FILTER_SIZE) {
    const { data, error: tokenErr } = await admin
      .from("push_tokens")
      .select("id, user_id, token, platform")
      .in("user_id", userIds.slice(i, i + ID_FILTER_SIZE))
      .eq("status", "active");
    if (tokenErr) {
      console.error("token load failed", tokenErr.code ?? "database error");
      await failRows(admin, rows, "token load failed");
      return { claimed: rows.length, sent: 0, skipped: 0, failed: rows.length };
    }
    tokenData.push(...((data ?? []) as TokenRow[]));
  }

  const tokensByUser = new Map<string, TokenRow[]>();
  for (const t of tokenData) {
    const list = tokensByUser.get(t.user_id) ?? [];
    list.push(t);
    tokensByUser.set(t.user_id, list);
  }

  // iOS icon badge: one summary per recipient per run.
  const badgeByUser = new Map<string, number>();
  const badgeResults = await mapWithConcurrency(
    userIds.filter((userId) => tokensByUser.has(userId)),
    RPC_CONCURRENCY,
    async (userId) => {
      const { data } = await admin.rpc("get_unread_summary_for", { p_user: userId });
      return [userId, data] as const;
    },
  );
  for (const [userId, data] of badgeResults) {
    const summary = (data ?? {}) as { unread_notifications?: number; unread_threads?: number };
    badgeByUser.set(
      userId,
      (summary.unread_notifications ?? 0) + (summary.unread_threads ?? 0),
    );
  }

  type OutMessage = { pushId: string; tokenId: string; message: Record<string, unknown> };
  const outbox: OutMessage[] = [];
  const skippedIds: string[] = [];
  const suppressedIds: string[] = [];
  const deferredIds: string[] = [];
  const visibilityChecks = await mapWithConcurrency(rows, RPC_CONCURRENCY, async (row) => {
    if (!row.source_message_id) return { row, active: true, error: null };
    const { data: active, error } = await admin.rpc('message_is_active', {
      p_message_id: row.source_message_id,
    });
    return { row, active: active === true, error };
  });

  for (const { row, active, error: activeError } of visibilityChecks) {
    // A deletion may race this already-claimed batch. Re-check the canonical
    // visibility predicate immediately before building an Expo payload. If the
    // check is unavailable, fail closed for this run and retry rather than
    // risking a stale private preview in a notification.
    if (row.source_message_id) {
      if (activeError) {
        deferredIds.push(row.id);
        continue;
      }
      if (!active) {
        suppressedIds.push(row.id);
        continue;
      }
    }
    const tokens = tokensByUser.get(row.user_id) ?? [];
    if (tokens.length === 0) {
      skippedIds.push(row.id);
      continue;
    }
    for (const t of tokens) {
      outbox.push({
        pushId: row.id,
        tokenId: t.id,
        message: {
          to: t.token,
          title: pushTitle(row),
          body: row.body ?? "",
          data: { route: row.route, notificationId: row.notification_id },
          sound: "default",
          badge: badgeByUser.get(row.user_id) ?? undefined,
          channelId: CATEGORY_CHANNEL[row.category] ?? "clubs",
          priority: "high",
        },
      });
    }
  }

  if (skippedIds.length > 0) {
    await updateByIds(admin, "push_queue", "id", skippedIds,
      { status: "skipped", error: "no active device tokens" }, "skipped rows");
  }
  if (suppressedIds.length > 0) {
    await updateByIds(admin, "push_queue", "id", suppressedIds,
      { status: 'suppressed', body: null, route: {}, error: 'source message unavailable' },
      "suppressed rows");
  }
  if (deferredIds.length > 0) {
    await updateByIds(admin, "push_queue", "id", deferredIds,
      { status: 'pending', scheduled_for: new Date(Date.now() + 2 * 60_000).toISOString(), error: 'message visibility retry' },
      "deferred rows");
  }

  const expoHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const expoToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (expoToken) expoHeaders.Authorization = `Bearer ${expoToken}`;

  const sentIds = new Set<string>();
  const failedIds = new Map<string, string>();
  const tickets: { ticket_id: string; push_id: string; token_id: string }[] = [];
  const invalidTokenIds = new Set<string>();

  for (let i = 0; i < outbox.length; i += BATCH_SIZE) {
    const chunk = outbox.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: expoHeaders,
        body: JSON.stringify(chunk.map((m) => m.message)),
      });
      if (!res.ok) {
        // Expo response bodies are not a privacy-safe storage boundary: never
        // persist a provider response that might reflect notification text.
        for (const m of chunk) failedIds.set(m.pushId, `expo_http_${res.status}`);
        continue;
      }
      const payload = await res.json();
      const results: { status: string; id?: string; message?: string; details?: { error?: string } }[] =
        payload.data ?? [];
      for (let j = 0; j < chunk.length; j++) {
        const ticket = results[j];
        const m = chunk[j];
        if (!ticket) {
          failedIds.set(m.pushId, "missing ticket");
          continue;
        }
        if (ticket.status === "ok" && ticket.id) {
          sentIds.add(m.pushId);
          tickets.push({ ticket_id: ticket.id, push_id: m.pushId, token_id: m.tokenId });
        } else {
          if (ticket.details?.error === "DeviceNotRegistered") {
            invalidTokenIds.add(m.tokenId);
            // Token dead ≠ push failed: another device may have received it.
            if (!sentIds.has(m.pushId)) skippedIds.push(m.pushId);
          } else if (!sentIds.has(m.pushId)) {
            // Store only a fixed code; ticket messages are third-party data.
            failedIds.set(m.pushId, "expo_ticket_error");
          }
        }
      }
    } catch {
      for (const m of chunk) failedIds.set(m.pushId, "expo_send_failed");
    }
  }

  if (invalidTokenIds.size > 0) {
    await updateByIds(admin, "push_tokens", "id", [...invalidTokenIds],
      { status: "invalid" }, "invalid tokens");
  }

  if (tickets.length > 0) {
    const { error: tErr } = await withTransportRetry(() => admin.from("push_tickets").insert(tickets));
    // Expo ticket ids are unique, so 23505 means a retried insert had landed.
    if (tErr && tErr.code !== "23505") console.error("push_tickets insert failed:", tErr.message);
  }
  if (sentIds.size > 0) {
    await updateByIds(admin, "push_queue", "id", [...sentIds],
      { status: "sent", sent_at: new Date().toISOString() }, "sent rows");
  }

  // Retry transient failures with backoff; give up after MAX_ATTEMPTS.
  const retry: string[] = [];
  const dead: { id: string; error: string }[] = [];
  for (const [id, message] of failedIds) {
    if (sentIds.has(id)) continue;
    const row = rows.find((r) => r.id === id);
    if (row && row.attempts < MAX_ATTEMPTS) retry.push(id);
    else dead.push({ id, error: message });
  }
  if (retry.length > 0) {
    await updateByIds(admin, "push_queue", "id", retry,
      {
        status: "pending",
        scheduled_for: new Date(Date.now() + 2 * 60_000).toISOString(),
      }, "retry rows");
  }
  for (const d of dead) {
    await updateByIds(admin, "push_queue", "id", [d.id],
      { status: "failed", error: d.error }, "failed row");
  }

  return {
    claimed: rows.length,
    sent: sentIds.size,
    skipped: skippedIds.length + suppressedIds.length,
    failed: failedIds.size,
  };
}

async function failRows(admin: SupabaseClient, rows: PushRow[], reason: string) {
  const retryIds = rows.filter((row) => row.attempts < MAX_ATTEMPTS).map((row) => row.id);
  const failedIds = rows.filter((row) => row.attempts >= MAX_ATTEMPTS).map((row) => row.id);
  if (retryIds.length > 0) {
    await updateByIds(admin, "push_queue", "id", retryIds,
      {
        status: "pending",
        scheduled_for: new Date(Date.now() + 2 * 60_000).toISOString(),
      }, "token-load retry rows");
  }
  if (failedIds.length > 0) {
    await updateByIds(admin, "push_queue", "id", failedIds,
      { status: "failed", error: reason }, "token-load failed rows");
  }
}

async function reconcileReceipts(admin: SupabaseClient) {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data, error } = await admin
    .from("push_tickets")
    .select("ticket_id, token_id")
    .eq("checked", false)
    .lt("created_at", cutoff)
    .limit(300);
  if (error || !data || data.length === 0) return { receipts_checked: 0, tokens_invalidated: 0 };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const expoToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (expoToken) headers.Authorization = `Bearer ${expoToken}`;

  let invalidated = 0;
  const ids = data.map((t) => t.ticket_id as string);
  try {
    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) return { receipts_checked: 0, tokens_invalidated: 0 };
    const payload = await res.json();
    const receipts: Record<string, { status: string; details?: { error?: string } }> =
      payload.data ?? {};
    const invalidTokenIds = new Set<string>();
    for (const t of data) {
      const receipt = receipts[t.ticket_id as string];
      if (receipt?.status === "error" && receipt.details?.error === "DeviceNotRegistered") {
        invalidTokenIds.add(t.token_id as string);
      }
    }
    if (invalidTokenIds.size > 0) {
      await updateByIds(admin, "push_tokens", "id", [...invalidTokenIds],
        { status: "invalid" }, "receipt invalid tokens");
      invalidated = invalidTokenIds.size;
    }
    await updateByIds(admin, "push_tickets", "ticket_id", ids,
      { checked: true }, "receipt tickets");
  } catch (e) {
    console.error("receipt check failed:", String(e));
    return { receipts_checked: 0, tokens_invalidated: invalidated };
  }
  return { receipts_checked: ids.length, tokens_invalidated: invalidated };
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
