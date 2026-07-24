import { notFound } from "next/navigation";
import { ADMIN_NAV } from "../../../lib/admin/nav";
import { ComingSoon } from "../../../components/admin/primitives";

// Catch-all for every not-yet-built single-segment admin section. Static routes
// like /admin/users and /admin/clubs take priority over this dynamic segment, so
// only unbuilt sections land here — each renders a polished Coming-Soon state
// instead of a broken route.
export default function AdminSectionPage({ params }: { params: { section: string } }) {
  const item = ADMIN_NAV.find((i) => i.href === `/admin/${params.section}`);
  if (!item || item.ready) notFound();
  return <ComingSoon label={item.label} day={item.day} icon={item.icon} />;
}
