import Link from "next/link";
import { listInterests, type ListInterestsParams } from "../../../lib/admin/interestsData";
import { SectionCard, Badge, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Table, Th, Td } from "../../../components/admin/Table";
import { AddInterestButton, InterestRowActions } from "../../../components/admin/InterestControls";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminInterestsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);
  const params: ListInterestsParams = {
    search: get("q"),
    status: (get("status") as ListInterestsParams["status"]) ?? "all",
  };

  const interests = await listInterests(params);
  const activeCount = interests.filter((i) => i.is_active).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Interests</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            The shared catalog behind both interest surveys and club matching.{" "}
            {activeCount} active · {interests.length - activeCount} inactive. Changes take effect with
            no app or web deploy.
          </p>
        </div>
        <AddInterestButton />
      </div>

      <ListControls
        searchPlaceholder="Search by name or slug…"
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ],
          },
        ]}
      />

      <SectionCard className="overflow-hidden">
        {interests.length === 0 ? (
          <EmptyState icon="🎯" title="No interests match" />
        ) : (
          <Table
            head={
              <>
                <Th>Interest</Th>
                <Th>Slug</Th>
                <Th>Status</Th>
                <Th>Clubs (primary / secondary)</Th>
                <Th>Created</Th>
                <Th />
              </>
            }
          >
            {interests.map((i) => (
              <tr key={i.id} className="text-gray-700">
                <Td>
                  <span className={i.is_active ? "font-medium text-gray-900" : "text-gray-400"}>
                    {i.label}
                  </span>
                </Td>
                <Td className="font-mono text-xs text-gray-500">{i.slug}</Td>
                <Td>
                  {i.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                </Td>
                <Td className="tabular-nums">
                  <Link href={`/admin/clubs?interest=${i.id}`} className="hover:text-teal-700">
                    {i.primary_clubs} / {i.secondary_clubs}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap text-gray-500">{fmtDate(i.created_at)}</Td>
                <Td>
                  <InterestRowActions interest={i} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
