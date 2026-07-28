// ============================================================================
// Admin Dashboard — Day-5 Data Health diagnostics  (SERVER-ONLY, READ-ONLY)
// ============================================================================
// Safe, founder+MFA-gated, READ-ONLY integrity checks over the production
// schema. Every check:
//   • runs through requireSecureAdmin() (portal + allowlist + aal2),
//   • is bounded (SCAN_CAP rows scanned; parent lookups chunked so no giant URL),
//   • never scans full message bodies, never returns private deleted-message
//     evidence, and never reads push tokens / secrets,
//   • returns a severity, an affected count, and a STRICTLY-CAPPED set of
//     human-readable examples.
//
// Repairs are DISABLED on Day 5 — the UI shows repair affordances as unavailable
// with "Review and dry-run required before repair." Nothing here mutates data.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/dataHealth.ts is server-only and must not be imported in the browser.");
}

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";

type Admin = ReturnType<typeof createAdminClient>;

const SCAN_CAP = 5000; // max child rows scanned per check
const CHUNK = 300; // parent-existence lookups are chunked to keep URLs bounded
const EXAMPLE_CAP = 5; // strict cap on human-readable examples per check
const AUTH_SAMPLE = 300; // bounded sample for auth↔profile consistency

export type HealthSeverity = "critical" | "warning" | "info" | "ok";

export interface HealthExample {
  id: string;
  label: string;
  href: string | null;
}

export interface HealthCheck {
  key: string;
  category: string;
  title: string;
  description: string;
  severity: HealthSeverity;
  affected: number;
  scanned: number;
  /** True when the scan hit SCAN_CAP, so `affected` is a lower bound. */
  capped: boolean;
  examples: HealthExample[];
  /** Repairs are never auto-run; this is the human next step. */
  repairHint: string;
}

export interface DataHealthReport {
  ranAt: string;
  durationMs: number;
  checks: HealthCheck[];
  totals: { critical: number; warning: number; info: number; ok: number; affected: number };
}

// ── Bounded helpers ──────────────────────────────────────────────────────────

/** Return the subset of `ids` that EXIST in `table.col` (chunked .in queries). */
async function existingIds(admin: Admin, table: string, col: string, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const { data } = await admin.from(table).select(col).in(col, slice);
    for (const r of (data ?? []) as any[]) found.add(r[col]);
  }
  return found;
}

function severityFor(affected: number, critical: boolean): HealthSeverity {
  if (affected === 0) return "ok";
  return critical ? "critical" : "warning";
}

// ── Individual checks ────────────────────────────────────────────────────────

async function checkAuthUsersWithoutProfiles(admin: Admin): Promise<HealthCheck> {
  // Bounded GoTrue scan; check profile existence in one chunked pass.
  const users: { id: string; email: string | null }[] = [];
  let page = 1;
  while (users.length < AUTH_SAMPLE) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) users.push({ id: u.id, email: u.email ?? null });
    if (data.users.length < 200) break;
    page += 1;
  }
  const have = await existingIds(admin, "profiles", "id", users.map((u) => u.id));
  const missing = users.filter((u) => !have.has(u.id));
  return {
    key: "auth_users_without_profiles",
    category: "Accounts",
    title: "Auth users without a profile",
    description: "Signed-up auth users that have no public.profiles row (the classic partial-signup drift).",
    severity: severityFor(missing.length, true),
    affected: missing.length,
    scanned: users.length,
    capped: users.length >= AUTH_SAMPLE,
    examples: missing.slice(0, EXAMPLE_CAP).map((u) => ({ id: u.id, label: u.email ?? u.id, href: null })),
    repairHint: "Backfill the missing profile (or delete the orphan auth user) after a manual review.",
  };
}

