import Link from "next/link";
import { notFound } from "next/navigation";
import { getNotificationDetail } from "../../../../lib/admin/messagingData";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard } from "../../../../components/admin/primitives";
import { DisabledAction } from "../../../../components/admin/DisabledAction";
import { NotificationReadToggle } from "../../../../components/admin/NotificationActions";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const CAT_TONE: Record<string, "blue" | "teal" | "green" | "amber" | "neutral"> = {
  social: "blue",
  clubs: "green",
  events: "amber",
  messages: "teal",
  social_proof: "neutral",
  account: "neutral",
};

function targetLabel(entityType: string | null): string {
  if (entityType === "event") return "Event";
  if (entityType === "club") return "Club";
  if (entityType === "message") return "Message / conversation";
  return "—";
}

export default async function AdminNotificationDetailPage({ params }: { params: { id: string } }) {
  const n = await getNotificationDetail(params.id);
  if (!n) notFound();

  return (
    <div className="space-y-5">
      <Link href="/admin/notifications" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-600">
        ← Back to Notifications
      </Link>

      <div className="flex flex-wrap items-start gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-teal-50 text-3xl">🔔</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-gray-900">{n.type}</h1>
            {n.category ? <Badge tone={CAT_TONE[n.category] ?? "gray"}>{n.category}</Badge> : null}
            {n.read ? <Badge tone="gray">Read</Badge> : <Badge tone="teal">Unread</Badge>}
            {n.group_count > 1 ? <Badge tone="neutral">grouped ×{n.group_count}</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-gray-600">{n.title || <span className="text-gray-400">No summary text</span>}</p>
          {n.description ? <p className="mt-0.5 text-xs text-gray-400">{n.description}</p> : null}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <SectionCard title="Recipient" className="md:col-span-1">
          <div className="p-4">
            <Link href={`/admin/users/${n.recipient_id}`} className="flex items-center gap-3 hover:opacity-80">
              <Avatar uri={n.recipient_avatar} name={n.recipient_name} size={44} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{n.recipient_name || `@${n.recipient_username}`}</p>
                <p className="truncate text-xs text-gray-500">@{n.recipient_username}</p>
                {n.recipient_email ? <p className="truncate text-xs text-gray-400">{n.recipient_email}</p> : null}
              </div>
            </Link>
            <Link href={`/admin/users/${n.recipient_id}`} className="mt-3 inline-block text-sm text-teal-600 hover:underline">
              View recipient →
            </Link>
          </div>
        </SectionCard>

        <SectionCard title="Details" className="md:col-span-2">
          <dl className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Type">{n.type}</Field>
            <Field label="Category">{n.category}</Field>
            <Field label="Actor">
              {n.actor_id ? (
                <Link href={`/admin/users/${n.actor_id}`} className="text-teal-700 hover:underline">
                  {n.actor_name || `@${n.actor_username}`}
                </Link>
              ) : (
                <span className="text-gray-400">System / no actor</span>
              )}
            </Field>
            <Field label="Related target">
              {n.admin_link ? (
                <Link href={n.admin_link} className="text-teal-700 hover:underline">
                  {targetLabel(n.entity_type)} →
                </Link>
              ) : (
                targetLabel(n.entity_type)
              )}
            </Field>
            <Field label="Deep-link destination">{n.route?.screen ? String(n.route.screen) : <span className="text-gray-400">—</span>}</Field>
            <Field label="Read state">{n.read ? "Read" : "Unread"}</Field>
            <Field label="Created">{fmtDateTime(n.created_at)}</Field>
            <Field label="Read at">{fmtDateTime(n.read_at)}</Field>
            <Field label="Seen at">{fmtDateTime(n.seen_at)}</Field>
          </dl>
        </SectionCard>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <SectionCard title="Delivery">
          <div className="p-4">
            {n.delivery ? (
              <div className="flex flex-wrap gap-4 text-sm">
                <DeliveryStat label="Queued" value={n.delivery.queued} />
                <DeliveryStat label="Sent" value={n.delivery.sent} />
                <DeliveryStat label="Pending" value={n.delivery.pending} />
                <DeliveryStat label="Failed" value={n.delivery.failed} />
              </div>
            ) : (
              <p className="text-sm text-gray-500">No push-delivery rows for this notification (in-app only, or no push queued).</p>
            )}
            <p className="mt-3 text-xs text-gray-400">
              Delivery status is metadata only. Raw device push tokens are never exposed in this dashboard. Token diagnostics, if needed, live in a
              future Data Health surface.
            </p>
          </div>
        </SectionCard>

        <SectionCard title="Actions">
          <div className="space-y-4 p-4">
            <NotificationReadToggle notificationId={n.id} read={n.read} />
            <p className="text-xs text-gray-400">
              Marking read/unread writes to the canonical <code>notifications.read</code> / <code>read_at</code> with a read-back and audit event, and
              requires the write kill switch to be enabled.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <DisabledAction
                label="Remove notification"
                reason="Removal is disabled: push_queue rows cascade on delete, so removing a notification could corrupt pending delivery state"
              />
              <DisabledAction label="Resend notification" reason="No approved admin resend function exists; the delivery pipeline is not driven from here" />
              <DisabledAction label="Show push token" reason="Raw device tokens are never exposed in the normal UI" tone="danger" />
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function DeliveryStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">{value}</p>
    </div>
  );
}
