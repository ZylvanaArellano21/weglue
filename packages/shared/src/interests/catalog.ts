import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// Shared interest catalog — the ONE source both interest surveys read from.
//
// Interests live in the `interests` table (migration 122), so an admin adding /
// renaming / deactivating one takes effect in onboarding AND Sidebar → Interests
// with no app or web deploy. This module is the only place the client learns the
// list; the survey screens must never hard-code it again.
//
// `slug` is the stable machine key (safe across renames); `label` is what the
// user sees and what travels in signup metadata / `set_my_interests`.
// ============================================================================

export type ClubInterestTier = "primary" | "secondary";

export interface InterestOption {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
}

interface InterestRow {
  id: string;
  slug: string;
  label: string;
  sort_order: number | null;
}

/**
 * Active interests, ordered for display. Pass any configured Supabase client
 * (web SSR client, mobile client, or the shared one) — only `.from(...).select`
 * is used, and RLS already restricts the table to `is_active = true` rows, so an
 * anonymous onboarding caller sees exactly the same list a signed-in user does.
 *
 * Throws on a transport error so the caller can fall back to
 * `INTEREST_CATALOG_FALLBACK` rather than render an empty survey.
 */
export async function fetchActiveInterests(
  supabase: Pick<SupabaseClient, "from">,
): Promise<InterestOption[]> {
  const { data, error } = await supabase
    .from("interests")
    .select("id, slug, label, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as InterestRow[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    label: row.label,
    sortOrder: row.sort_order ?? 0,
  }));
}

/** label → slug for a fetched catalog (survey selections are held as labels). */
export function interestSlugsForLabels(
  catalog: readonly InterestOption[],
  labels: readonly string[],
): string[] {
  const bySlug = new Map(catalog.map((o) => [o.label, o.slug]));
  return labels.map((l) => bySlug.get(l)).filter((s): s is string => !!s);
}

// Last-resort list used ONLY when `fetchActiveInterests` fails (offline during
// onboarding, etc.) so the survey still renders. Order + spelling match the
// canonical seed in migration 122. Do not add to this by hand — new interests
// come from the database.
export const INTEREST_CATALOG_FALLBACK: readonly string[] = [
  "Finance & Business",
  "Social Events",
  "Music",
  "Art & Culture",
  "Social Justice & Activism",
  "Numbers & Economics",
  "Sports & Athletics",
  "Gaming",
  "Health & Wellness",
  "Environment",
  "Community Service",
  "Crafts",
  "Religion",
  "Technology and Computer",
  "Film & Media",
  "Photography",
  "Strategy and Critical Thinking",
  "Writing",
  "Fashion",
  "Debate & Politics",
  "Theater",
  "Travel & Languages",
] as const;
