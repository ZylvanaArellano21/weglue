// ============================================================================
// Admin Dashboard — Founder-only authorization gate  (SERVER-ONLY)
// ============================================================================
//
// TEMPORARY IMPLEMENTATION NOTE
// -----------------------------
// This module authorizes admin access from a server-side environment allowlist
// (`ADMIN_FOUNDER_EMAILS` / `ADMIN_FOUNDER_USER_IDS`). It is a deliberate,
// clearly-marked stopgap so the founder can use the dashboard on Day 1 without
// first shipping a schema migration. It will be REPLACED by canonical
// platform-admin authorization (a real `platform_admins` table / role checked
// via a SECURITY DEFINER function) in a later phase. Until then:
//
//   • Identity always comes from `supabase.auth.getUser()` (validated JWT) —
//     never from a client-supplied email, id, role, or admin flag.
//   • The allowlist is read from NON-public env vars, so it never reaches the
//     browser bundle.
//   • Every server data function, server action, and API route calls
//     `requireFounder()` itself (defense in depth) — the layout gate is not the
//     only thing standing between a non-founder and admin data.
//
// This file must NEVER be imported from a Client Component.
// ============================================================================

// Hard runtime guard: `server-only` is not installed in this workspace, so we
// fail loudly if this module is ever pulled into a browser bundle. (The env
// vars it reads are non-public and would be undefined client-side anyway.)
if (typeof window !== "undefined") {
  throw new Error(
    "lib/admin/founder.ts is server-only and must not be imported in the browser."
  );
}

import { createClient } from "../supabase/server";
import type { User } from "@supabase/supabase-js";

export type FounderStatus = "unauthenticated" | "denied" | "authorized";

export interface FounderContext {
  status: FounderStatus;
  user: User | null;
}

/** Thrown by `requireFounder()` when the caller is not an authorized founder. */
export class FounderAuthError extends Error {
  constructor(public readonly status: "unauthenticated" | "denied") {
    super(
      status === "unauthenticated"
        ? "Not authenticated"
        : "Not authorized for admin access"
    );
    this.name = "FounderAuthError";
  }
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** The configured founder allowlist, read fresh from the server environment. */
function allowlist(): { emails: string[]; ids: string[] } {
  return {
    emails: parseList(process.env.ADMIN_FOUNDER_EMAILS),
    ids: parseList(process.env.ADMIN_FOUNDER_USER_IDS),
  };
}

/**
 * True iff the given *server-validated* auth user is on the founder allowlist.
 * Only ever call this with a `User` obtained from `supabase.auth.getUser()`.
 */
export function isFounder(user: Pick<User, "id" | "email"> | null): boolean {
  if (!user) return false;
  const { emails, ids } = allowlist();
  if (emails.length === 0 && ids.length === 0) return false; // fail closed
  const email = user.email?.trim().toLowerCase();
  if (email && emails.includes(email)) return true;
  if (user.id && ids.includes(user.id.toLowerCase())) return true;
  return false;
}

/**
 * Resolves the current request's founder status from the validated session.
 * Used by the /admin layout to render the right shell (login redirect vs.
 * access-denied vs. the dashboard). Does NOT throw.
 */
export async function getFounderContext(): Promise<FounderContext> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { status: "unauthenticated", user: null };
  if (!isFounder(user)) return { status: "denied", user };
  return { status: "authorized", user };
}

/**
 * Enforces founder access for a server data function, server action, or API
 * route. Returns the validated founder `User` or throws `FounderAuthError`.
 * Call this at the TOP of every protected server operation — this is the
 * per-request, per-action authorization the spec requires, independent of the
 * layout-level gate.
 */
export async function requireFounder(): Promise<User> {
  const { status, user } = await getFounderContext();
  if (status === "authorized" && user) return user;
  throw new FounderAuthError(status === "unauthenticated" ? "unauthenticated" : "denied");
}
