"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CatalogCard } from "./CatalogCard";
import type { CatalogClub } from "../../lib/clubs/clubService";

// The main Club-tab catalog (spec §7/§8): "Suggested for you" (only clubs the
// user has NOT joined, personalized by the get_discovery_clubs interest-overlap
// ranking) and "Popular at your school" (the same catalog re-sorted by real
// member_count — joined clubs stay and show "Joined"). Both are filtered live by
// the shared Club-tab search query; a section with zero matches hides itself.
export function ClubCatalog({
  suggested,
  popular,
  onJoin,
  onLeave,
  joiningId,
  hasQuery,
  scrollToSuggested,
}: {
  suggested: CatalogClub[];
  popular: CatalogClub[];
  onJoin: (club: CatalogClub) => void;
  onLeave: (club: CatalogClub) => void;
  joiningId: string | null;
  hasQuery: boolean;
  scrollToSuggested?: boolean;
}): JSX.Element {
  const router = useRouter();
  const nothing = suggested.length === 0 && popular.length === 0;

  // Returning from the interests rerun (spec §10) lands the user at the freshly
  // refreshed Suggested section. Scroll once, after Suggested has rendered.
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrollToSuggested && !scrolledRef.current && suggested.length > 0) {
      scrolledRef.current = true;
      document.getElementById("suggested")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [scrollToSuggested, suggested.length]);

  return (
    <div>
      {suggested.length > 0 && (
        <section id="suggested" className={scrollToSuggested ? "scroll-mt-24" : undefined}>
          <h2 className="text-2xl font-bold text-gray-900">Suggested for you</h2>
          <p className="mt-1 text-sm text-gray-600">
            Doesn&apos;t match your interests?{" "}
            <button
              type="button"
              onClick={() => router.push("/interests")}
              className="font-semibold text-teal hover:underline"
            >
              Click here
            </button>
          </p>
          <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {suggested.map((club) => (
              <CatalogCard key={`s-${club.id}`} club={club} onJoin={onJoin} onLeave={onLeave} joining={joiningId === club.id} />
            ))}
          </div>
        </section>
      )}

      {suggested.length > 0 && popular.length > 0 && (
        <hr className="my-8" style={{ borderColor: "rgba(0,0,0,0.08)" }} />
      )}

      {popular.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold text-gray-900">Popular at your school</h2>
          <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {popular.map((club) => (
              <CatalogCard key={`p-${club.id}`} club={club} onJoin={onJoin} onLeave={onLeave} joining={joiningId === club.id} />
            ))}
          </div>
        </section>
      )}

      {nothing && (
        <p className="py-16 text-center text-gray-500">
          {hasQuery ? "No clubs found" : "No clubs to show yet."}
        </p>
      )}
    </div>
  );
}
