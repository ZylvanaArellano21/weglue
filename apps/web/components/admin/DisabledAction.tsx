// A visible-but-disabled action affordance. Day-1 dashboards surface future
// admin actions so the founder can see the roadmap, while clearly labeling why
// each is not yet available. Destructive actions are never wired up on Day 1.
export function DisabledAction({
  label,
  reason,
  tone = "default",
}: {
  label: string;
  reason: string;
  tone?: "default" | "danger";
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${
        tone === "danger" ? "border-red-100 bg-red-50/40" : "border-gray-200 bg-gray-50"
      }`}
    >
      <div className="min-w-0">
        <p className={`text-sm font-medium ${tone === "danger" ? "text-red-700" : "text-gray-700"}`}>{label}</p>
        <p className="truncate text-xs text-gray-400">{reason}</p>
      </div>
      <button
        type="button"
        disabled
        aria-disabled="true"
        title={reason}
        className="ml-3 shrink-0 cursor-not-allowed rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-400"
      >
        Unavailable
      </button>
    </div>
  );
}
