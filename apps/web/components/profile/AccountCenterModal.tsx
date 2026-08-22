"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../shared/Modal";
import { useOwnProfile } from "../../lib/hooks/useOwnProfile";
import {
  useChangeEmail,
  useChangePassword,
  useChangeUsername,
  useUsernameAvailability,
} from "../../lib/hooks/useAccountCenter";
import { getSupabaseBrowser } from "../../lib/supabase-browser";

// ─── Account Center (web) ────────────────────────────────────────────────────
//
// Same four sections, same order, same copy and same backend as
// apps/mobile/app/account-center/index.tsx:
//
//   Email     → supabase.auth.updateUser({ email }) — a VERIFICATION link is
//               sent to the new address; the account email does not change
//               until that link is opened, so the field below keeps showing the
//               current, verified address the whole time.
//   Username  → profiles.username + username_changed_at (30-day cooldown),
//               with live availability checking.
//   Password  → supabase.auth.updateUser({ password }). Never stored anywhere.
//   Delete    → navigates to /account/delete, which is the SAME two-step,
//               type-DELETE flow the mobile screen runs and the same
//               `delete-account` Edge Function. It is deliberately not
//               re-implemented as a dialog here.

export function AccountCenterModal({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}): JSX.Element {
  const router = useRouter();
  const { data: profile } = useOwnProfile(userId);

  const [currentEmail, setCurrentEmail] = useState<string>("");

  const [emailInput, setEmailInput] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [emailMsg, setEmailMsg] = useState<Msg>(null);
  const [usernameMsg, setUsernameMsg] = useState<Msg>(null);
  const [passwordMsg, setPasswordMsg] = useState<Msg>(null);

  const changeEmail = useChangeEmail(userId);
  const changeUsername = useChangeUsername(userId);
  const changePassword = useChangePassword();
  const { availability, checking } = useUsernameAvailability(userId, usernameInput);

  // ── Verified-email sync (mirrors the mobile focus/foreground sync) ─────────
  // The displayed email comes from the auth session, so it never changes before
  // verification. Once the student opens the link in their mail app and comes
  // back to this tab, this refreshes the session and the field updates in under
  // a second — no logout, no manual reload.
  const syncingRef = useRef(false);
  const syncVerifiedEmail = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      const supabase = getSupabaseBrowser();
      const { data: sessionData } = await supabase.auth.getSession();
      const sessionEmail = sessionData.session?.user.email ?? "";
      const { data } = await supabase.auth.getUser();
      const freshEmail = data.user?.email ?? "";

      if (freshEmail && sessionData.session && sessionEmail !== freshEmail) {
        await supabase.auth.refreshSession();
        setCurrentEmail(freshEmail);
        setEmailMsg({ text: "Your email was updated successfully.", isError: false });
        return;
      }
      if (freshEmail) setCurrentEmail(freshEmail);
      else if (sessionEmail) setCurrentEmail(sessionEmail);
    } catch {
      // Background sync only — never surface errors for this.
    } finally {
      syncingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void syncVerifiedEmail();
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncVerifiedEmail();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [syncVerifiedEmail]);

  const onSubmitEmail = async () => {
    setEmailMsg(null);
    try {
      const result = await changeEmail.mutateAsync(emailInput);
      if (result.success) {
        setEmailMsg({
          text: "Verification sent. Check your inbox, spam, and junk folders for the email — your email will update after you verify it.",
          isError: false,
        });
        setEmailInput("");
      } else {
        setEmailMsg({ text: result.message, isError: true });
      }
    } catch {
      // changeEmail returns typed results, but keep a belt-and-braces catch so
      // an unexpected throw can never leave the button stuck.
      setEmailMsg({ text: "Something went wrong. Please try again.", isError: true });
    }
  };

  const onSubmitUsername = async () => {
    setUsernameMsg(null);
    try {
      const result = await changeUsername.mutateAsync(usernameInput);
      if (result.success) {
        setUsernameMsg({ text: "Username updated successfully.", isError: false });
        setUsernameInput("");
      } else {
        setUsernameMsg({ text: result.message, isError: true });
      }
    } catch {
      setUsernameMsg({ text: "Could not update your username. Please try again.", isError: true });
    }
  };

  const onSubmitPassword = async () => {
    setPasswordMsg(null);
    try {
      const result = await changePassword.mutateAsync({ newPassword, confirmPassword });
      if (result.success) {
        setPasswordMsg({ text: "Password updated successfully.", isError: false });
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPasswordMsg({ text: result.message, isError: true });
      }
    } catch {
      setPasswordMsg({ text: "Could not update your password. Please try again.", isError: true });
    }
  };

  const usernameTrimmed = usernameInput.trim();

  return (
    <Modal onClose={onClose} labelledBy="account-center-title" maxWidth={560}>
      <div className="px-4 pb-5 pt-5 sm:px-6 sm:pb-6">
        <h2
          id="account-center-title"
          className="mb-4 text-center text-[17px] font-bold text-gray-900"
        >
          Account Center
        </h2>

        {/* The panel scrolls INSIDE the dialog so a short viewport can always
            reach Delete Account (spec §15). */}
        <div className="max-h-[calc(100vh-11rem)] overflow-y-auto rounded-xl bg-[#FFFEF7] px-4 py-5 sm:px-6">
          {/* ── Email ────────────────────────────────────────────────────── */}
          <SectionLabel>Email</SectionLabel>
          <p className="mb-1 break-all text-[15px] font-medium text-gray-900">
            {currentEmail || "—"}
          </p>
          <Field
            id="ac-email"
            label="New email"
            type="email"
            autoComplete="email"
            value={emailInput}
            onChange={setEmailInput}
            placeholder="New email"
            disabled={changeEmail.isPending}
          />
          <Feedback msg={emailMsg} id="ac-email-msg" />
          <ActionButton
            onClick={onSubmitEmail}
            pending={changeEmail.isPending}
            disabled={!emailInput.trim()}
            pendingLabel="Sending verification…"
          >
            Change Email
          </ActionButton>

          <Divider />

          {/* ── Username ─────────────────────────────────────────────────── */}
          <SectionLabel>Username</SectionLabel>
          {profile?.username && (
            <p className="mb-2.5 text-[15px] font-medium text-gray-900">@{profile.username}</p>
          )}
          <Field
            id="ac-username"
            label="New username"
            autoComplete="off"
            value={usernameInput}
            onChange={setUsernameInput}
            placeholder="New username"
            disabled={changeUsername.isPending}
            describedBy="ac-username-hint"
          />
          <p id="ac-username-hint" aria-live="polite" className="mb-2 min-h-[18px] text-xs">
            {usernameTrimmed && checking && <span className="text-gray-500">Checking availability…</span>}
            {usernameTrimmed && !checking && availability && (
              <span style={{ color: availability.available ? "#0FA6A6" : "#F02719" }}>
                {availability.available ? "Available" : "Already taken"}
              </span>
            )}
          </p>
          <Feedback msg={usernameMsg} id="ac-username-msg" />
          <ActionButton
            onClick={onSubmitUsername}
            pending={changeUsername.isPending}
            disabled={!usernameTrimmed}
            pendingLabel="Updating…"
          >
            Change Username
          </ActionButton>

          <Divider />

          {/* ── Password ─────────────────────────────────────────────────── */}
          <SectionLabel>Change Password</SectionLabel>
          <Field
            id="ac-new-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={setNewPassword}
            placeholder="New password"
            disabled={changePassword.isPending}
          />
          <div className="h-2.5" />
          <Field
            id="ac-confirm-password"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Confirm password"
            disabled={changePassword.isPending}
          />
          <p className="mb-2 mt-2 text-xs leading-relaxed text-gray-500">
            At least 8 characters with one uppercase letter and one number.
          </p>
          <Feedback msg={passwordMsg} id="ac-password-msg" />
          <ActionButton
            onClick={onSubmitPassword}
            pending={changePassword.isPending}
            disabled={!newPassword || !confirmPassword}
            pendingLabel="Updating…"
          >
            Change Password
          </ActionButton>

          <Divider />

          {/* ── Delete ───────────────────────────────────────────────────── */}
          <SectionLabel>Delete Account</SectionLabel>
          <p className="mb-3.5 text-[13px] leading-relaxed text-gray-500">
            Permanently delete your account and all associated data. This cannot be undone.
          </p>
          <button
            type="button"
            onClick={() => {
              // The full warning, the list of what is destroyed and the typed
              // DELETE step need room to be read — same reason mobile puts them
              // on their own screen instead of in a dialog.
              onClose();
              router.push("/account/delete");
            }}
            className="h-12 w-full rounded-full bg-[#F02719] text-[15px] font-semibold text-white shadow-[0px_4px_4px_rgba(0,0,0,0.18)] transition-colors hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            Delete Account
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Small presentational pieces ─────────────────────────────────────────────

type Msg = { text: string; isError: boolean } | null;

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-gray-500">
      {children}
    </h3>
  );
}

