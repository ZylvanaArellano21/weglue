// Route-level loading state for the admin content area.
export default function AdminLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-7 w-48 rounded bg-gray-200" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-gray-200 bg-white" />
        ))}
      </div>
      <div className="h-64 rounded-xl border border-gray-200 bg-white" />
    </div>
  );
}
