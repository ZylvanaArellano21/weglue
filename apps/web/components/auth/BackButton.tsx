"use client";

import { useRouter } from "next/navigation";

/** History-aware Back: returns to the page the user came from (preserving,
 * e.g., the signup form state), falling back to home on a direct visit. */
export function BackButton(): JSX.Element {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/");
      }}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0FA6A6] hover:opacity-80 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0FA6A6]"
    >
      <span aria-hidden className="text-lg leading-none">‹</span> Back
    </button>
  );
}