async function checkProfilesWithoutAuthUsers(admin: Admin): Promise<HealthCheck> {
  const { data } = await admin.from("profiles").select("id, username").order("created_at", { ascending: false }).limit(AUTH_SAMPLE);
  const profiles = (data ?? []) as any[];
  const missing: HealthExample[] = [];
  await Promise.all(
    profiles.map(async (p) => {
      try {
        const { data: u } = await admin.auth.admin.getUserById(p.id);
        if (!u?.user) missing.push({ id: p.id, label: `@${p.username}`, href: `/admin/users/${p.id}` });
      } catch {
        missing.push({ id: p.id, label: `@${p.username}`, href: `/admin/users/${p.id}` });
      }
    })
  );
  return {
    key: "profiles_without_auth_users",
    category: "Accounts",
    title: "Profiles without an auth user",
    description: "Profiles whose backing auth.users row is gone (FK is ON DELETE CASCADE, so this should be empty).",
    severity: severityFor(missing.length, true),
    affected: missing.length,
    scanned: profiles.length,
    capped: profiles.length >= AUTH_SAMPLE,
    examples: missing.slice(0, EXAMPLE_CAP),
    repairHint: "Investigate — a CASCADE should prevent this. Remove the orphaned profile after review.",
  };
}

async function checkDuplicateMemberships(admin: Admin): Promise<HealthCheck> {
  const { data } = await admin.from("club_members").select("club_id, user_id").limit(SCAN_CAP);
  const rows = (data ?? []) as any[];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.club_id}:${r.user_id}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  return {
    key: "duplicate_club_memberships",
    category: "Clubs",
    title: "Duplicate club memberships",
    description: "The same user appearing twice in one club (a UNIQUE (club_id,user_id) constraint should prevent this).",
    severity: severityFor(dups.length, false),
    affected: dups.length,
    scanned: rows.length,
    capped: rows.length >= SCAN_CAP,
    examples: dups.slice(0, EXAMPLE_CAP).map(([k, n]) => ({ id: k, label: `${k} ×${n}`, href: null })),
    repairHint: "Deduplicate to a single membership row after review.",
  };
}

async function checkClubsWithoutOfficers(admin: Admin): Promise<HealthCheck> {
  const [{ data: clubs }, { data: officers }] = await Promise.all([
    admin.from("clubs").select("id, name").limit(SCAN_CAP),
    admin.from("club_members").select("club_id").eq("role", "officer").limit(SCAN_CAP),
  ]);
  const withOfficer = new Set((officers ?? []).map((o: any) => o.club_id));
  const rows = (clubs ?? []) as any[];
  const missing = rows.filter((c) => !withOfficer.has(c.id));
  return {
    key: "clubs_without_officers",
    category: "Clubs",
    title: "Clubs with no officer",
    description: "Active/inactive clubs that have no member with officer authority (club_members.role='officer').",
    severity: severityFor(missing.length, false),
    affected: missing.length,
    scanned: rows.length,
    capped: rows.length >= SCAN_CAP,
    examples: missing.slice(0, EXAMPLE_CAP).map((c) => ({ id: c.id, label: c.name, href: `/admin/clubs/${c.id}` })),
    repairHint: "Assign an officer or archive the club after review.",
  };
}

