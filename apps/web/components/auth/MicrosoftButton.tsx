"use client";

/** "Continue with Microsoft" — same four-square mark the mobile app draws. */
export function MicrosoftButton({
  onClick,
  disabled,
  loading,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full h-[52px] bg-white border border-black/10 rounded-full flex items-center justify-center gap-2.5 text-[15px] font-semibold text-black shadow-[0px_3px_4px_rgba(0,0,0,0.15)] hover:bg-gray-50 transition-colors disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0FA6A6]"
    >
      {loading ? (
        <span
          aria-hidden
          className="w-5 h-5 border-2 border-black/60 border-t-transparent rounded-full animate-spin"
        />
      ) : (
        <>
          <span aria-hidden className="grid grid-cols-2 gap-[1.5px] w-[18px] h-[18px]">
            <span className="w-2 h-2" style={{ backgroundColor: "#F25022" }} />
            <span className="w-2 h-2" style={{ backgroundColor: "#7FBA00" }} />
            <span className="w-2 h-2" style={{ backgroundColor: "#00A4EF" }} />
            <span className="w-2 h-2" style={{ backgroundColor: "#FFB900" }} />
          </span>
          Continue with Microsoft
        </>
      )}
    </button>
  );
}
