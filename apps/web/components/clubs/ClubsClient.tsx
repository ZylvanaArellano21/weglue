"use client";

import { useMemo, useState } from "react";
import { ToastProvider } from "../shared/Toast";
import { AppHeader } from "../home/AppHeader";
import { ClubSidebar } from "./ClubSidebar";
import { ClubCatalog } from "./ClubCatalog";
import { useMyClubs, useDiscoveryClubs, useJoinClubFromCatalog } from "../../lib/hooks/useClubTab";
import { useUnreadSummary } from "../../lib/hooks/useUnreadSummary";
import { useRealtimeNotifications } from "../../lib/hooks/useNotifications";
import type { SidebarClub, CatalogClub } from "../../lib/clubs/clubService";

// Root of the web Club tab. One shared search query filters the Officer/Member
// sidebar AND the Suggested/Popular catalog simultaneously (spec §6) — matching
// clubs stay exactly where they are, non-matches disappear, empty sections hide.
// Suggested excludes joined clubs; Popular keeps them (shows "Joined").
export function ClubsClient({ userId, scrollToSuggested }: { userId: string; scrollToSuggested?: boolean }): JSX.Element {
  useUnreadSummary(userId); // live header badges
  useRealtimeNotifications(userId);

  const { data: mine } = useMyClubs(userId);
  const { data: catalog } = useDiscoveryClubs(userId);
  const join = useJoinClubFromCatalog(userId);

  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const matchesSidebar = (c: SidebarClub) =>
    !q || c.name.toLowerCase().includes(q) || (c.handle ?? "").toLowerCase().includes(q);
  const matchesCatalog = (c: CatalogClub) => !q || c.name.toLowerCase().includes(q);

  const officerClubs = useMemo(
    () => (mine?.officer_clubs ?? []).filter(matchesSidebar),
    [mine?.officer_clubs, q]
  );
  const memberClubs = useMemo(
    () => (mine?.member_clubs ?? []).filter(matchesSidebar),
    [mine?.member_clubs, q]
  );

  // Suggested = personalized catalog order, unjoined only (spec §7). Popular =
  // whole catalog by real member_count, joined + unjoined (spec §8). When idle
  // we cap the display for a clean grid; while searching we show every match so
  // nothing a user typed for gets hidden.
  const { suggested, popular } = useMemo(() => {
    const all = catalog ?? [];
    const suggestedAll = all.filter((c) => !c.is_member).filter(matchesCatalog);
    const popularAll = [...all]
      .sort((a, b) => b.member_count - a.member_count)
      .filter(matchesCatalog);
    return {
      suggested: q ? suggestedAll : suggestedAll.slice(0, 9),
      popular: q ? popularAll : popularAll.slice(0, 9),
    };
  }, [catalog, q]);

  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream">
        <AppHeader userId={userId} />
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="hidden lg:block">
              <ClubSidebar
                officerClubs={officerClubs}
                memberClubs={memberClubs}
                query={query}
                onQueryChange={setQuery}
              />
            </div>
            <div>
              <ClubCatalog
                suggested={suggested}
                popular={popular}
                onJoin={(id) => join.mutate(id)}
                joiningId={join.isPending ? (join.variables ?? null) : null}
                hasQuery={q.length > 0}
                scrollToSuggested={scrollToSuggested}
              />
            </div>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
