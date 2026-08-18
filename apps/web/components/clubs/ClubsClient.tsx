"use client";

import { useMemo, useState } from "react";
import { ToastProvider, useToast } from "../shared/Toast";
import { AppHeader } from "../home/AppHeader";
import { ClubSidebar } from "./ClubSidebar";
import { ClubCatalog } from "./ClubCatalog";
import { LeaveClubDialog } from "./LeaveClubDialog";
import { useMyClubs, useDiscoveryClubs, useJoinClubFromCatalog } from "../../lib/hooks/useClubTab";
import type { SidebarClub, CatalogClub } from "../../lib/clubs/clubService";

// Root of the web Club tab. One shared search query filters the Officer/Member
// sidebar AND the Suggested/Popular catalog simultaneously (spec §6) — matching
// clubs stay exactly where they are, non-matches disappear, empty sections hide.
// Suggested excludes joined clubs; Popular keeps them (shows "Joined").
export function ClubsClient({ userId, scrollToSuggested }: { userId: string; scrollToSuggested?: boolean }): JSX.Element {
  return (
    <ToastProvider>
      <Body userId={userId} scrollToSuggested={scrollToSuggested} />
    </ToastProvider>
  );
}

function Body({ userId, scrollToSuggested }: { userId: string; scrollToSuggested?: boolean }): JSX.Element {
  // Unread-summary, notifications, and my-clubs realtime are owned once for
  // the whole session by Providers (useSessionRealtimeHub), not remounted here.
  const show = useToast();
  const { data: mine } = useMyClubs(userId);
  const { data: catalog } = useDiscoveryClubs(userId);
  const join = useJoinClubFromCatalog(userId);

  const [query, setQuery] = useState("");
  // The club whose Unjoin confirmation is open, if any.
  const [leaving, setLeaving] = useState<{ id: string; name: string } | null>(null);
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
    <>
      {/* From `lg` up the Clubs tab is a FIXED-height shell: the document itself
          never scrolls. The club sidebar and the catalog are each their own
          `overflow-y-auto` region, so a wheel over one moves only that one and
          the page never drags both together. `min-h-0` is required on every
          descendant in the chain — without it a flex/grid child refuses to
          shrink and the scroll silently falls back to the document.
          Below `lg` the sidebar is not rendered at all, so normal document flow
          is kept for tablet and phone widths. */}
      <div className="flex min-h-screen flex-col bg-cream pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0 lg:h-[100dvh] lg:min-h-0 lg:overflow-hidden">
        <div className="shrink-0">
          <AppHeader userId={userId} />
        </div>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:pb-0">
          <div className="grid grid-cols-1 gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
            <div className="hidden lg:block lg:min-h-0 lg:overflow-y-auto lg:pb-6">
              <ClubSidebar
                officerClubs={officerClubs}
                memberClubs={memberClubs}
                query={query}
                onQueryChange={setQuery}
              />
            </div>
            <div className="lg:min-h-0 lg:overflow-y-auto lg:pb-6">
              <ClubCatalog
                suggested={suggested}
                popular={popular}
                onJoin={(club) =>
                  join.mutate(club.id, {
                    onSuccess: () => show("Joined club! 🎉"),
                    onError: () => show("Something went wrong. Try again.", "error"),
                  })
                }
                onLeave={(club) => setLeaving(club)}
                joiningId={join.isPending ? (join.variables ?? null) : null}
                hasQuery={q.length > 0}
                scrollToSuggested={scrollToSuggested}
              />
            </div>
          </div>
        </main>
      </div>

      {/* Unjoining from the catalog runs the SAME dialog the Club Profile uses,
          which runs the SAME useToggleClubMembership / leave_club RPC. There is
          one membership implementation, one confirmation copy and one
          only-officer guard; the shared query invalidation keeps the sidebar,
          the catalog, Home and the Club Profile in step afterwards. */}
      {leaving && (
        <LeaveClubDialog
          clubId={leaving.id}
          clubName={leaving.name}
          userId={userId}
          onClose={() => setLeaving(null)}
          onLeft={() => show("You left the club.")}
          onError={(message) => show(message, "error")}
        />
      )}
    </>
  );
}
