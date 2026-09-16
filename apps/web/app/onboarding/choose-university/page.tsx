"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type Campus, retryIdempotent, toCampuses } from "@weglue/shared";
import { createClient } from "../../../lib/supabase/client";
import {
  readOnboardingState,
  writeOnboardingState,
} from "../../../lib/onboardingState";

/**
 * First step of signup: which campus is this account being created on.
 *
 * The campus is chosen BEFORE the interest survey so everything downstream —
 * the match preview, the email rule applied to the address, and the membership
 * the auth trigger creates — is already campus-correct. It is read from
 * `list_active_campuses()`, never hardcoded, because campus ids differ between
 * environments and a campus can be activated without shipping a release.
 */
export default function ChooseUniversityPage(): JSX.Element {
  const router = useRouter();

  const [campuses, setCampuses] = useState<Campus[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    setCampuses(null);
    try {
      const rows = await retryIdempotent(async () => {
        const { data, error } = await createClient().rpc("list_active_campuses");
        if (error) throw error;
        return data;
      });
      const list = toCampuses(rows);
      setCampuses(list);
      if (list.length === 0) setFailed(true);

      // A campus kept from a previous visit is only still valid if it is still
      // on the active list — otherwise the user would carry a stale slug into
      // signup, where the backend would reject it with nothing on screen
      // explaining why.
      const stored = readOnboardingState().campusSlug;
      if (stored && list.some((c) => c.slug === stored)) setChoice(stored);
    } catch {
      setCampuses([]);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleNext() {
    if (!choice) return;
    writeOnboardingState({ campusSlug: choice });
    router.push("/onboarding/interests");
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] px-4 pb-10">
      {/* Brand top-left */}
      <div className="flex items-center gap-2 pt-4 pl-2 sm:pt-6 sm:pl-8">
        <Image
          src="/logo.png"
          alt=""
          width={64}
          height={58}
          className="w-9 h-8 sm:w-16 sm:h-[58px]"
          priority
        />
        <span
          className="text-[17px] sm:text-[22px] font-bold text-[#0FA6A6]"
          style={{ fontFamily: "var(--font-zain)" }}
        >
          We Glue
        </span>
      </div>

      <div className="text-center mt-6 sm:mt-4 px-2">
        <h1 className="text-[24px] sm:text-[32px] font-bold text-[#0FA6A6]">
          Choose your university
        </h1>
        <p className="text-[14px] sm:text-[18px] font-semibold text-black mt-2 sm:mt-3 max-w-[30rem] mx-auto">
          Your campus decides the clubs, events and people you see on We Glue.
        </p>
      </div>

      <div className="max-w-[406px] mx-auto mt-7 sm:mt-9 bg-[#FFFEF7] shadow-[0px_18px_60px_rgba(0,0,0,0.25)] px-6 py-8">
        {campuses === null ? (
          <div className="flex justify-center py-10" aria-live="polite">
            <span
              aria-label="Loading universities"
              role="status"
              className="w-7 h-7 border-2 border-[#0FA6A6] border-t-transparent rounded-full animate-spin"
            />
          </div>
        ) : failed ? (
          <div className="flex flex-col gap-5 text-center" aria-live="polite">
            <p className="text-sm font-semibold text-black">
              We couldn&apos;t load the list of universities. Check your
              connection and try again.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="w-full h-[52px] bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-base rounded-full shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <fieldset className="flex flex-col gap-3">
              <legend className="sr-only">Select your university</legend>
              {campuses.map((campus) => {
                const selected = choice === campus.slug;
                return (
                  <label
                    key={campus.slug}
                    htmlFor={`campus-${campus.slug}`}
                    className={`flex items-center gap-3.5 min-h-[68px] px-4 py-4 rounded-[10px] bg-[#FEFCF0] cursor-pointer shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors ${
                      selected
                        ? "border-2 border-[#0FA6A6]"
                        : "border border-black/20 hover:border-black/40"
                    }`}
                  >
                    <input
                      type="radio"
                      id={`campus-${campus.slug}`}
                      name="campus"
                      value={campus.slug}
                      checked={selected}
                      onChange={() => setChoice(campus.slug)}
                      className="w-[18px] h-[18px] accent-[#0FA6A6] shrink-0"
                    />
                    <span
                      className={`text-sm font-semibold ${
                        selected ? "text-[#0FA6A6]" : "text-black"
                      }`}
                    >
                      {campus.name}
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <button
              type="button"
              onClick={handleNext}
              disabled={!choice}
              className="w-full h-[52px] bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-base rounded-full shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors disabled:opacity-60 disabled:hover:bg-[#0FA6A6] flex items-center justify-center mt-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Next
            </button>

            <p className="text-center text-xs font-semibold text-black mt-5">
              Already have an account?{" "}
              <Link href="/login" className="text-[#0FA6A6] hover:underline">
                Log in
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
