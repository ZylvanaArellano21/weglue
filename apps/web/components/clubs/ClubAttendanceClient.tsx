"use client";

import { useRouter } from "next/navigation";
import { useClubProfile } from "../../lib/hooks/useClubProfile";
import { QrShareScreen } from "../shared/QrShareScreen";

// ─── QR attendance (club ⋯ → QR attendance) ─────────────────────────────────
// One permanent link per club — the same QR works for every event. Deliberately
// simple per spec: club identity, the code, Download. No event history, no
// open/close controls, no other club-management affordances live here.
// Reuses the exact QrShareScreen every other web QR surface uses.
export function ClubAttendanceClient({ clubId, userId }: { clubId: string; userId: string }): JSX.Element {
  const router = useRouter();
  const { data: club, isLoading } = useClubProfile(clubId, userId);

  const checkinUrl = `https://weglue.app/checkin/${clubId}`;

  if (isLoading || !club) {
    return <div className="flex min-h-screen items-center justify-center bg-cream" />;
  }

  if (!club.is_officer) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cream p-6 text-center">
        <p className="text-[15px] text-gray-600">Only club officers and advisors can view this.</p>
        <button type="button" onClick={() => router.back()} className="font-semibold text-teal">
          Go back
        </button>
      </div>
    );
  }

  return (
    <QrShareScreen
      open
      onClose={() => router.push(`/club/${clubId}`)}
      title={club.name}
      subtitle="Attendance QR"
      url={checkinUrl}
      shareLabel="Share"
      shareMessage={`Scan to check in to ${club.name} events:`}
      fileName={`${club.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-attendance-qr`}
    />
  );
}
