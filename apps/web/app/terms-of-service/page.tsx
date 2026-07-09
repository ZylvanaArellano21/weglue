import { redirect } from "next/navigation";

export const metadata = {
  title: "Terms & Conditions — We Glue",
};

// Legacy path — the single legal document (Terms + Privacy Policy) lives at
// /terms. Redirect so every old link lands on the up-to-date document.
export default function TermsOfServicePage(): never {
  redirect("/terms");
}