async function checkOfficerRosterSync(admin: Admin): Promise<[HealthCheck, HealthCheck]> {
  const [{ data: roster }, { data: authority }] = await Promise.all([
    admin.from("club_officers").select("club_id, user_id").not("user_id", "is", null).limit(SCAN_CAP),
    admin.from("club_members").select("club_id, user_id").eq("role", "officer").limit(SCAN_CAP),
  ]);
  const authoritySet = new Set((authority ?? []).map((a: any) => `${a.club_id}:${a.user_id}`));
  const rosterSet = new Set((roster ?? []).map((r: any) => `${r.club_id}:${r.user_id}`));

  const displayWithoutAuthority = (roster ?? []).filter((r: any) => !authoritySet.has(`${r.club_id}:${r.user_id}`));
  const authorityWithoutDisplay = (authority ?? []).filter((a: any) => !rosterSet.has(`${a.club_id}:${a.user_id}`));

  const c1: HealthCheck = {
    key: "officer_display_without_authority",
    category: "Clubs",
    title: "Officer display rows without officer authority",
    description: "club_officers (display roster) entries whose user is NOT an officer in club_members.",
    severity: severityFor(displayWithoutAuthority.length, false),
    affected: displayWithoutAuthority.length,
    scanned: (roster ?? []).length,
    capped: (roster ?? []).length >= SCAN_CAP,
    examples: displayWithoutAuthority.slice(0, EXAMPLE_CAP).map((r: any) => ({
      id: `${r.club_id}:${r.user_id}`,
      label: `club ${r.club_id.slice(0, 8)}… / user ${r.user_id.slice(0, 8)}…`,
      href: `/admin/clubs/${r.club_id}`,
    })),
    repairHint: "Re-sync the roster or grant officer authority after review.",
  };
  const c2: HealthCheck = {
    key: "officer_authority_without_display",
    category: "Clubs",
    title: "Officer authority without a display roster row",
    description: "club_members officers that are missing from the club_officers display roster.",
    severity: severityFor(authorityWithoutDisplay.length, false),
    affected: authorityWithoutDisplay.length,
    scanned: (authority ?? []).length,
    capped: (authority ?? []).length >= SCAN_CAP,
    examples: authorityWithoutDisplay.slice(0, EXAMPLE_CAP).map((a: any) => ({
      id: `${a.club_id}:${a.user_id}`,
      label: `club ${a.club_id.slice(0, 8)}… / user ${a.user_id.slice(0, 8)}…`,
      href: `/admin/clubs/${a.club_id}`,
    })),
    repairHint: "Add the missing display roster row after review.",
  };
  return [c1, c2];
}

/** Generic "child rows whose parent id is missing" check. */
async function checkMissingParents(
  admin: Admin,
  opts: {
    key: string;
    category: string;
    title: string;
    description: string;
    childTable: string;
    selectCols: string; // must include id + the fk columns
    idCol?: string;
    fks: { col: string; parentTable: string; parentCol: string; nullable?: boolean }[];
    hrefBase?: string; // e.g. /admin/posts/
    labelFrom?: (row: any) => string;
    critical?: boolean;
  }
): Promise<HealthCheck> {
  const idCol = opts.idCol ?? "id";
  const { data } = await admin.from(opts.childTable).select(opts.selectCols).limit(SCAN_CAP);
  const rows = (data ?? []) as any[];

  const parentSets = new Map<string, Set<string>>();
  for (const fk of opts.fks) {
    const ids = rows.map((r) => r[fk.col]).filter(Boolean) as string[];
    parentSets.set(fk.col, await existingIds(admin, fk.parentTable, fk.parentCol, ids));
  }

  const bad = rows.filter((r) =>
    opts.fks.some((fk) => {
      const v = r[fk.col];
      if (v == null) return false; // null fk is not "missing parent" unless required
      return !parentSets.get(fk.col)!.has(v);
    })
  );

  return {
    key: opts.key,
    category: opts.category,
    title: opts.title,
    description: opts.description,
    severity: severityFor(bad.length, opts.critical ?? true),
    affected: bad.length,
    scanned: rows.length,
    capped: rows.length >= SCAN_CAP,
    examples: bad.slice(0, EXAMPLE_CAP).map((r) => ({
      id: r[idCol],
      label: opts.labelFrom ? opts.labelFrom(r) : `${opts.childTable} ${String(r[idCol]).slice(0, 8)}…`,
      href: opts.hrefBase ? `${opts.hrefBase}${r[idCol]}` : null,
    })),
    repairHint: "Investigate the broken reference; remove or repoint the orphaned row after review.",
  };
}

