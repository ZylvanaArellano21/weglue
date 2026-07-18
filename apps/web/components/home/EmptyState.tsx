// Screenshot-consistent empty state (adapts the mobile Events empty state:
// a simple emoji + title + subtitle). Never leave a blank panel.
export function EmptyState({
  emoji,
  title,
  subtitle,
}: {
  emoji: string;
  title: string;
  subtitle?: string;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center px-8 py-14 text-center">
      <span className="mb-3 text-4xl" aria-hidden>
        {emoji}
      </span>
      <p className="text-base font-semibold text-gray-700 font-zain">{title}</p>
      {subtitle && <p className="mt-1 text-sm text-gray-400">{subtitle}</p>}
    </div>
  );
}
