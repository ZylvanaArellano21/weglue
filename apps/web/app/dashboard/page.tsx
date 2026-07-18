import { redirect } from "next/navigation";

// /dashboard is now a legacy alias — the real experience lives at /home so the
// logo, first-login routing and every "Home" affordance share one canonical URL.
export default function DashboardPage(): never {
  redirect("/home");
}
