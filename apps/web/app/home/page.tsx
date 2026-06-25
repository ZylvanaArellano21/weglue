import { redirect } from "next/navigation";

// Legacy route: redirect to the main dashboard
export default function HomePage() {
  redirect("/dashboard");
}
