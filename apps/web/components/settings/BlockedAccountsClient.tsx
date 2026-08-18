"use client";

import Link from "next/link";
import { AppHeader } from "../home/AppHeader";
import { ToastProvider, useToast } from "../shared/Toast";
import { useBlockedUsers, useUnblockUser } from "../../lib/hooks/useBlocking";
import {
  BLOCKED_EMPTY_TITLE,
  BLOCKED_EMPTY_BODY,
  unblockConfirmMessage,
  type BlockedUser,
} from "../../lib/blocking";

export function BlockedAccountsClient({ userId }: { userId: string }): JSX.Element {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <AppHeader userId={userId} />
        <Body userId={userId} />
      </div>
    </ToastProvider>
  );
}

function Body({ userId }: { userId: string }): JSX.Element {
  const show = useToast();
  const { data, isLoading, isError, refetch, isFetching } = useBlockedUsers(userId);
  const { mutate: unblock, isPending, variables } = useUnblockUser(userId);

  const onUnblock = (item: BlockedUser) => {
    if (!window.confirm(unblockConfirmMessage(item.username))) return;
    unblock(item.user_id, {
      onSuccess: () => show("Unblocked."),
      onError: () => show("Couldn’t unblock. Please try again.", "error"),
    });
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6">
        <Link href="/profile" className="text-sm font-semibold text-[#0FA6A6] hover:underline">
          ← Profile
        </Link>
        <h1 className="mt-3 text-xl font-semibold text-gray-900">Blocked Accounts</h1>
        <p className="mt-1 text-sm text-gray-500">
          People you’ve blocked can’t message you or find your profile. They aren’t told.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-14 animate-pulse rounded-xl bg-black/5" />
          <div className="h-14 animate-pulse rounded-xl bg-black/5" />
        </div>
      ) : isError ? (
        // An honest failure with a retry. Rendering the empty state here would
        // claim "you have blocked nobody" when the request merely failed.
        <div className="rounded-xl border border-gray-100 bg-white p-8 text-center">
          <p className="text-base font-semibold text-gray-900">
            Couldn’t load your blocked accounts
          </p>
          <p className="mt-2 text-sm text-gray-500">Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="mt-5 rounded-full bg-[#0FA6A6] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isFetching ? "Retrying…" : "Try again"}
          </button>
        </div>
      ) : (data ?? []).length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-white p-10 text-center">
          <p className="text-base font-semibold text-gray-900">{BLOCKED_EMPTY_TITLE}</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-gray-500">
            {BLOCKED_EMPTY_BODY}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100 bg-white">
          {(data ?? []).map((item) => {
            // Disable only the row being submitted, so one in-flight unblock
            // cannot freeze the whole list.
            const pending = isPending && variables === item.user_id;
            return (
              <li key={item.user_id} className="flex items-center gap-3 px-4 py-3">
                {item.avatar_url && !item.avatar_url.startsWith("preset:") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.avatar_url}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0FA6A6]/10 text-sm font-semibold text-[#0FA6A6]">
                    {(item.full_name || item.username || "?").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {item.full_name?.trim() || item.username}
                  </p>
                  <p className="truncate text-xs text-gray-500">@{item.username}</p>
                </div>
                {/* Deliberately NOT a link to the profile: that route resolves
                    to the neutral unavailable state, so a tap would look broken. */}
                <button
                  type="button"
                  onClick={() => onUnblock(item)}
                  disabled={pending}
                  aria-label={`Unblock ${item.username}`}
                  className="shrink-0 rounded-full border border-[#0FA6A6] px-4 py-1.5 text-xs font-semibold text-[#0FA6A6] hover:bg-[#0FA6A6]/5 disabled:opacity-50"
                >
                  {pending ? "…" : "Unblock"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
