// Web port of apps/mobile/components/shared/CountBadge.tsx — the single numeric
// unread badge. Same rules as mobile: a small solid-red TRUE circle with a
// small white centered number, capped at "9+", and rendering NOTHING at
// count <= 0 (no decorative badges without a meaningful count).

const BADGE_SIZE = 18;

export function CountBadge({
  count,
  label,
  className,
  style,
}: {
  count: number;
  /** Accessible description, e.g. "unread notifications". */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}): JSX.Element | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const text = count > 9 ? "9+" : String(count);
  const widen = text.length > 1;

  return (
    <span
      role="status"
      aria-label={label ? `${count} ${label}` : String(count)}
      className={className}
      style={{
        minWidth: BADGE_SIZE,
        height: BADGE_SIZE,
        borderRadius: BADGE_SIZE / 2,
        padding: widen ? "0 4px" : 0,
        background: "#EF4444",
        color: "#fff",
        fontSize: 10,
        lineHeight: 1,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {text}
    </span>
  );
}
