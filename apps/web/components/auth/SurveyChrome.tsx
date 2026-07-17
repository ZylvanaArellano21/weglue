"use client";

import Link from "next/link";

/** Top bar shared by the two survey steps: Cancel · Survey · Log In. */
export function SurveyTopBar(): JSX.Element {
  return (
    <div className="relative flex items-center justify-between mb-8">
      <Link
        href="/get-started"
        className="text-[19px] font-semibold text-[#0FA6A6] hover:opacity-80 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0FA6A6]"
      >
        Cancel
      </Link>
      <span className="absolute left-1/2 -translate-x-1/2 top-[38px] text-[19px] font-semibold text-[#0FA6A6]">
        Survey
      </span>
      <Link
        href="/login"
        className="bg-[#0FA6A6] text-white text-[17px] font-semibold px-8 py-2.5 rounded-full shadow-[0px_3px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        Log In
      </Link>
    </div>
  );
}

/** The two-segment progress bar. `filled` = how many segments are teal. */
export function SurveyProgress({
  filled,
  step,
}: {
  filled: 1 | 2;
  step: string;
}): JSX.Element {
  return (
    <div className="mt-6">
      <div className="flex gap-10">
        <div className="h-[10px] flex-1 rounded-full bg-[#0FA6A6]" />
        <div
          className={`h-[10px] flex-1 rounded-full ${
            filled === 2 ? "bg-[#0FA6A6]" : "bg-[#E4E2D9]"
          }`}
        />
      </div>
      <p className="text-[15px] font-semibold text-[#3F3D3D] mt-4">{step}</p>
    </div>
  );
}

/** One survey chip. Cream/white default, teal when selected. */
export function SurveyChip({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className={`px-[22px] py-[11px] rounded-full text-[17px] font-semibold transition-colors shadow-[0px_3px_4px_rgba(0,0,0,0.25)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0FA6A6] ${
        selected
          ? "bg-[#0FA6A6] text-white"
          : "bg-[#FFFEF7] text-black hover:bg-white"
      }`}
    >
      {label}
    </button>
  );
}
