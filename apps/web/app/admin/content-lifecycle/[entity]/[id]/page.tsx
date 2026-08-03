import Link from "next/link";
import { notFound } from "next/navigation";
import { LifecycleDetails } from "../../../../../components/admin/LifecycleDetails";
import { getContentLifecycleDetail, type LifecycleEntityType } from "../../../../../lib/admin/lifecycleData";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function entityType(value: string): LifecycleEntityType | null {
  return value === "post" || value === "comment" || value === "event" ? value : null;
}

export default async function AdminContentLifecycleDetailPage({
  params,
}: {
  params: { entity: string; id: string };
}) {
  const entity = entityType(params.entity);
  if (!entity) notFound();
  const result = await getContentLifecycleDetail(entity, params.id);
  if (result.available && !result.record) notFound();

  const canonicalHref = entity === "post" ? `/admin/posts/${params.id}` : entity === "comment" ? `/admin/comments/${params.id}` : `/admin/events/${params.id}`;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/content-lifecycle" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-700">
          ← Back to Content lifecycle
        </Link>
        {result.record && result.record.state !== "creator_deleted" && result.record.state !== "purged" ? (
          <Link href={canonicalHref} className="text-sm font-medium text-teal-700 hover:underline">
            View canonical admin detail →
          </Link>
        ) : null}
      </div>
      <div>
        <h1 className="text-xl font-semibold text-gray-900 capitalize">{entity} lifecycle</h1>
        <p className="mt-0.5 font-mono text-xs text-gray-500">{params.id}</p>
      </div>
      <LifecycleDetails result={result} />
    </div>
  );
}
