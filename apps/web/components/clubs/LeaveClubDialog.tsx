"use client";

import { useQuery } from "@tanstack/react-query";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { Modal } from "../shared/Modal";
import { useToggleClubMembership, OnlyOfficerError } from "../../lib/hooks/useClubProfile";
import { getSupabaseBrowser } from "../../lib/supabase-browser";

async function getLeaveEligibility(clubId: string, userId: string): Promise<{ isOfficer: boolean; onlyOfficer: boolean }> {
  const supabase = getSupabaseBrowser();
  const [{ data: membership, error: membershipError }, { count, error: countError }] = await Promise.all([
    supabase.from("club_members").select("role").eq("club_id", clubId).eq("user_id", userId).maybeSingle(),
    supabase.from("club_members").select("id", { count: "exact", head: true }).eq("club_id", clubId).eq("role", "officer"),
  ]);
  if (membershipError) throw membershipError;
  if (countError) throw countError;
  const isOfficer = (membership as { role?: string } | null)?.role === "officer";
  return { isOfficer, onlyOfficer: isOfficer && (count ?? 0) <= 1 };
}

/** The shared web implementation of mobile's leave-club host/modals.  The
 * preflight supplies the right copy, while leave_club and trigger 054 remain
 * the authoritative concurrent safety boundary. */
export function LeaveClubDialog({ clubId, clubName, userId, onClose, onLeft, onError }: { clubId: string; clubName: string; userId: string; onClose: () => void; onLeft: () => void; onError: (message: string) => void }): JSX.Element {
  const eligibility = useQuery({ queryKey: ["leaveClubEligibility", clubId, userId], queryFn: () => getLeaveEligibility(clubId, userId), staleTime: 0 });
  const membership = useToggleClubMembership(clubId, userId);
  const leave = () => membership.mutate({ join: false }, {
    onSuccess: () => { onLeft(); onClose(); },
    onError: (error) => {
      if (error instanceof OnlyOfficerError) { void eligibility.refetch(); return; }
      onError("Something went wrong. Try again.");
    },
  });
  if (eligibility.isLoading) return <Modal onClose={onClose} labelledBy="leave-loading"><p id="leave-loading" className="p-8 text-center text-sm text-gray-500">Checking club membership…</p></Modal>;
  if (eligibility.isError) return <Modal onClose={onClose} labelledBy="leave-error"><div className="p-8 text-center"><h2 id="leave-error" className="text-lg font-bold">Couldn&apos;t check club membership</h2><button type="button" onClick={onClose} className="mt-5 rounded-full bg-[#0FA6A6] px-5 py-2 text-sm font-semibold text-white">Close</button></div></Modal>;
  if (eligibility.data?.onlyOfficer) return <Modal onClose={onClose} labelledBy="only-officer"><div className="p-7 text-center"><h2 id="only-officer" className="text-xl font-bold text-gray-900">You&apos;re the only officer</h2><p className="mt-3 text-sm leading-relaxed text-gray-600">Assign another officer before leaving this club.</p><button type="button" onClick={onClose} className="mt-6 rounded-full bg-[#0FA6A6] px-6 py-2.5 text-sm font-semibold text-white">Got it</button></div></Modal>;
  return <ConfirmDialog title={eligibility.data?.isOfficer ? `Leave ${clubName}?` : `Are you sure you want to leave ${clubName}?`} message={eligibility.data?.isOfficer ? "You’ll lose access to:\n• Officer group chat\n• Posting events\n• Tagging / hosting events\n• Editing club\n• Members-only events (if you leave club)" : "You’ll lose access to club chats and updates."} confirmLabel={eligibility.data?.isOfficer ? "Leave & give up officer" : "Yes, Leave"} cancelLabel={eligibility.data?.isOfficer ? "Stay" : "No"} destructive loading={membership.isPending} onConfirm={leave} onCancel={onClose} />;
}
