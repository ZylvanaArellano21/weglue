// Presentational building blocks for the Admin Dashboard. All server-safe (no
// client hooks) so they can be used directly inside Server Components.
import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "../shared/Avatar";

// ── Badge ────────────────────────────────────────────────────────────────────

type BadgeTone = "neutral" | "teal" | "green" | "amber" | "red" | "blue" | "gray";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-gray-100 text-gray-700 ring-gray-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
  green: "bg-green-50 text-green-700 ring-green-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  gray: "bg-gray-100 text-gray-500 ring-gray-200",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: number | string | null;
  hint?: string;
  href?: string;
}) {
  const display =
    value === null ? (
      <span className="text-base font-medium text-gray-400">Unavailable</span>
    ) : (
      <span className="text-2xl font-semibold tabular-nums text-gray-900">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
    );

  const body = (
    <div className="flex h-full flex-col justify-between rounded-xl border border-gray-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <div className="mt-2">{display}</div>
      {hint ? <p className="mt-1 text-xs text-gray-400">{hint}</p> : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

// ── Section card ─────────────────────────────────────────────────────────────

export function SectionCard({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white ${className}`}>
      {title ? (
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

// ── Empty / error states ─────────────────────────────────────────────────────

export function EmptyState({
  icon = "🔍",
  title,
  message,
}: {
  icon?: string;
  title: string;
  message?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="text-3xl">{icon}</div>
      <p className="mt-3 text-sm font-semibold text-gray-900">{title}</p>
      {message ? <p className="mt-1 max-w-sm text-sm text-gray-500">{message}</p> : null}
    </div>
  );
}

// ── Definition list field ────────────────────────────────────────────────────

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{children ?? <span className="text-gray-400">—</span>}</dd>
    </div>
  );
}

// ── Identity cell (avatar + name) ────────────────────────────────────────────

export function IdentityCell({
  name,
  sub,
  avatarUrl,
  href,
}: {
  name: string;
  sub?: string | null;
  avatarUrl?: string | null;
  href?: string;
}) {
  const inner = (
    <div className="flex items-center gap-3">
      <Avatar uri={avatarUrl} name={name} size={32} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-900">{name}</p>
        {sub ? <p className="truncate text-xs text-gray-500">{sub}</p> : null}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="group block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ── Coming soon ──────────────────────────────────────────────────────────────

export function ComingSoon({ label, day, icon }: { label: string; day: number; icon: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-50 text-3xl">{icon}</div>
      <h1 className="mt-5 text-xl font-semibold text-gray-900">{label}</h1>
      <div className="mt-3">
        <Badge tone="teal">Scheduled for Day {day}</Badge>
      </div>
      <p className="mt-4 max-w-md text-sm text-gray-500">
        This section is part of the Admin Dashboard build plan and will come online on Day {day}. The
        navigation, authorization, and shell are already in place.
      </p>
    </div>
  );
}
