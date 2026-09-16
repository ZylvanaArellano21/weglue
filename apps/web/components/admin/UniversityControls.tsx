"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../shared/Modal";
import { ConfirmAction } from "./ConfirmAction";
import { addUniversity, editUniversity, setUniversityActive } from "../../lib/admin/actions";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export type CampusEmailMode = "block_educational" | "allowlist";

export interface CampusPolicyDraft {
  emailMode: CampusEmailMode;
  emailDomains: string[];
  emailDeniedMessage: string;
}

function UniversityForm({
  heading,
  initialName,
  initialSlug,
  initialPolicy,
  submitLabel,
  onSubmit,
  onClose,
  requireReason = false,
}: {
  heading: string;
  initialName: string;
  initialSlug: string;
  /** Present only where the email rule is editable (Edit, not Add). */
  initialPolicy?: CampusPolicyDraft;
  submitLabel: string;
  onSubmit: (
    name: string,
    slug: string,
    reason: string,
    policy?: CampusPolicyDraft
  ) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  /** Require a typed reason (recorded permanently in the audit trail). */
  requireReason?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [slugTouched, setSlugTouched] = useState(initialSlug.length > 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [emailMode, setEmailMode] = useState<CampusEmailMode>(
    initialPolicy?.emailMode ?? "block_educational"
  );
  const [domainsText, setDomainsText] = useState(
    (initialPolicy?.emailDomains ?? []).join(", ")
  );
  const [deniedMessage, setDeniedMessage] = useState(
    initialPolicy?.emailDeniedMessage ?? ""
  );
  /** Synchronous re-entrancy latch, same rationale as ConfirmAction. */
  const inFlight = useRef(false);

  const trimmedReason = reason.trim();
  const reasonValid = !requireReason || (trimmedReason.length >= 3 && trimmedReason.length <= 500);

  function submit() {
    if (!reasonValid) {
      setError("Enter a reason of at least 3 characters.");
      return;
    }
    // Set BEFORE the async call so a same-tick second submit cannot re-enter.
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    // block_educational must send an EMPTY domain list, not an absent one: the
    // RPC treats absent as "unchanged", which would leave stale domains behind
    // and be refused by the shape constraint.
    const policy: CampusPolicyDraft | undefined = initialPolicy
      ? {
          emailMode,
          emailDomains:
            emailMode === "allowlist"
              ? domainsText.split(",").map((d) => d.trim()).filter(Boolean)
              : [],
          emailDeniedMessage: deniedMessage,
        }
      : undefined;
    onSubmit(name, slug, trimmedReason, policy)
      .then((res) => {
        if (res.ok) {
          onClose();
          router.refresh();
        } else setError(res.error ?? "Something went wrong.");
      })
      .catch(() => setError("Something went wrong."))
      .finally(() => {
        inFlight.current = false;
        setPending(false);
      });
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

        {/* Who may join this campus. The database enforces the same rule via
            campus_email_allowed(), at signup and at every email change. */}
        {initialPolicy ? (
          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <div>
              <label
                htmlFor="university-email-mode"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500"
              >
                Email rule
              </label>
              <select
                id="university-email-mode"
                value={emailMode}
                onChange={(e) => setEmailMode(e.target.value as CampusEmailMode)}
                disabled={pending}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
              >
                <option value="block_educational">
                  Any address that is not school-issued
                </option>
                <option value="allowlist">Only specific domains</option>
              </select>
            </div>

            {emailMode === "allowlist" ? (
              <>
                <div>
                  <label
                    htmlFor="university-email-domains"
                    className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500"
                  >
                    Accepted domains <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="university-email-domains"
                    value={domainsText}
                    onChange={(e) => setDomainsText(e.target.value)}
                    disabled={pending}
                    placeholder="tamu.edu"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Comma-separated. Matched exactly — a subdomain like
                    mail.tamu.edu is NOT accepted unless you list it too.
                  </p>
                </div>
                <div>
                  <label
                    htmlFor="university-denied-message"
                    className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500"
                  >
                    Rejection message <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="university-denied-message"
                    value={deniedMessage}
                    onChange={(e) => setDeniedMessage(e.target.value)}
                    disabled={pending}
                    rows={2}
                    maxLength={200}
                    placeholder="Use your Texas A&M email address (@tamu.edu) to join this campus."
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Shown to a student whose address is refused, on every
                    platform.
                  </p>
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-500">
                School-issued addresses are refused and the shared message is
                shown. This is the rule Lone Star has used since launch.
              </p>
            )}
          </div>
        ) : null}

        {requireReason ? (
          <div>
            <label htmlFor="university-reason" className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              id="university-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={pending}
              rows={3}
              maxLength={500}
              placeholder="Why is this university being created? Recorded permanently in the audit trail."
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-gray-400">
              {trimmedReason.length}/500 · recorded permanently and cannot be edited or deleted. Never include
              passwords, codes, or links containing tokens.
            </p>
          </div>
        ) : null}
        {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            disabled={pending || name.trim().length < 2 || slug.trim().length < 2 || !reasonValid}
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
          requireReason
          onSubmit={(name, slug, reason) => addUniversity(name, slug, reason)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function EditUniversityDialog({
  id,
  name,
  slug,
  policy,
}: {
  id: string;
  name: string;
  slug: string;
  policy: CampusPolicyDraft;
}) {
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
          initialPolicy={policy}
          submitLabel="Save"
          onSubmit={(n, s, _reason, p) =>
            editUniversity(id, {
              name: n,
              slug: s,
              emailMode: p?.emailMode,
              emailDomains: p?.emailDomains,
              emailDeniedMessage: p?.emailDeniedMessage,
            })
          }
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function UniversityActiveToggle({ id, isActive, name }: { id: string; isActive: boolean; name: string }) {
  return isActive ? (
    <ConfirmAction
      label="Deactivate"
      title="Deactivate university?"
      body="It will be marked inactive. Existing users and clubs keep their association; this does not delete any data."
      confirmLabel="Deactivate"
      tone="danger"
      requireReason
      targetSummary={name}
      run={(reason) => setUniversityActive(id, false, reason)}
    />
  ) : (
    <ConfirmAction
      label="Activate"
      title="Activate university?"
      body="It will be marked active and available for onboarding."
      confirmLabel="Activate"
      requireReason
      targetSummary={name}
      run={(reason) => setUniversityActive(id, true, reason)}
    />
  );
}
