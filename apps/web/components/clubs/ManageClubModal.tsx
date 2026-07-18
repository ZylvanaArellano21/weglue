"use client";

import { useState } from "react";
import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { SearchIcon } from "../shared/icons";
import { useToast } from "../shared/Toast";
import {
  useClubMemberList,
  useAddOfficer,
  useRemoveOfficer,
  useRemoveMember,
  useUniversityUserSearch,
} from "../../lib/hooks/useClubManagement";

// Officer-only member & officer management (spec §14/§18/§20). Every officer has
// identical power (no President-only paths). All actions call the same
// server-side RPCs/writes as mobile, which enforce authorization and the
// safeguard against removing the club's last officer. Confirmations gate the
// destructive removals, mirroring mobile.
export function ManageClubModal({
  clubId,
  userId,
  onClose,
}: {
  clubId: string;
  userId: string;
  onClose: () => void;
}): JSX.Element {
  const show = useToast();
  const { data: members } = useClubMemberList(clubId, true);
  const addOfficer = useAddOfficer(clubId, userId);
  const removeOfficer = useRemoveOfficer(clubId, userId);
  const removeMember = useRemoveMember(clubId, userId);

  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [roleTitle, setRoleTitle] = useState("Officer");
  // Inline (non-blocking) confirmation for destructive removals — no native
  // confirm() dialogs, which would be unpolished and can block automation.
  const [confirm, setConfirm] = useState<{ id: string; kind: "officer" | "member" } | null>(null);
  const { data: results } = useUniversityUserSearch(userId, query.trim(), query.trim().length >= 2);

  const officers = (members ?? []).filter((m) => m.role === "officer");
  const plainMembers = (members ?? []).filter((m) => m.role === "member");
  const memberIds = new Set((members ?? []).map((m) => m.id));

  const doAddOfficer = (targetUserId: string, title: string) =>
    addOfficer.mutate(
      { targetUserId, roleTitle: title.trim() || "Officer" },
      {
        onSuccess: () => {
          show("Officer added ✓");
          setPicked(null);
          setQuery("");
          setRoleTitle("Officer");
        },
        onError: () => show("Could not add officer. Try again.", "error"),
      }
    );

  const doRemoveOfficer = (targetUserId: string) => {
    setConfirm(null);
    removeOfficer.mutate(targetUserId, {
      onSuccess: () => show("Officer removed"),
      onError: (err: any) => {
        const msg = typeof err?.message === "string" ? err.message : "";
        show(
          msg.includes("cannot_remove_self")
            ? "To step down, leave the club from its profile."
            : "Could not remove officer. Try again.",
          "error"
        );
      },
    });
  };

  const doRemoveMember = (targetUserId: string) => {
    setConfirm(null);
    removeMember.mutate(targetUserId, {
      onSuccess: () => show("Member removed"),
      onError: () => show("Could not remove member. Try again.", "error"),
    });
  };

  // Renders either the row's normal actions or an inline Confirm/Cancel prompt.
  const removeControl = (id: string, kind: "officer" | "member", label: string, onConfirm: () => void) =>
    confirm?.id === id && confirm.kind === kind ? (
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-full bg-[#F02719] px-3 py-1 text-xs font-semibold text-white"
        >
          Confirm
        </button>
        <button type="button" onClick={() => setConfirm(null)} className="text-xs font-semibold text-gray-500 hover:underline">
          Cancel
        </button>
      </span>
    ) : (
      <button
        type="button"
        onClick={() => setConfirm({ id, kind })}
        className="rounded-full border border-[#F02719]/40 px-3 py-1 text-xs font-semibold text-[#F02719] hover:bg-[#F02719]/5"
      >
        {label}
      </button>
    );

  return (
    <Modal onClose={onClose} labelledBy="manage-club-title" maxWidth={560}>
      <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-6">
        <h2 id="manage-club-title" className="mb-4 text-xl font-bold text-gray-900">Manage members</h2>

        {/* Add officer */}
        <div className="mb-5 rounded-xl border border-gray-200 p-3">
          <p className="mb-2 text-sm font-semibold text-gray-800">Add an officer</p>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><SearchIcon size={16} /></span>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPicked(null);
              }}
              placeholder="Search people at your school"
              className="h-9 w-full rounded-full border border-gray-300 bg-white pl-9 pr-3 text-sm outline-none focus:ring-2"
            />
          </div>

          {picked ? (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-gray-700">Role for <b>{picked.name}</b>:</span>
              <input
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                className="h-8 w-32 rounded-lg border border-gray-300 px-2 text-sm outline-none focus:ring-2"
              />
              <button
                type="button"
                onClick={() => doAddOfficer(picked.id, roleTitle)}
                disabled={addOfficer.isPending}
                className="rounded-full bg-teal px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                Add
              </button>
              <button type="button" onClick={() => setPicked(null)} className="text-sm text-gray-500 hover:underline">Cancel</button>
            </div>
          ) : (
            query.trim().length >= 2 && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {(results ?? []).map((u) => {
                  const already = memberIds.has(u.id) && officers.some((o) => o.id === u.id);
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        disabled={already}
                        onClick={() => setPicked({ id: u.id, name: u.full_name || u.username })}
                        className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-black/[0.03] disabled:opacity-50"
                      >
                        <Avatar uri={u.avatar_url} size={32} name={u.full_name || u.username} />
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{u.full_name || u.username}</span>
                        {already && <span className="text-xs text-gray-400">officer</span>}
                      </button>
                    </li>
                  );
                })}
                {(results ?? []).length === 0 && <li className="p-2 text-sm text-gray-400">No matches</li>}
              </ul>
            )
          )}
        </div>

        {/* Officers */}
        <Section title={`Officers (${officers.length})`}>
          {officers.map((m) => (
            <Row key={m.id} m={m}>
              {m.id === userId ? (
                // Officers step down via the leave flow (which protects the
                // sole-officer case), never by removing their own officer row.
                <span className="text-xs font-semibold text-gray-400">You</span>
              ) : (
                removeControl(m.id, "officer", "Remove officer", () => doRemoveOfficer(m.id))
              )}
            </Row>
          ))}
        </Section>

        {/* Members */}
        <Section title={`Members (${plainMembers.length})`}>
          {plainMembers.length === 0 && <p className="py-2 text-sm text-gray-400">No other members.</p>}
          {plainMembers.map((m) => (
            <Row key={m.id} m={m}>
              {confirm?.id === m.id && confirm.kind === "member" ? null : (
                <button
                  type="button"
                  onClick={() => setPicked({ id: m.id, name: m.full_name || m.username })}
                  className="rounded-full border border-teal px-3 py-1 text-xs font-semibold text-teal hover:bg-teal/5"
                >
                  Make officer
                </button>
              )}
              {removeControl(m.id, "member", "Remove", () => doRemoveMember(m.id))}
            </Row>
          ))}
        </Section>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-5">
      <h3 className="mb-2 text-sm font-bold text-gray-900">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({
  m,
  children,
}: {
  m: { id: string; username: string; full_name: string; avatar_url: string | null; role: string };
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar uri={m.avatar_url} size={38} name={m.full_name || m.username} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900">{m.full_name || m.username}</p>
        <p className="truncate text-xs text-gray-500">@{m.username}</p>
      </div>
      {children}
    </div>
  );
}
