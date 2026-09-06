"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../shared/Modal";
import { ConfirmAction } from "./ConfirmAction";
import { Badge } from "./primitives";
import {
  assignClubInterest,
  setClubInterestTier,
  removeClubInterest,
} from "../../lib/admin/interestsActions";
import type { ClubInterestRow } from "../../lib/admin/interestsData";

const teal = "#0f766e";

export function ClubInterestControls({
  clubId,
  clubName,
  assigned,
  assignable,
}: {
  clubId: string;
  clubName: string;
  assigned: ClubInterestRow[];
  assignable: { id: string; slug: string; label: string }[];
}) {
  const router = useRouter();
  const primary = assigned.filter((a) => a.tier === "primary");
  const secondary = assigned.filter((a) => a.tier === "secondary");

  return (
    <div className="space-y-5 p-4">
      <p className="text-sm text-gray-500">
        Primary interests match <strong>strongly</strong> (weight 3); secondary
        interests match as <strong>related</strong> (weight 1). A student’s club
        matches rank by how much their selected interests overlap here.
      </p>

      <TierBlock
        title="Primary"
        tone="teal"
        rows={primary}
        clubId={clubId}
        clubName={clubName}
        emptyHint="Add at least one primary interest so this club can be matched."
      />
      <TierBlock
        title="Secondary"
        tone="neutral"
        rows={secondary}
        clubId={clubId}
        clubName={clubName}
        emptyHint="No secondary interests."
      />

      <AssignInterest clubId={clubId} clubName={clubName} assignable={assignable} onDone={() => router.refresh()} />
    </div>
  );
}

function TierBlock({
  title,
  tone,
  rows,
  clubId,
  clubName,
  emptyHint,
}: {
  title: string;
  tone: "teal" | "neutral";
  rows: ClubInterestRow[];
  clubId: string;
  clubName: string;
  emptyHint: string;
}) {
  const other: "primary" | "secondary" = title === "Primary" ? "secondary" : "primary";
  const otherShort = other === "primary" ? "P" : "S";
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyHint}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {rows.map((r) => (
            <li
              key={r.interest_id}
              className="flex items-center gap-2 rounded-full border border-gray-200 bg-white py-1 pl-3 pr-1.5 text-sm"
            >
              <span className={r.is_active ? "text-gray-800" : "text-gray-400 line-through"}>
                {r.label}
              </span>
              {!r.is_active && <Badge tone="neutral">inactive</Badge>}
              <button
                type="button"
                title={`Move to ${other}`}
                onClick={async () => {
                  await setClubInterestTier(clubId, r.interest_id, other);
                  location.reload();
                }}
                className="rounded-full px-1.5 text-[11px] font-medium text-teal-700 hover:bg-teal-50"
              >
                → {otherShort}
              </button>
              <ConfirmAction
                label={<span aria-hidden>×</span>}
                size="xs"
                tone="danger"
                title="Remove interest from club"
                requireReason
                targetSummary={`${r.label} — ${clubName}`}
                body="This club stops matching students who chose this interest (unless it’s also on another tier). The interest itself is not affected."
                confirmLabel="Remove"
                run={(reason) => removeClubInterest(clubId, r.interest_id, reason)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssignInterest({
  clubId,
  clubName,
  assignable,
  onDone,
}: {
  clubId: string;
  clubName: string;
  assignable: { id: string; slug: string; label: string }[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [tier, setTier] = useState<"primary" | "secondary">("primary");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = assignable.filter((a) =>
    a.label.toLowerCase().includes(term.trim().toLowerCase()),
  );

  async function assign(interestId: string) {
    setPendingId(interestId);
    setError(null);
    const res = await assignClubInterest(clubId, interestId, tier);
    setPendingId(null);
    if (res.ok) {
      setOpen(false);
      setTerm("");
      onDone();
    } else {
      setError(res.error);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={assignable.length === 0}
        className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        style={{ background: teal }}
      >
        Assign interest
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} maxWidth={460}>
          <div className="p-5">
            <h2 className="mb-1 text-base font-semibold text-gray-900">Assign interest</h2>
            <p className="mb-3 text-xs text-gray-500">to {clubName}</p>

            <div className="mb-3 flex gap-2">
              {(["primary", "secondary"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                    tier === t ? "text-white" : "border border-gray-300 text-gray-600"
                  }`}
                  style={tier === t ? { background: teal } : undefined}
                >
                  {t}
                </button>
              ))}
            </div>

            <input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search interests…"
              className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/40"
            />
            {error && <p className="mb-2 text-xs font-medium text-red-600">{error}</p>}
            <ul className="max-h-64 overflow-y-auto">
              {filtered.length === 0 ? (
                <li className="px-1 py-2 text-sm text-gray-400">No matching active interests.</li>
              ) : (
                filtered.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      disabled={pendingId !== null}
                      onClick={() => assign(a.id)}
                      className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      <span>{a.label}</span>
                      <span className="text-xs text-teal-700">
                        {pendingId === a.id ? "Assigning…" : `Add as ${tier}`}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </Modal>
      )}
    </>
  );
}
