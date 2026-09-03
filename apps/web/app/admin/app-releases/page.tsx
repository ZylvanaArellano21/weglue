import { getAppReleasesOverview } from "../../../lib/admin/appReleasesData";
import { SectionCard, Badge, EmptyState } from "../../../components/admin/primitives";
import { Table, Th, Td } from "../../../components/admin/Table";
import { AppReleasesActions } from "../../../components/admin/AppReleasesActions";
import type { Platform } from "../../../lib/admin/appReleasesData";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const ANDROID_MANUAL_ONLY = "android_store_detection_manual_only";

function checkStatus(platform: Platform, checkedAt: string | null, ok: boolean | null, error: string | null): string {
  if (platform === "android" && error === ANDROID_MANUAL_ONLY) return "Manual publish required";
  if (!checkedAt) return "No check recorded";
  if (!ok) return "Last check failed";
  if (Date.now() - new Date(checkedAt).getTime() > 2 * 60 * 60 * 1000) return "Check is stale";
  return "Healthy";
}

export default async function AdminAppReleasesPage() {
  const { releases, currentByPlatform, lastCheckByPlatform } = await getAppReleasesOverview();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">App Releases</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Controls the native-app Update badge and its push notification. Publishing a version here
          immediately sends a real push to every eligible user on that platform — see{" "}
          <code className="rounded bg-gray-100 px-1 text-xs">app_releases</code>.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SectionCard title="iOS">
          <div className="p-4">
            {currentByPlatform.ios ? (
              <Badge tone="green">Current: {currentByPlatform.ios}</Badge>
            ) : (
              <Badge tone="gray">No public release yet</Badge>
            )}
            <p className="mt-2 text-xs text-gray-500">Last checked: {fmtDate(lastCheckByPlatform.ios?.checkedAt ?? null)}</p>
            <p className={`mt-1 text-xs ${checkStatus("ios", lastCheckByPlatform.ios?.checkedAt ?? null, lastCheckByPlatform.ios?.ok ?? null, lastCheckByPlatform.ios?.error ?? null) === "Healthy" ? "text-green-700" : "text-amber-700"}`}>
              {checkStatus("ios", lastCheckByPlatform.ios?.checkedAt ?? null, lastCheckByPlatform.ios?.ok ?? null, lastCheckByPlatform.ios?.error ?? null)}
            </p>
          </div>
        </SectionCard>
        <SectionCard title="Android">
          <div className="p-4">
            {currentByPlatform.android ? (
              <Badge tone="green">Current: {currentByPlatform.android}</Badge>
            ) : (
              <Badge tone="gray">No public release yet</Badge>
            )}
            <p className="mt-2 text-xs text-gray-500">Last checked: {fmtDate(lastCheckByPlatform.android?.checkedAt ?? null)}</p>
            <p className="mt-1 text-xs text-amber-700">
              {checkStatus("android", lastCheckByPlatform.android?.checkedAt ?? null, lastCheckByPlatform.android?.ok ?? null, lastCheckByPlatform.android?.error ?? null)}
            </p>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Publish a new release">
        <div className="p-4">
          <AppReleasesActions />
        </div>
      </SectionCard>

      <SectionCard title="History" className="overflow-hidden">
        {releases.length === 0 ? (
          <EmptyState icon="📦" title="No releases yet" message="Publish a version above to get started." />
        ) : (
          <Table
            head={
              <>
                <Th>Platform</Th>
                <Th>Version</Th>
                <Th>Status</Th>
                <Th>Source</Th>
                <Th>Released</Th>
              </>
            }
          >
            {releases.map((r) => (
              <tr key={r.id} className="text-gray-700">
                <Td>{r.platform === "ios" ? "iOS" : "Android"}</Td>
                <Td className="font-mono">{r.version}</Td>
                <Td>
                  {r.isPublic ? <Badge tone="green">Public</Badge> : <Badge tone="gray">Not public</Badge>}
                </Td>
                <Td>
                  {r.source === "store" ? <Badge tone="blue">Auto-detected</Badge> : <Badge tone="gray">Manual</Badge>}
                </Td>
                <Td>{fmtDate(r.releasedAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
