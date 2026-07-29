import Link from "next/link";
import { runDataHealth, type HealthSeverity } from "../../../lib/admin/dataHealth";
import { SectionCard, Badge } from "../../../components/admin/primitives";
import { DisabledAction } from "../../../components/admin/DisabledAction";
import { DataHealthControls } from "../../../components/admin/DataHealthControls";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const SEV_TONE: Record<HealthSeverity, "red" | "amber" | "blue" | "green"> = {
  critical: "red",
  warning: "amber",
  info: "blue",
  ok: "green",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default async function AdminDataHealthPage() {
  const report = await runDataHealth();

  // Safe, content-free summary for the copy/export control.
  const exportSummary = {
    ranAt: report.ranAt,
    durationMs: report.durationMs,
    totals: report.totals,
    checks: report.checks.map((c) => ({
      key: c.key,
      severity: c.severity,
      affected: c.affected,
      scanned: c.scanned,
      capped: c.capped,
    })),
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Data Health</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Read-only integrity diagnostics. Bounded, MFA-gated, no private content — repairs are disabled on Day 5.
          </p>
        </div>
        <DataHealthControls summary={exportSummary} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["critical", "warning", "info", "ok"] as HealthSeverity[]).map((s) => (
          <div key={s} className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-lg font-semibold tabular-nums text-gray-900">{report.totals[s]}</p>
            <p className="text-xs capitalize text-gray-500">{s}</p>
          </div>
        ))}
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-lg font-semibold tabular-nums text-gray-900">{report.totals.affected.toLocaleString()}</p>
          <p className="text-xs text-gray-500">Affected rows</p>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Last scan: <span className="font-medium text-gray-600">{fmtTime(report.ranAt)}</span> · {report.durationMs} ms ·{" "}
        {report.checks.length} checks
      </p>

      <div className="space-y-3">
        {report.checks.map((c) => (
          <SectionCard key={c.key}>
            <div className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEV_TONE[c.severity]}>{c.severity}</Badge>
                  <h2 className="text-sm font-semibold text-gray-900">{c.title}</h2>
                  <span className="text-xs text-gray-400">· {c.category}</span>
                </div>
                <p className="mt-1 max-w-2xl text-sm text-gray-500">{c.description}</p>
                {c.examples.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {c.examples.map((ex) => (
                      <li key={ex.id} className="rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-600">
                        {ex.href ? (
                          <Link href={ex.href} className="hover:text-teal-600">{ex.label}</Link>
                        ) : (
                          ex.label
                        )}
                      </li>
                    ))}
                    {c.affected > c.examples.length ? (
                      <li className="px-2 py-1 text-xs text-gray-400">+{c.affected - c.examples.length} more</li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-2xl font-semibold tabular-nums text-gray-900">{c.affected.toLocaleString()}</p>
                <p className="text-xs text-gray-400">
                  affected / {c.scanned.toLocaleString()} scanned{c.capped ? " (capped)" : ""}
                </p>
                <div className="mt-2">
                  <DisabledAction label="Repair" reason="Review and dry-run required before repair." />
                </div>
              </div>
            </div>
          </SectionCard>
        ))}
      </div>

      <p className="text-xs text-gray-400">
        Each check scans a bounded window and shows at most a handful of examples. No authentication secrets, push
        tokens, or private deleted-message evidence are ever scanned or exposed. Automatic repair is intentionally not
        implemented on Day 5.{" "}
        <Link href="/admin/settings" className="text-teal-600 hover:underline">
          Admin Settings →
        </Link>
      </p>
    </div>
  );
}
