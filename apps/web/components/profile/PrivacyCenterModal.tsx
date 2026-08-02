"use client";

import { useState } from "react";
import Link from "next/link";
import { Modal } from "../shared/Modal";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { ChevronRightIcon } from "../shared/icons";
import {
  usePrivacySettings,
  useSetHideEvents,
  useSetHideInterests,
  useSetPrivateAccount,
} from "../../lib/hooks/usePrivacyCenter";

// ─── Privacy Center (web) ────────────────────────────────────────────────────
//
// Same three controls, same wording and the same `user_privacy` row as
// apps/mobile/app/privacy-center/index.tsx. The descriptions and the
// Public/Private, Visible/Hidden value labels are the mobile strings verbatim —
// "private" is not reinterpreted here:
//
//   • Account visibility — going private gates only NEW follow requests
//     (they arrive as `pending` and need approval). Existing accepted follows
//     and Gluemates are NOT revoked. The one-time explainer says exactly that.
//   • Hide Interests / Hide Events — hide those sections from other students.
//     The owner still sees their own on their own profile.
//
// RLS is the actual boundary; these switches drive it, they do not replace it.

const PRIVATE_INFO_KEY = "weglue_private_info_seen";

export function PrivacyCenterModal({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}): JSX.Element {
  const { data: settings, isLoading, isError } = usePrivacySettings(userId);
  const setPrivate = useSetPrivateAccount(userId);
  const setHideInterests = useSetHideInterests(userId);
  const setHideEvents = useSetHideEvents(userId);

  const [privateInfoOpen, setPrivateInfoOpen] = useState(false);

  const onTogglePrivate = (value: boolean) => {
    if (value) {
      // One-time explainer, same as mobile's AsyncStorage-backed sheet.
      try {
        if (!window.localStorage.getItem(PRIVATE_INFO_KEY)) {
          setPrivateInfoOpen(true);
          window.localStorage.setItem(PRIVATE_INFO_KEY, "1");
        }
      } catch {
        // Private browsing / storage disabled — the toggle still works.
      }
    }
    setPrivate.mutate(value);
  };

  const isPrivate = settings?.is_private ?? false;
  const hideInterests = settings?.hide_interests ?? false;
  const hideEvents = settings?.hide_events ?? false;

  return (
    <Modal onClose={onClose} labelledBy="privacy-center-title" maxWidth={560}>
      <div className="px-4 pb-5 pt-5 sm:px-6 sm:pb-6">
        <h2
          id="privacy-center-title"
          className="mb-4 text-center text-[17px] font-bold text-gray-900"
        >
          Privacy Center
        </h2>

        <div className="max-h-[calc(100vh-11rem)] overflow-y-auto rounded-xl bg-[#FFFEF7] px-4 py-5 sm:px-6">
          {isLoading ? (
            // Never render a default-off switch before the real value loads —
            // that would briefly show a private account as Public.
            <div aria-live="polite" className="space-y-6 py-2">
              <span className="sr-only">Loading your privacy settings…</span>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-black/[0.05]" />
              ))}
            </div>
          ) : isError || !settings ? (
            <p role="alert" className="py-6 text-center text-sm text-[#F02719]">
              We couldn&apos;t load your privacy settings. Please close this and try again.
            </p>
          ) : (
            <>
              <ToggleRow
                id="privacy-account-visibility"
                title="Account visibility"
                description={
                  isPrivate
                    ? "Your profile is Private. New followers must request to follow you."
                    : "Your profile is Public. Anyone on campus can view your profile."
                }
                valueLabel={isPrivate ? "Private" : "Public"}
                checked={isPrivate}
                onChange={onTogglePrivate}
                busy={setPrivate.isPending}
              />

              <Divider />

              <ToggleRow
                id="privacy-hide-interests"
                title="Hide Interests"
                description={
                  hideInterests
                    ? "Your interests are hidden from other users."
                    : "Your interests are visible on your profile."
                }
                valueLabel={hideInterests ? "Hidden" : "Visible"}
                checked={hideInterests}
                onChange={(v) => setHideInterests.mutate(v)}
                busy={setHideInterests.isPending}
              />

              <Divider />

              <ToggleRow
                id="privacy-hide-events"
                title="Hide Events"
                description={
                  hideEvents
                    ? "Your weekly events are hidden from other users."
                    : "Your weekly events are visible on your profile."
                }
                valueLabel={hideEvents ? "Hidden" : "Visible"}
                checked={hideEvents}
                onChange={(v) => setHideEvents.mutate(v)}
                busy={setHideEvents.isPending}
              />

              <Divider />

              {/* Blocked Accounts — the ONLY surface where a block is ever
                  visible, and only to the student who created it. Same row and
                  same copy as the mobile Privacy Center. */}
              <Link
                href="/settings/blocked"
                onClick={onClose}
                className="flex items-center gap-4 rounded-lg py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                <span className="flex-1">
                  <span className="block text-[16px] font-bold text-gray-900">Blocked Accounts</span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-gray-500">
                    People you&apos;ve blocked can&apos;t message you or find your profile. They
                    aren&apos;t told.
                  </span>
                </span>
                <span className="text-gray-400" aria-hidden>
                  <ChevronRightIcon size={20} />
                </span>
              </Link>
            </>
          )}
        </div>
      </div>

      {privateInfoOpen && (
        <ConfirmDialog
          title="Going private"
          message="Going private does not remove existing Gluemates. Current accepted follows stay in place. Only new follow requests will need your approval."
          confirmLabel="Got it"
          cancelLabel="Close"
          onConfirm={() => setPrivateInfoOpen(false)}
          onCancel={() => setPrivateInfoOpen(false)}
        />
      )}
    </Modal>
  );
}

function Divider(): JSX.Element {
  return <div className="my-5 h-px bg-black/[0.08]" />;
}

function ToggleRow({
  id,
  title,
  description,
  valueLabel,
  checked,
  onChange,
  busy,
}: {
  id: string;
  title: string;
  description: string;
  valueLabel: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  busy?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-start gap-4 py-1">
      <div className="min-w-0 flex-1">
        <p id={`${id}-label`} className="text-[16px] font-bold text-gray-900">
          {title}
        </p>
        <p id={`${id}-desc`} className="mt-1 text-[13px] leading-relaxed text-gray-500">
          {description}
        </p>
        <p className="mt-1.5 text-[13px] font-semibold" style={{ color: "#0FA6A6" }}>
          {valueLabel}
        </p>
      </div>

      {/* A real switch: role + aria-checked expose the state to assistive tech,
          and Space/Enter operate it because it is a <button>. */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-desc`}
        disabled={busy}
        onClick={() => onChange(!checked)}
        className="relative mt-1 h-[30px] w-[52px] shrink-0 rounded-full border transition-colors disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        style={{
          background: checked ? "#0FA6A6" : "#E5E7EB",
          borderColor: checked ? "#0FA6A6" : "rgba(0,0,0,0.08)",
        }}
      >
        <span
          aria-hidden
          className="absolute top-1/2 block h-[24px] w-[24px] -translate-y-1/2 rounded-full bg-white shadow-sm transition-all"
          style={{ left: checked ? 25 : 2 }}
        />
      </button>
    </div>
  );
}
