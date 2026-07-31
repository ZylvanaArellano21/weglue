"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../shared/Modal";
import { createChannel, renameChannel, deleteEmptyChannel, setChannelPermission } from "../../lib/admin/messagingActions";
import { ConfirmAction } from "./ConfirmAction";

const inputCls =
  "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100";

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">{children}</label>;
}

/** Create a new hashtag channel under a conversation. */
export function CreateChannelDialog({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setPending(true);
    setError(null);
    createChannel(conversationId, name)
      .then((res) => {
        if (res.ok) {
          setOpen(false);
          setName("");
          router.refresh();
        } else setError(res.error);
      })
      .catch(() => setError("Something went wrong."))
      .finally(() => setPending(false));
  }

  return (
    <>
      <button
        onClick={() => {
          setName("");
          setError(null);
          setOpen(true);
        }}
        className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        + New channel
      </button>
      {open ? (
        <Modal onClose={() => (pending ? null : setOpen(false))} maxWidth={460}>
          <div className="space-y-4 p-5">
            <h3 className="text-base font-semibold text-gray-900">Create channel</h3>
            <div>
              <Label>Channel name</Label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. events" className={inputCls} />
              <p className="mt-1 text-xs text-gray-400">Lowercased, spaces become hyphens (like #events). Main chat is never created here.</p>
            </div>
            {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button
                disabled={pending || name.trim().length < 1}
                onClick={submit}
                className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
              >
                {pending ? "Creating…" : "Create channel"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Rename + permission + delete-empty controls for a single channel. */
export function ChannelManageActions({
  channelId,
  name,
  kind,
  permission,
  isEmpty,
}: {
  channelId: string;
  name: string;
  kind: string;
  permission: string;
  isEmpty: boolean;
}) {
  const router = useRouter();
  const isMain = kind === "main";

  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState(name);
  const [perm, setPerm] = useState(permission);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function doRename() {
    setPending(true);
    setError(null);
    renameChannel(channelId, newName)
      .then((res) => {
        if (res.ok) {
          setRenameOpen(false);
          router.refresh();
        } else setError(res.error);
      })
      .catch(() => setError("Something went wrong."))
      .finally(() => setPending(false));
  }

  function doPermission(next: string) {
    setPending(true);
    setError(null);
    setPerm(next);
    setChannelPermission(channelId, next)
      .then((res) => {
        if (res.ok) router.refresh();
        else {
          setPerm(permission);
          setError(res.error);
        }
      })
      .catch(() => {
        setPerm(permission);
        setError("Something went wrong.");
      })
      .finally(() => setPending(false));
  }

  if (isMain) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
        <p className="text-sm font-medium text-gray-700">Main chat</p>
        <p className="text-xs text-gray-400">The Main chat is permanent — it can’t be renamed, restricted, or removed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setNewName(name);
            setError(null);
            setRenameOpen(true);
          }}
          className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Rename
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Posting:</span>
          <select value={perm} onChange={(e) => doPermission(e.target.value)} disabled={pending} className="rounded-lg border border-gray-200 py-1.5 pl-2 pr-7 text-sm text-gray-700 outline-none focus:border-teal-400">
            <option value="everyone">Everyone</option>
            <option value="officers">Officers only</option>
            {perm === "certain" ? <option value="certain">Certain members</option> : null}
          </select>
          {perm === "certain" ? <span className="text-xs text-gray-400">(allow-list managed in-app)</span> : null}
        </div>
      </div>

      {isEmpty ? (
        <ConfirmAction
          label="Remove empty channel"
          title="Remove this channel?"
          body="The channel holds no messages, so nothing is lost. This cannot be undone."
          confirmLabel="Remove channel"
          tone="danger"
          requireReason
          targetSummary={name}
          run={(reason) => deleteEmptyChannel(channelId, reason)}
        />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="text-xs text-gray-500">
            Removal is available only for empty channels. This channel holds messages, so removal stays disabled until the approved
            deleted-message lifecycle is deployed.
          </p>
        </div>
      )}

      {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      {renameOpen ? (
        <Modal onClose={() => (pending ? null : setRenameOpen(false))} maxWidth={420}>
          <div className="space-y-4 p-5">
            <h3 className="text-base font-semibold text-gray-900">Rename channel</h3>
            <div>
              <Label>New name</Label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} className={inputCls} />
            </div>
            {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <div className="flex justify-end gap-2">
              <button onClick={() => setRenameOpen(false)} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button
                disabled={pending || newName.trim().length < 1}
                onClick={doRename}
                className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save name"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
