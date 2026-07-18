// Minimal inline SVG icon set (Ionicons-equivalent glyphs used across the
// mobile app) so the web bundle stays self-contained with no icon dependency.

type IconProps = { size?: number; className?: string; filled?: boolean; strokeWidth?: number };

function svgProps({ size = 20, className, strokeWidth = 1.8 }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
}

export function HomeIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)} fill={p.filled ? "currentColor" : "none"}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

export function PeopleIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)} fill={p.filled ? "currentColor" : "none"}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M15.5 14.5A5 5 0 0 1 21 20" />
    </svg>
  );
}

export function ChatIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)} fill={p.filled ? "currentColor" : "none"}>
      <path d="M4 5h16v11H8l-4 3.5V5Z" />
    </svg>
  );
}

export function SearchIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

export function CloseIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function PlusIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CalendarIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </svg>
  );
}

export function LocationIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function BookmarkIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)} fill={p.filled ? "currentColor" : "none"}>
      <path d="M6 4h12v17l-6-4-6 4V4Z" />
    </svg>
  );
}

export function ImageIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="m5 18 5-5 3.5 3.5L16 14l3.5 4" />
    </svg>
  );
}

export function HeartIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)} fill={p.filled ? "currentColor" : "none"}>
      <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z" />
    </svg>
  );
}

export function CommentIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 5h16v11H9l-5 3.5V5Z" />
    </svg>
  );
}
