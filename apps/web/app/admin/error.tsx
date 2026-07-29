"use client";

// Route-level error boundary for the admin content area. Any thrown error
// (including a failed data read) lands here with a retry affordance.
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-2xl">⚠️</div>
      <h1 className="mt-5 text-lg font-semibold text-gray-900">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-gray-500">
        This admin view failed to load its data. This can happen if a query timed out or the service is
        temporarily unavailable.
      </p>
      {error?.digest ? <p className="mt-1 text-xs text-gray-400">Ref: {error.digest}</p> : null}
      <button
        onClick={reset}
        className="mt-6 rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600"
      >
        Try again
      </button>
    </div>
  );
}