async function checkEventChronology(admin: Admin): Promise<HealthCheck> {
  const { data } = await admin.from("events").select("id, title, event_date, start_time, end_time").limit(SCAN_CAP);
  const rows = (data ?? []) as any[];
  const norm = (t?: string | null) => (t ? (t.length === 5 ? `${t}:00` : t) : null);
  const bad = rows.filter((e) => {
    const dateBad = e.event_date && Number.isNaN(Date.parse(e.event_date));
    const s = norm(e.start_time);
    const en = norm(e.end_time);
    const timeBad = s && en && s >= en;
    return dateBad || timeBad;
  });
  return {
    key: "events_invalid_chronology",
    category: "Events",
    title: "Events with impossible start/end times",
    description: "Events where start_time ≥ end_time, or the event_date is not a valid date.",
    severity: severityFor(bad.length, false),
    affected: bad.length,
    scanned: rows.length,
    capped: rows.length >= SCAN_CAP,
    examples: bad.slice(0, EXAMPLE_CAP).map((e) => ({ id: e.id, label: e.title, href: `/admin/events/${e.id}` })),
    repairHint: "Correct the event times after review (admin event edit validates chronology).",
  };
}

async function checkDuplicateRsvps(admin: Admin): Promise<HealthCheck> {
  const { data } = await admin.from("event_rsvps").select("event_id, user_id").limit(SCAN_CAP);
  const rows = (data ?? []) as any[];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.event_id}:${r.user_id}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  return {
    key: "duplicate_rsvps",
    category: "Events",
    title: "Duplicate RSVP relationships",
    description: "A user with more than one RSVP row for the same event (a UNIQUE constraint should prevent this).",
    severity: severityFor(dups.length, false),
    affected: dups.length,
    scanned: rows.length,
    capped: rows.length >= SCAN_CAP,
    examples: dups.slice(0, EXAMPLE_CAP).map(([k, n]) => ({ id: k, label: `${k} ×${n}`, href: null })),
    repairHint: "Collapse to a single RSVP row after review.",
  };
}

async function checkReportsMissingTargets(admin: Admin): Promise<HealthCheck> {
  const { data } = await admin.from("reports").select("id, entity_type, entity_id").not("entity_id", "is", null).limit(SCAN_CAP);
  const rows = (data ?? []) as any[];
  const byType: Record<string, string> = { club: "clubs", event: "events", post: "posts", user: "profiles" };
  const sets = new Map<string, Set<string>>();
  for (const [type, table] of Object.entries(byType)) {
    const ids = rows.filter((r) => r.entity_type === type).map((r) => r.entity_id);
    sets.set(type, await existingIds(admin, table, "id", ids));
  }
  // message/chat targets point at messages/conversations.
  const msgIds = rows.filter((r) => r.entity_type === "message").map((r) => r.entity_id);
  const chatIds = rows.filter((r) => r.entity_type === "chat").map((r) => r.entity_id);
  sets.set("message", await existingIds(admin, "messages", "id", msgIds));
  sets.set("chat", await existingIds(admin, "conversations", "id", chatIds));

  const bad = rows.filter((r) => {
    const set = sets.get(r.entity_type);
    if (!set) return false; // unknown type — do not flag
    return !set.has(r.entity_id);
  });
  return {
    key: "reports_missing_targets",
    category: "Moderation",
    title: "Reports pointing at a missing target",
    description: "Reports whose entity_id no longer resolves in its target table (entity_id has no FK, so this can drift).",
    severity: severityFor(bad.length, false),
    affected: bad.length,
    scanned: rows.length,
    capped: rows.length >= SCAN_CAP,
    examples: bad.slice(0, EXAMPLE_CAP).map((r) => ({ id: r.id, label: `${r.entity_type} report`, href: `/admin/reports/${r.id}` })),
    repairHint: "Dismiss or annotate reports whose target was deleted, after review.",
  };
}

