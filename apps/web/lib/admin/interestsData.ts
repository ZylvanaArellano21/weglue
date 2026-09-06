// ============================================================================
// Admin Dashboard — interest catalog + club-interest read access  (SERVER-ONLY)
// ============================================================================
//
// Same contract as data.ts: requireSecureAdmin() FIRST, then the service-role
// client (which bypasses RLS, so it sees deactivated interests too). Never
// imported from a Client Component.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/interestsData.ts is server-only and must not be imported in the browser.");
}

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";

export interface AdminInterestRow {
  id: string;
  slug: string;
  label: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  /** How many clubs reference this interest, split by tier. */
  primary_clubs: number;
  secondary_clubs: number;
}

export interface ListInterestsParams {
  search?: string;
  status?: "all" | "active" | "inactive";
}

export async function listInterests(
  params: ListInterestsParams = {},
): Promise<AdminInterestRow[]> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  let q = admin
    .from("interests")
    .select("id, slug, label, is_active, sort_order, created_at");
  if (params.status === "active") q = q.eq("is_active", true);
  if (params.status === "inactive") q = q.eq("is_active", false);
  const search = params.search?.trim();
  if (search) {
    const like = `%${search}%`;
    q = q.or(`label.ilike.${like},slug.ilike.${like}`);
  }
  q = q.order("sort_order", { ascending: true }).order("label", { ascending: true });

  const { data, error } = await q;
  if (error) throw error;
  const interests = (data ?? []) as any[];

  // Usage counts per interest, by tier — one grouped read.
  const { data: ci, error: ciErr } = await admin
    .from("club_interests")
    .select("interest_id, tier");
  if (ciErr) throw ciErr;

  const primary = new Map<string, number>();
  const secondary = new Map<string, number>();
  for (const row of (ci ?? []) as any[]) {
    const m = row.tier === "primary" ? primary : secondary;
    m.set(row.interest_id, (m.get(row.interest_id) ?? 0) + 1);
  }

  return interests.map((i) => ({
    id: i.id,
    slug: i.slug,
    label: i.label,
    is_active: !!i.is_active,
    sort_order: i.sort_order ?? 0,
    created_at: i.created_at,
    primary_clubs: primary.get(i.id) ?? 0,
    secondary_clubs: secondary.get(i.id) ?? 0,
  }));
}

export interface ClubInterestRow {
  interest_id: string;
  slug: string;
  label: string;
  is_active: boolean;
  tier: "primary" | "secondary";
}

/** The interests assigned to one club (both tiers), plus the catalog of
 *  active interests NOT yet assigned (for the "Assign interest" picker). */
export async function getClubInterests(clubId: string): Promise<{
  assigned: ClubInterestRow[];
  assignable: { id: string; slug: string; label: string }[];
}> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const [{ data: ci, error: ciErr }, { data: cat, error: catErr }] = await Promise.all([
    admin.from("club_interests").select("interest_id, tier").eq("club_id", clubId),
    admin.from("interests").select("id, slug, label, is_active").order("sort_order").order("label"),
  ]);
  if (ciErr) throw ciErr;
  if (catErr) throw catErr;

  const catById = new Map((cat ?? []).map((c: any) => [c.id, c]));
  const assignedIds = new Set<string>();

  const assigned: ClubInterestRow[] = ((ci ?? []) as any[])
    .map((row) => {
      assignedIds.add(row.interest_id);
      const c = catById.get(row.interest_id);
      return c
        ? { interest_id: row.interest_id, slug: c.slug, label: c.label, is_active: !!c.is_active, tier: row.tier }
        : null;
    })
    .filter((x): x is ClubInterestRow => x !== null)
    .sort((a, b) => (a.tier === b.tier ? a.label.localeCompare(b.label) : a.tier === "primary" ? -1 : 1));

  const assignable = ((cat ?? []) as any[])
    .filter((c) => c.is_active && !assignedIds.has(c.id))
    .map((c) => ({ id: c.id, slug: c.slug, label: c.label }));

  return { assigned, assignable };
}

/** Active interests, for the "filter clubs by interest" dropdown. */
export async function listActiveInterestOptions(): Promise<{ value: string; label: string }[]> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("interests")
    .select("id, label")
    .eq("is_active", true)
    .order("sort_order")
    .order("label");
  if (error) throw error;
  return (data ?? []).map((i: any) => ({ value: i.id, label: i.label }));
}
