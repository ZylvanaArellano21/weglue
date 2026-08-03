// In-memory stand-ins for the migration-056 `admin_tx_*` functions.
//
// The REAL atomicity — mutation and audit committing together, and an audit
// failure rolling the mutation back — is proven against PostgreSQL in
// supabase/scripts/test_056_atomic_admin_mutations.sql (75 assertions). It
// cannot be proven in JavaScript, and this file does not pretend to: there is
// no transaction here.
//
// What this DOES preserve is everything the action layer is responsible for:
// the same status codes, the same order of checks, and the same canonical table
// effects — so the web tests continue to verify that server actions dispatch to
// the right function, pass the right arguments, and map statuses to the right
// founder-facing wording.

export interface TxContext {
  tables: Record<string, any[]>;
  /** Audit rows the RPCs "wrote" in-transaction, for assertions. */
  auditRows: any[];
  newId: () => string;
}

type TxResult = { status: string; audit_id?: string; after?: any };

function ok(ctx: TxContext, row: any, args: any, action: string): TxResult {
  const id = ctx.newId();
  ctx.auditRows.push({
    id,
    action,
    event_type: "success",
    reason: args.p_reason ?? null,
    correlation_id: args.p_correlation_id,
    actor_user_id: args.p_actor_id,
  });
  return { status: "ok", audit_id: id, after: row ?? null };
}

function reject(ctx: TxContext, code: string, args: any, action: string): TxResult {
  const id = ctx.newId();
  ctx.auditRows.push({
    id,
    action,
    event_type: "failure",
    error_code: code,
    correlation_id: args.p_correlation_id,
    actor_user_id: args.p_actor_id,
  });
  return { status: code, audit_id: id };
}

/**
 * The database enforces the reason requirement inside the audit insert, which
 * rolls the mutation back. Here the equivalent is: throw BEFORE mutating, so
 * the test observes "no mutation happened" exactly as it would in Postgres.
 */
const REASON_REQUIRED = new Set([
  "membership.remove",
  "officer.demote",
  "gluemate.remove",
  "university.add",
  "university.setActive",
  "post.removeFromClub",
  "rsvp.remove",
  "channel.deleteEmpty",
  "deletedContent.reactivateClub",
]);

function assertReason(action: string, args: any) {
  if (REASON_REQUIRED.has(action) && !String(args.p_reason ?? "").trim()) {
    throw new Error(`admin audit: action "${action}" requires a reason`);
  }
}

