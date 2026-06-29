import type { Metadata } from "next";
import ResetPasswordClient from "./ResetPasswordClient";

export const metadata: Metadata = {
  title: "Reset Password — We Glue",
};

export default function ResetPasswordPage() {
  return <ResetPasswordClient />;
}