function Divider(): JSX.Element {
  return <div className="my-7 h-px bg-black/[0.08]" />;
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  disabled,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  autoComplete?: string;
  disabled?: boolean;
  describedBy?: string;
}): JSX.Element {
  return (
    <>
      {/* Visually the reference shows placeholder-only fields; the label still
          exists for screen readers so every control has an accessible name. */}
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-xl border border-black/10 bg-white px-4 text-[15px] text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-teal focus-visible:ring-2 focus-visible:ring-teal/40 disabled:opacity-60"
      />
    </>
  );
}

function Feedback({ msg, id }: { msg: Msg; id: string }): JSX.Element {
  return (
    <p
      id={id}
      role={msg?.isError ? "alert" : undefined}
      aria-live="polite"
      className="mb-1 mt-2 min-h-[18px] text-[13px] leading-relaxed"
      style={{ color: msg?.isError ? "#F02719" : "#0FA6A6" }}
    >
      {msg?.text ?? ""}
    </p>
  );
}

function ActionButton({
  onClick,
  pending,
  disabled,
  pendingLabel,
  children,
}: {
  onClick: () => void | Promise<void>;
  pending: boolean;
  disabled: boolean;
  pendingLabel: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={pending || disabled}
      aria-busy={pending}
      className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-teal text-[15px] font-semibold text-white shadow-[0px_4px_4px_rgba(0,0,0,0.15)] transition-opacity hover:opacity-95 disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
    >
      {pending ? (
        <>
          <span
            aria-hidden
            className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
          />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
