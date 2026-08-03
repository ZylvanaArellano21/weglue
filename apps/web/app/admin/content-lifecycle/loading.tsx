export default function ContentLifecycleLoading() {
  return (
    <div className="animate-pulse space-y-5" aria-label="Loading content lifecycle">
      <div className="h-7 w-52 rounded bg-gray-200" />
      <div className="h-10 rounded-lg bg-gray-100" />
      <div className="h-72 rounded-xl border border-gray-200 bg-white" />
    </div>
  );
}
