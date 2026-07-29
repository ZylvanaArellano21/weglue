"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../shared/Modal";
import { ConfirmAction } from "./ConfirmAction";
import { addUniversity, editUniversity, setUniversityActive } from "../../lib/admin/actions";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function UniversityForm({
  heading,
  initialName,
  initialSlug,
  submitLabel,
  onSubmit,
  onClose,
}: {
  heading: string;
  initialName: string;
  initialSlug: string;
  submitLabel: string;
  onSubmit: (name: string, slug: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [slugTouched, setSlugTouched] = useState(initialSlug.length > 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setPending(true);
    setError(null);
    onSubmit(name, slug)
      .then((res) => {
        if (res.ok) {
          onClose();
          router.refresh();
        } else setError(res.error ?? "Something went wrong.");
      })
      .catch(() => setError("Something went wrong."))
      .finally(() => setPending(false));
  }

  return (
    <Modal onClose={() => (pending ? null : onClose())} maxWidth={440}>
      <div className="space-y-4 p-5">
        <h3 className="text-base font-semibold text-gray-900">{heading}</h3>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Name</label>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Slug</label>
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
          <p className="mt-1 text-xs text-gray-400">Lowercase words separated by hyphens.</p>
        </div>
        {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            disabled={pending || name.trim().length < 2 || slug.trim().length < 2}
            onClick={submit}
            className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
          >
            {pending ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function AddUniversityDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-teal-500 bg-teal-500 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-teal-600"
      >
        ＋ Add university
      </button>
      {open ? (
        <UniversityForm
          heading="Add university"
          initialName=""
          initialSlug=""
          submitLabel="Create"
          onSubmit={(name, slug) => addUniversity(name, slug)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function EditUniversityDialog({ id, name, slug }: { id: string; name: string; slug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
        Edit
      </button>
      {open ? (
        <UniversityForm
          heading="Edit university"
          initialName={name}
          initialSlug={slug}
          submitLabel="Save"
          onSubmit={(n, s) => editUniversity(id, { name: n, slug: s })}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function UniversityActiveToggle({ id, isActive }: { id: string; isActive: boolean }) {
  return isActive ? (
    <ConfirmAction
      label="Deactivate"
      title="Deactivate university?"
      body="It will be marked inactive. Existing users and clubs keep their association; this does not delete any data."
      confirmLabel="Deactivate"
      tone="danger"
      run={() => setUniversityActive(id, false)}
    />
  ) : (
    <ConfirmAction
      label="Activate"
      title="Activate university?"
      body="It will be marked active and available for onboarding."
      confirmLabel="Activate"
      run={() => setUniversityActive(id, true)}
    />
  );
}