async function checkMalformedMedia(admin: Admin): Promise<HealthCheck> {
  const { data } = await admin.from("posts").select("id, image_url").not("image_url", "is", null).limit(SCAN_CAP);
  const rows = (data ?? []) as any[];
  const bad = rows.filter((p) => typeof p.image_url === "string" && !/^https?:\/\//i.test(p.image_url));
  return {
    key: "malformed_media_refs",
    category: "Media",
    title: "Malformed public media references",
    description: "Posts whose image_url is present but is not a valid absolute http(s) URL.",
    severity: severityFor(bad.length, false),
    affected: bad.length,
    scanned: rows.length,
    capped: rows.length >= SCAN_CAP,
    examples: bad.slice(0, EXAMPLE_CAP).map((p) => ({ id: p.id, label: `post ${p.id.slice(0, 8)}…`, href: `/admin/posts/${p.id}` })),
    repairHint: "Repoint or clear the malformed media URL after review.",
  };
}

async function checkImpossibleStatuses(admin: Admin): Promise<HealthCheck> {
  const [{ data: reports }, { data: events }] = await Promise.all([
    admin.from("reports").select("id, status").limit(SCAN_CAP),
    admin.from("events").select("id, visibility").limit(SCAN_CAP),
  ]);
  const okStatus = new Set(["pending", "reviewing", "resolved", "dismissed"]);
  const okVis = new Set(["everyone", "members", "specific"]);
  const badReports = (reports ?? []).filter((r: any) => !okStatus.has(r.status));
  const badEvents = (events ?? []).filter((e: any) => !okVis.has(e.visibility));
  const affected = badReports.length + badEvents.length;
  const examples: HealthExample[] = [
    ...badReports.slice(0, 3).map((r: any) => ({ id: r.id, label: `report status="${r.status}"`, href: `/admin/reports/${r.id}` })),
    ...badEvents.slice(0, 2).map((e: any) => ({ id: e.id, label: `event visibility="${e.visibility}"`, href: `/admin/events/${e.id}` })),
  ];
  return {
    key: "impossible_status_values",
    category: "Integrity",
    title: "Impossible status / enum values",
    description: "reports.status or events.visibility holding a value outside the canonical CHECK set.",
    severity: severityFor(affected, false),
    affected,
    scanned: (reports ?? []).length + (events ?? []).length,
    capped: (reports ?? []).length >= SCAN_CAP || (events ?? []).length >= SCAN_CAP,
    examples: examples.slice(0, EXAMPLE_CAP),
    repairHint: "Correct the out-of-range value after review (CHECK constraints should prevent new ones).",
  };
}

// ── Runner ───────────────────────────────────────────────────────────────────

export async function runDataHealth(): Promise<DataHealthReport> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const start = Date.now();

  const [
    authNoProfile,
    profileNoAuth,
    dupMembership,
    clubsNoOfficer,
    officerSync,
    membershipsParents,
    postsParents,
    commentsParents,
    eventsChrono,
    rsvpsParents,
    dupRsvp,
    convParents,
    channelsParents,
    messagesParents,
    notifRecipients,
    reportsTargets,
    media,
    statuses,
  ] = await Promise.all([
    checkAuthUsersWithoutProfiles(admin),
    checkProfilesWithoutAuthUsers(admin),
    checkDuplicateMemberships(admin),
    checkClubsWithoutOfficers(admin),
    checkOfficerRosterSync(admin),
    checkMissingParents(admin, {
      key: "memberships_missing_parents",
      category: "Clubs",
      title: "Memberships referencing a missing user/club",
      description: "club_members rows whose user_id or club_id no longer exists.",
      childTable: "club_members",
      selectCols: "id, user_id, club_id",
      fks: [
        { col: "user_id", parentTable: "profiles", parentCol: "id" },
        { col: "club_id", parentTable: "clubs", parentCol: "id" },
      ],
    }),
    checkMissingParents(admin, {
      key: "posts_missing_parents",
      category: "Content",
      title: "Posts referencing a missing creator/club",
      description: "posts whose author_id is missing, or whose non-null club_id no longer exists.",
      childTable: "posts",
      selectCols: "id, author_id, club_id",
      fks: [
        { col: "author_id", parentTable: "profiles", parentCol: "id" },
        { col: "club_id", parentTable: "clubs", parentCol: "id", nullable: true },
      ],
      hrefBase: "/admin/posts/",
    }),
    checkMissingParents(admin, {
      key: "comments_missing_parents",
      category: "Content",
      title: "Comments referencing a missing post/user",
      description: "post_comments whose post_id or user_id no longer exists.",
      childTable: "post_comments",
      selectCols: "id, post_id, user_id",
      fks: [
        { col: "post_id", parentTable: "posts", parentCol: "id" },
        { col: "user_id", parentTable: "profiles", parentCol: "id" },
      ],
      hrefBase: "/admin/comments/",
    }),
    checkEventChronology(admin),
    checkMissingParents(admin, {
      key: "rsvps_missing_parents",
      category: "Events",
      title: "RSVPs referencing a missing user/event",
      description: "event_rsvps whose event_id or user_id no longer exists.",
      childTable: "event_rsvps",
      selectCols: "id, event_id, user_id",
      fks: [
        { col: "event_id", parentTable: "events", parentCol: "id" },
        { col: "user_id", parentTable: "profiles", parentCol: "id" },
      ],
    }),
    checkDuplicateRsvps(admin),
    checkMissingParents(admin, {
      key: "conversations_missing_parents",
      category: "Messaging",
      title: "Conversations with a missing creator/club",
      description: "conversations whose non-null created_by or club_id no longer exists.",
      childTable: "conversations",
      selectCols: "id, created_by, club_id",
      fks: [
        { col: "created_by", parentTable: "profiles", parentCol: "id", nullable: true },
        { col: "club_id", parentTable: "clubs", parentCol: "id", nullable: true },
      ],
      hrefBase: "/admin/conversations/",
    }),
    checkMissingParents(admin, {
      key: "channels_missing_conversation",
      category: "Messaging",
      title: "Channels with a missing conversation",
      description: "conversation_channels whose parent conversation_id no longer exists.",
      childTable: "conversation_channels",
      selectCols: "id, conversation_id",
      fks: [{ col: "conversation_id", parentTable: "conversations", parentCol: "id" }],
      hrefBase: "/admin/channels/",
    }),
    checkMissingParents(admin, {
      key: "messages_missing_parents",
      category: "Messaging",
      title: "Messages with a missing conversation/channel/sender",
      description: "messages whose conversation_id, non-null channel_id, or sender_id no longer exists.",
      childTable: "messages",
      selectCols: "id, conversation_id, channel_id, sender_id",
      fks: [
        { col: "conversation_id", parentTable: "conversations", parentCol: "id" },
        { col: "channel_id", parentTable: "conversation_channels", parentCol: "id", nullable: true },
        { col: "sender_id", parentTable: "profiles", parentCol: "id", nullable: true },
      ],
      hrefBase: "/admin/messages/",
    }),
    checkMissingParents(admin, {
      key: "notifications_missing_recipient",
      category: "Messaging",
      title: "Notifications with a missing recipient",
      description: "notifications whose user_id (recipient) no longer exists.",
      childTable: "notifications",
      selectCols: "id, user_id",
      fks: [{ col: "user_id", parentTable: "profiles", parentCol: "id" }],
      hrefBase: "/admin/notifications/",
    }),
    checkReportsMissingTargets(admin),
    checkMalformedMedia(admin),
    checkImpossibleStatuses(admin),
  ]);

  const checks: HealthCheck[] = [
    authNoProfile,
    profileNoAuth,
    dupMembership,
    clubsNoOfficer,
    ...officerSync,
    membershipsParents,
    postsParents,
    commentsParents,
    eventsChrono,
    rsvpsParents,
    dupRsvp,
    convParents,
    channelsParents,
    messagesParents,
    notifRecipients,
    reportsTargets,
    media,
    statuses,
  ];

  const totals = { critical: 0, warning: 0, info: 0, ok: 0, affected: 0 };
  for (const c of checks) {
    totals[c.severity] += 1;
    totals.affected += c.affected;
  }

  // Most severe first, then by affected count.
  const order: Record<HealthSeverity, number> = { critical: 0, warning: 1, info: 2, ok: 3 };
  checks.sort((a, b) => order[a.severity] - order[b.severity] || b.affected - a.affected);

  return { ranAt: new Date().toISOString(), durationMs: Date.now() - start, checks, totals };
}
