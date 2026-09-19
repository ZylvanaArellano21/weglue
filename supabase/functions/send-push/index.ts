// Delivers queued push notifications through the Expo Push API and
// reconciles delivery receipts.
//
// Invoked every minute by pg_cron (invoke_push_dispatch → pg_net), and only
// when work exists. Auth: the caller must present the PUSH_DISPATCH_SECRET
// bearer (stored in Vault for the cron job and in function secrets here) —
// this endpoint is never called by clients.
//
// One run:
//   1. Claims a batch of pending push_queue rows (claim_push_batch —
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
const MAX_ATTEMPTS = 3;

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

  const sent = await deliverPending(admin);
  const receipts = await reconcileReceipts(admin);

  return json({ ok: true, ...sent, ...receipts });
});

async function deliverPending(admin: SupabaseClient) {
  const { data: batch, error } = await admin.rpc("claim_push_batch", { p_limit: 200 });
  if (error) {
    console.error("claim_push_batch failed:", error.message);
    return { claimed: 0, sent: 0, skipped: 0, failed: 0 };
  }
  const rows = (batch ?? []) as PushRow[];
  if (rows.length === 0) return { claimed: 0, sent: 0, skipped: 0, failed: 0 };

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: tokenData, error: tokenErr } = await admin
    .from("push_tokens")
    .select("id, user_id, token, platform")
    .in("user_id", userIds)
    .eq("status", "active");
  if (tokenErr) {
    console.error("token load failed:", tokenErr.message);
    await failRows(admin, rows, "token load failed");
    return { claimed: rows.length, sent: 0, skipped: 0, failed: rows.length };
  }

  const tokensByUser = new Map<string, TokenRow[]>();
  for (const t of (tokenData ?? []) as TokenRow[]) {
    const list = tokensByUser.get(t.user_id) ?? [];
    list.push(t);
    tokensByUser.set(t.user_id, list);
  }

  // iOS icon badge: one summary per recipient per run.
  const badgeByUser = new Map<string, number>();
  const badgeResults = await Promise.all(
    userIds
      .filter((userId) => tokensByUser.has(userId))
      .map(async (userId) => {
        const { data } = await admin.rpc("get_unread_summary_for", { p_user: userId });
        return [userId, data] as const;
      }),
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
  const visibilityChecks = await Promise.all(
    rows.map(async (row) => {
      if (!row.source_message_id) return { row, active: true, error: null };
      const { data: active, error } = await admin.rpc('message_is_active', {
        p_message_id: row.source_message_id,
      });
      return { row, active: active === true, error };
    }),
  );

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
    await admin
      .from("push_queue")
      .update({ status: "skipped", error: "no active device tokens" })
      .in("id", skippedIds);
  }
  if (suppressedIds.length > 0) {
    await admin
      .from('push_queue')
      .update({ status: 'suppressed', body: null, route: {}, error: 'source message unavailable' })
      .in('id', suppressedIds);
  }
  if (deferredIds.length > 0) {
    await admin
      .from('push_queue')
      .update({ status: 'pending', scheduled_for: new Date(Date.now() + 2 * 60_000).toISOString(), error: 'message visibility retry' })
      .in('id', deferredIds);
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
    await admin
      .from("push_tokens")
      .update({ status: "invalid" })
      .in("id", [...invalidTokenIds]);
  }

  if (tickets.length > 0) {
    const { error: tErr } = await admin.from("push_tickets").insert(tickets);
    if (tErr) console.error("push_tickets insert failed:", tErr.message);
  }
  if (sentIds.size > 0) {
    await admin
      .from("push_queue")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .in("id", [...sentIds]);
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
    await admin
      .from("push_queue")
      .update({
        status: "pending",
        scheduled_for: new Date(Date.now() + 2 * 60_000).toISOString(),
      })
      .in("id", retry);
  }
  for (const d of dead) {
    await admin.from("push_queue").update({ status: "failed", error: d.error }).eq("id", d.id);
  }

  return {
    claimed: rows.length,
    sent: sentIds.size,
    skipped: skippedIds.length + suppressedIds.length,
    failed: failedIds.size,
  };
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
      await admin
        .from("push_tokens")
        .update({ status: "invalid" })
        .in("id", [...invalidTokenIds]);
      invalidated = invalidTokenIds.size;
    }
    await admin.from("push_tickets").update({ checked: true }).in("ticket_id", ids);
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
