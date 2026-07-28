import Link from "next/link";
import { reportStatusCounts } from "../../../lib/admin/data2";
import { SectionCard, Badge } from "../../../components/admin/primitives";
import { DisabledAction } from "../../../components/admin/DisabledAction";

export const dynamic = "force-dynamic";

// Restriction types the product may eventually support. Day-2 scope only
// implements systems that already exist canonically — and none do yet — so each
// is shown honestly as unsupported rather than faked.
const RESTRICTION_TYPES = [
  { label: "Suspend account", reason: "No suspension column/table in current schema" },
  { label: "Timeout (temporary)", reason: "No timeout system in current schema" },
  { label: "Block user", reason: "No blocks table in current schema" },
  { label: "Shadow restriction", reason: "No shadow-restriction system — will not fake one" },
  { label: "Content restriction", reason: "No content-restriction table in current schema" },
  { label: "Club restriction", reason: "No club-restriction table in current schema" },
  { label: "Report-based sanction", reason: "Report triage exists; sanction linkage not yet modeled" },
];

export default async function AdminRestrictionsPage() {
  const reports = await reportStatusCounts();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Restrictions</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Account/content restriction systems are <span className="font-medium">not yet part of the canonical schema</span>.
          Nothing is faked here — each restriction type is shown as unsupported until a real, safe mechanism ships.
        </p>
      </div>

      <SectionCard
        title="Report triage — the only restriction-adjacent system that exists today"
        action={
          <Link href="/admin/reports" className="text-xs text-teal-600 hover:underline">
            Open Reports →
          </Link>
        }
      >
        <div className="p-4">
          <p className="mb-3 text-sm text-gray-500">
            The closest existing canonical signal is <code className="rounded bg-gray-100 px-1 text-xs">reports.status</code>.
            The full moderation queue lives in <Link href="/admin/reports" className="text-teal-600 hover:underline">Reports</Link>;
            a report → sanction workflow is future work (no canonical sanction table exists).
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["pending", "reviewing", "resolved", "dismissed"] as const).map((s) => (
              <Link
                key={s}
                href={`/admin/reports?status=${s}`}
                className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 transition hover:border-teal-200"
              >
                <p className="text-lg font-semibold tabular-nums text-gray-900">{(reports[s] ?? 0).toLocaleString()}</p>
                <p className="text-xs capitalize text-gray-500">{s}</p>
              </Link>
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Restriction types">
        <div className="p-4">
          <div className="mb-3">
            <Badge tone="amber">Not supported in current schema</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {RESTRICTION_TYPES.map((r) => (
              <DisabledAction key={r.label} label={r.label} reason={r.reason} />
            ))}
          </div>
          <p className="mt-4 text-xs text-gray-400">
            Building any of these requires a canonical restrictions table with audit + expiration, an explicit product
            decision, and safe cross-platform (iOS/Android/web) enforcement. Tracked in the V2 backlog — no shadowban or
            hidden behavior will be invented.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