export function makeAdminTxRpcs(ctx: TxContext) {
  const t = (name: string) => (ctx.tables[name] ||= []);
  const officerCount = (clubId: string) =>
    t("club_members").filter((r) => r.club_id === clubId && r.role === "officer").length;

  const handlers: Record<string, (a: any) => TxResult> = {
    admin_tx_membership_add(a) {
      const act = "membership.add";
      assertReason(act, a);
      const club = t("clubs").find((c) => c.id === a.p_club_id);
      if (!club) return reject(ctx, "club_not_found", a, act);
      const user = t("profiles").find((p) => p.id === a.p_user_id);
      if (!user) return reject(ctx, "user_not_found", a, act);
      if (club.university_id && user.university_id && club.university_id !== user.university_id) {
        return reject(ctx, "different_university", a, act);
      }
      if (t("club_members").some((m) => m.club_id === a.p_club_id && m.user_id === a.p_user_id)) {
        return reject(ctx, "already_member", a, act);
      }
      const row = { id: ctx.newId(), club_id: a.p_club_id, user_id: a.p_user_id, role: "member" };
      t("club_members").push(row);
      return ok(ctx, row, a, act);
    },

    admin_tx_membership_remove(a) {
      const act = "membership.remove";
      assertReason(act, a);
      const m = t("club_members").find((r) => r.club_id === a.p_club_id && r.user_id === a.p_user_id);
      if (!m) return reject(ctx, "not_member", a, act);
      if (m.role === "officer" && officerCount(a.p_club_id) <= 1) {
        return reject(ctx, "last_officer", a, act);
      }
      ctx.tables.club_members = t("club_members").filter((r) => r !== m);
      ctx.tables.club_officers = t("club_officers").filter(
        (r) => !(r.club_id === a.p_club_id && r.user_id === a.p_user_id)
      );
      return ok(ctx, null, a, act);
    },

    admin_tx_member_role_set(a) {
      const act = a.p_role === "officer" ? "officer.promote" : "officer.demote";
      assertReason(act, a);
      if (a.p_role !== "member" && a.p_role !== "officer") return reject(ctx, "invalid_role", a, act);
      const m = t("club_members").find((r) => r.club_id === a.p_club_id && r.user_id === a.p_user_id);
      if (!m) return reject(ctx, "not_member", a, act);

      if (a.p_role === "officer") {
        const title = String(a.p_role_title ?? "Officer").trim();
        if (title.length < 2 || title.length > 40) return reject(ctx, "invalid_role_title", a, act);
        m.role = "officer";
        const existing = t("club_officers").find(
          (r) => r.club_id === a.p_club_id && r.user_id === a.p_user_id
        );
        if (existing) existing.role_title = title;
        else
          t("club_officers").push({
            id: ctx.newId(),
            club_id: a.p_club_id,
            user_id: a.p_user_id,
            role_title: title,
          });
        return ok(ctx, { ...m }, a, act);
      }

      if (m.role !== "officer") return reject(ctx, "not_officer", a, act);
      if (officerCount(a.p_club_id) <= 1) return reject(ctx, "last_officer", a, act);
      m.role = "member";
      ctx.tables.club_officers = t("club_officers").filter(
        (r) => !(r.club_id === a.p_club_id && r.user_id === a.p_user_id)
      );
      return ok(ctx, { ...m }, a, act);
    },

    admin_tx_officer_add(a) {
      const act = "officer.add";
      assertReason(act, a);
      const title = String(a.p_role_title ?? "Officer").trim();
      if (title.length < 2 || title.length > 40) return reject(ctx, "invalid_role_title", a, act);
      const club = t("clubs").find((c) => c.id === a.p_club_id);
      if (!club) return reject(ctx, "club_not_found", a, act);
      const user = t("profiles").find((p) => p.id === a.p_user_id);
      if (!user) return reject(ctx, "user_not_found", a, act);
      if (club.university_id && user.university_id && club.university_id !== user.university_id) {
        return reject(ctx, "different_university", a, act);
      }
      let m = t("club_members").find((r) => r.club_id === a.p_club_id && r.user_id === a.p_user_id);
      if (!m) {
        m = { id: ctx.newId(), club_id: a.p_club_id, user_id: a.p_user_id, role: "officer" };
        t("club_members").push(m);
      } else m.role = "officer";
      const existing = t("club_officers").find(
        (r) => r.club_id === a.p_club_id && r.user_id === a.p_user_id
      );
      if (existing) existing.role_title = title;
      else
        t("club_officers").push({
          id: ctx.newId(),
          club_id: a.p_club_id,
          user_id: a.p_user_id,
          role_title: title,
        });
      return ok(ctx, { ...m }, a, act);
    },

    admin_tx_officer_title_set(a) {
      const act = "officer.editTitle";
      assertReason(act, a);
      const title = String(a.p_role_title ?? "").trim();
      if (title.length < 2 || title.length > 40) return reject(ctx, "invalid_role_title", a, act);
      const o = t("club_officers").find((r) => r.club_id === a.p_club_id && r.user_id === a.p_user_id);
      if (!o) return reject(ctx, "not_officer", a, act);
      o.role_title = title;
      return ok(ctx, { ...o }, a, act);
    },

    admin_tx_gluemate_remove(a) {
      const act = "gluemate.remove";
      assertReason(act, a);
      if (a.p_user_a === a.p_user_b) return reject(ctx, "same_user", a, act);
      const pair = t("follows").filter(
        (f) =>
          (f.follower_id === a.p_user_a && f.following_id === a.p_user_b) ||
          (f.follower_id === a.p_user_b && f.following_id === a.p_user_a)
      );
      if (pair.length === 0) return reject(ctx, "not_gluemates", a, act);
      ctx.tables.follows = t("follows").filter((f) => !pair.includes(f));
      return ok(ctx, null, a, act);
    },

    admin_tx_university_add(a) {
      const act = "university.add";
      assertReason(act, a);
      const name = String(a.p_name ?? "").trim();
      if (name.length < 2 || name.length > 100) return reject(ctx, "invalid_name", a, act);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.p_slug ?? "")) return reject(ctx, "invalid_slug", a, act);
      if (t("universities").some((u) => u.name === name || u.slug === a.p_slug)) {
        return reject(ctx, "duplicate", a, act);
      }
      const row = { id: ctx.newId(), name, slug: a.p_slug, is_active: true };
      t("universities").push(row);
      return ok(ctx, row, a, act);
    },

    admin_tx_university_edit(a) {
      const act = "university.edit";
      assertReason(act, a);
      const u = t("universities").find((r) => r.id === a.p_id);
      if (!u) return reject(ctx, "not_found", a, act);
      const name = (a.p_name ?? "").trim() || u.name;
      const slug = (a.p_slug ?? "").trim() || u.slug;
      if (name.length < 2 || name.length > 100) return reject(ctx, "invalid_name", a, act);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return reject(ctx, "invalid_slug", a, act);
      if (t("universities").some((r) => r.id !== a.p_id && (r.name === name || r.slug === slug))) {
        return reject(ctx, "duplicate", a, act);
      }
      u.name = name;
      u.slug = slug;
      return ok(ctx, { ...u }, a, act);
    },

    admin_tx_university_set_active(a) {
      const act = "university.setActive";
      assertReason(act, a);
      const u = t("universities").find((r) => r.id === a.p_id);
      if (!u) return reject(ctx, "not_found", a, act);
      u.is_active = !!a.p_is_active;
      return ok(ctx, { ...u }, a, act);
    },

    admin_tx_post_caption_set(a) {
      const act = "post.editCaption";
      assertReason(act, a);
      const cap = String(a.p_caption ?? "").trim();
      if (cap.length > 2000) return reject(ctx, "caption_too_long", a, act);
      const p = t("posts").find((r) => r.id === a.p_post_id);
      if (!p) return reject(ctx, "not_found", a, act);
      p.caption = cap === "" ? null : cap;
      return ok(ctx, { ...p }, a, act);
    },

    admin_tx_post_remove_from_club(a) {
      const act = "post.removeFromClub";
      assertReason(act, a);
      const p = t("posts").find((r) => r.id === a.p_post_id);
      if (!p) return reject(ctx, "not_found", a, act);
      const isPrimary = p.club_id === a.p_club_id;
      const hasExtra = t("post_club_tags").some(
        (r) => r.post_id === a.p_post_id && r.club_id === a.p_club_id
      );
      if (!isPrimary && !hasExtra) return reject(ctx, "not_tagged", a, act);
      if (isPrimary) p.club_id = null;
      ctx.tables.post_club_tags = t("post_club_tags").filter(
        (r) => !(r.post_id === a.p_post_id && r.club_id === a.p_club_id)
      );
      ctx.tables.club_photos = t("club_photos").filter(
        (r) => !(r.post_id === a.p_post_id && r.club_id === a.p_club_id)
      );
      return ok(ctx, { ...p }, a, act);
    },

    admin_tx_comment_content_set(a) {
      const act = "comment.editContent";
      assertReason(act, a);
      const body = String(a.p_content ?? "").trim();
      if (body.length < 1 || body.length > 2000) return reject(ctx, "invalid_content", a, act);
      const c = t("post_comments").find((r) => r.id === a.p_comment_id);
      if (!c) return reject(ctx, "not_found", a, act);
      c.content = body;
      return ok(ctx, { ...c }, a, act);
    },

    admin_tx_event_edit(a) {
      const act = "event.edit";
      assertReason(act, a);
      const e = t("events").find((r) => r.id === a.p_event_id);
      if (!e) return reject(ctx, "not_found", a, act);
      const f = a.p_fields ?? {};
      if ("title" in f && (String(f.title).trim().length < 2 || String(f.title).trim().length > 120)) {
        return reject(ctx, "invalid_title", a, act);
      }
      if ("visibility" in f && !["club", "public", "specific"].includes(f.visibility)) {
        return reject(ctx, "invalid_visibility", a, act);
      }
      for (const k of Object.keys(f)) e[k] = typeof f[k] === "string" ? f[k].trim() || null : f[k];
      return ok(ctx, { ...e }, a, act);
    },

    admin_tx_rsvp_upsert(a) {
      const act = "rsvp.upsert";
      assertReason(act, a);
      if (!["going", "cant"].includes(a.p_status)) return reject(ctx, "invalid_status", a, act);
      if (!t("events").some((r) => r.id === a.p_event_id)) return reject(ctx, "event_not_found", a, act);
      if (!t("profiles").some((r) => r.id === a.p_user_id)) return reject(ctx, "user_not_found", a, act);
      let r = t("event_rsvps").find((x) => x.event_id === a.p_event_id && x.user_id === a.p_user_id);
      if (r) r.status = a.p_status;
      else {
        r = { id: ctx.newId(), event_id: a.p_event_id, user_id: a.p_user_id, status: a.p_status };
        t("event_rsvps").push(r);
      }
      return ok(ctx, { ...r }, a, act);
    },

    admin_tx_rsvp_remove(a) {
      const act = "rsvp.remove";
      assertReason(act, a);
      const r = t("event_rsvps").find((x) => x.event_id === a.p_event_id && x.user_id === a.p_user_id);
      if (!r) return reject(ctx, "not_found", a, act);
      ctx.tables.event_rsvps = t("event_rsvps").filter((x) => x !== r);
      return ok(ctx, null, a, act);
    },

    admin_tx_channel_create(a) {
      const act = "channel.create";
      assertReason(act, a);
      const nm = String(a.p_name ?? "").trim();
      if (nm.length < 1 || nm.length > 40) return reject(ctx, "invalid_name", a, act);
      if (!t("conversations").some((c) => c.id === a.p_conversation_id)) {
        return reject(ctx, "conversation_not_found", a, act);
      }
      if (
        t("conversation_channels").some(
          (c) => c.conversation_id === a.p_conversation_id && c.name.toLowerCase() === nm.toLowerCase()
        )
      ) {
        return reject(ctx, "duplicate_name", a, act);
      }
      const row = { id: ctx.newId(), conversation_id: a.p_conversation_id, name: nm, kind: "topic", post_permission: "everyone" };
      t("conversation_channels").push(row);
      return ok(ctx, row, a, act);
    },

    admin_tx_channel_rename(a) {
      const act = "channel.rename";
      assertReason(act, a);
      const nm = String(a.p_name ?? "").trim();
      if (nm.length < 1 || nm.length > 40) return reject(ctx, "invalid_name", a, act);
      const c = t("conversation_channels").find((r) => r.id === a.p_channel_id);
      if (!c) return reject(ctx, "not_found", a, act);
      if (c.kind === "main") return reject(ctx, "main_channel", a, act);
      c.name = nm;
      return ok(ctx, { ...c }, a, act);
    },

    admin_tx_channel_set_permission(a) {
      const act = "channel.setPermission";
      assertReason(act, a);
      if (!["everyone", "officers", "certain"].includes(a.p_permission)) {
        return reject(ctx, "invalid_permission", a, act);
      }
      const c = t("conversation_channels").find((r) => r.id === a.p_channel_id);
      if (!c) return reject(ctx, "not_found", a, act);
      if (c.kind === "main") return reject(ctx, "main_channel", a, act);
      c.post_permission = a.p_permission;
      return ok(ctx, { ...c }, a, act);
    },

    admin_tx_channel_delete_empty(a) {
      const act = "channel.deleteEmpty";
      assertReason(act, a);
      const c = t("conversation_channels").find((r) => r.id === a.p_channel_id);
      if (!c) return reject(ctx, "not_found", a, act);
      if (c.kind === "main") return reject(ctx, "main_channel", a, act);
      if (t("messages").some((m) => m.channel_id === a.p_channel_id)) {
        return reject(ctx, "channel_not_empty", a, act);
      }
      ctx.tables.conversation_channels = t("conversation_channels").filter((r) => r !== c);
      return ok(ctx, null, a, act);
    },

    admin_tx_notification_set_read(a) {
      const act = "notification.setRead";
      assertReason(act, a);
      const n = t("notifications").find((r) => r.id === a.p_notification_id);
      if (!n) return reject(ctx, "not_found", a, act);
      n.read = !!a.p_read;
      n.read_at = a.p_read ? new Date().toISOString() : null;
      return ok(ctx, { ...n }, a, act);
    },

    admin_tx_report_set_status(a) {
      const act = "report.review";
      assertReason(act, a);
      if (a.p_next_status !== "reviewing") {
        return reject(ctx, "invalid_status", a, act);
      }
      const r = t("reports").find((x) => x.id === a.p_report_id);
      if (!r) return reject(ctx, "not_found", a, act);
      if (r.status !== "pending") return reject(ctx, "invalid_transition", a, act);
      r.status = a.p_next_status;
      return ok(ctx, { ...r }, a, act);
    },

    admin_tx_report_decide(a) {
      const act = a.p_new_status === "dismissed" ? "report.dismiss" : "report.resolve";
      assertReason(act, a);
      const r = t("reports").find((x) => x.id === a.p_report_id);
      if (!r) return reject(ctx, "not_found", a, act);
      if (!["pending", "reviewing"].includes(r.status)) return reject(ctx, "terminal_decision", a, act);
      if (a.p_enforcement_action !== "none") return reject(ctx, "enforcement_failed", a, act);
      r.status = a.p_new_status;
      const decisions = t("report_decision_history");
      decisions.push({ id: `decision-${decisions.length + 1}`, report_id: r.id, resolution_outcome: a.p_resolution_outcome, enforcement_action: a.p_enforcement_action });
      return ok(ctx, { ...r }, a, act);
    },

    admin_tx_club_reactivate(a) {
      const act = "deletedContent.reactivateClub";
      assertReason(act, a);
      const c = t("clubs").find((r) => r.id === a.p_club_id);
      if (!c) return reject(ctx, "not_found", a, act);
      if (c.is_active) return reject(ctx, "already_active", a, act);
      c.is_active = true;
      return ok(ctx, { ...c }, a, act);
    },
  };

  return handlers;
}
