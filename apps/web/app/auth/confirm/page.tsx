import { Suspense } from "react";
import type { Metadata } from "next";
import FragmentConfirm from "./FragmentConfirm";

export const metadata: Metadata = {
  title: "Confirm your email — We Glue",
};

// Thin server shell. All verification happens client-side in FragmentConfirm
// (see the note there) so an email scanner's plain GET can never consume the
// one-time confirmation token before the person taps the link.
export default function AuthConfirmPage(): JSX.Element {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Zain:wght@700&display=swap');
        .font-zain { font-family: 'Zain', serif; }
      `}</style>
      <Suspense
        fallback={
          <main className="min-h-screen bg-[#FEFCF0] flex items-center justify-center">
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "#0FA6A6", borderTopColor: "transparent" }}
            />
          </main>
        }
      >
        <FragmentConfirm />
      </Suspense>
    </>
  );
}
