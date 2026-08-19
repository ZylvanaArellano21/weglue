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

// Ionicons `chatbubble-outline` equivalent — the SAME rounded outline bubble the
// mobile Club Profile uses for its Group Chat / Officer Chat actions, so the web
// chat actions read as the same We Glue control, not a new desktop button.
export function ChatBubbleOutlineIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M20 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 20.5l1.9-4.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    </svg>
  );
}

// Ionicons `settings-outline` — the Account Center row in the mobile sidebar.
export function SettingsIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

// Ionicons `shield-outline` — the Privacy Center row in the mobile sidebar.
export function ShieldIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5V6L12 3Z" />
    </svg>
  );
}

// Ionicons `camera-outline` — the Camera option in the profile-picture editor.
export function CameraIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 8h3l1.5-2.2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13.2" r="3.4" />
    </svg>
  );
}

export function ChevronRightIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function ChevronLeftIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

/** Circled ✕ — clears / removes the current profile picture in the editor. */
export function CloseCircleIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </svg>
  );
}

// Ionicons `star-outline` equivalent — mobile marks the officer/admin chat with a
// star; the web Officer Chat pill overlays this on the chat bubble.
export function StarOutlineIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)} fill={p.filled ? "currentColor" : "none"}>
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />
    </svg>
  );
}

// ─── Messaging icons ────────────────────────────────────────────────────────
// Each of these is the web equivalent of the exact Ionicon the mobile chat
// screens use, so an action means the same thing and looks the same on both
// platforms. The mobile name is noted on every icon; changing one without the
// other is what produced the mismatched glyphs these replace.

/** Ionicons `attach` / `attach-outline` — composer attach + Files tab. */
export function PaperclipIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M20 11.5 12.4 19a4.5 4.5 0 0 1-6.4-6.4l7.9-7.8a3 3 0 0 1 4.3 4.3l-7.9 7.8a1.5 1.5 0 0 1-2.1-2.1L15.6 8" />
    </svg>
  );
}

/** Ionicons `list` — the composer's poll button on mobile. */
export function ListIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth={2.4} />
    </svg>
  );
}

/** Ionicons `checkbox-outline` — the Polls tab in chat details. */
export function CheckboxIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="m8 12 2.8 2.8L16.5 9" />
    </svg>
  );
}

/** Ionicons `notifications-off-outline` (outline) / `notifications-off` (on). */
export function BellIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)} fill={p.filled ? "currentColor" : "none"}>
      <path d="M18 8.5a6 6 0 0 0-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5Z" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    </svg>
  );
}

export function BellOffIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)} fill={p.filled ? "currentColor" : "none"}>
      <path d="M18 8.5a6 6 0 0 0-9.3-5" />
      <path d="M6 8.5c0 6-2 7.5-2 7.5h13" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

/** Ionicons `archive-outline` (outline) / `archive` (on). */
export function ArchiveIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)} fill={p.filled ? "currentColor" : "none"}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </svg>
  );
}

/** Ionicons `trash-outline` — direct-chat Delete. */
export function TrashIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** Ionicons `lock-closed-outline` — officer Permissions. */
export function LockIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** Ionicons `flag-outline` — Report. */
export function FlagIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M5 21V4" />
      <path d="M5 4.5h11l-2 4 2 4H5" />
    </svg>
  );
}

/** Ionicons `person-add-outline` — officer Add Person. */
export function PersonAddIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <circle cx="9.5" cy="8" r="3.6" />
      <path d="M3 20c0-3.4 2.9-5.6 6.5-5.6 1.3 0 2.5.3 3.5.8" />
      <path d="M17.5 14v6M14.5 17h6" />
    </svg>
  );
}

/** Ionicons `share-outline` — officer Share / invite. */
export function ShareIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M12 3v12" />
      <path d="m8.5 6.5 3.5-3.5 3.5 3.5" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

/** Ionicons `exit-outline` — Leave (custom group). */
export function ExitIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
      <path d="M10 8 6 12l4 4" />
      <path d="M6 12h9" />
    </svg>
  );
}

/** Ionicons `pricetag-outline` — a custom channel in the channel list. */
export function TagIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)} fill={p.filled ? "currentColor" : "none"}>
      <path d="M20 12.5 12.5 20a2 2 0 0 1-2.8 0l-5.7-5.7a2 2 0 0 1 0-2.8L11.5 4H20v8.5Z" />
      <circle cx="16.3" cy="7.7" r="1.3" fill={p.filled ? "#fff" : "currentColor"} stroke="none" />
    </svg>
  );
}

/** Ionicons `chatbubbles-outline` — the Main chat row in the channel list. */
export function ChatBubblesIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)} fill={p.filled ? "currentColor" : "none"}>
      <path d="M4 15.5V7a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H7L4 15.5Z" />
      <path d="M9 16.5v.5a2 2 0 0 0 2 2h6l3 2.5V14a2 2 0 0 0-2-2h-1" />
    </svg>
  );
}

/** Ionicons `megaphone-outline` — the officer-only posting notice. */
export function MegaphoneIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 10v4a1 1 0 0 0 1 1h3l7 4V5L8 9H5a1 1 0 0 0-1 1Z" />
      <path d="M18 9.5a3.5 3.5 0 0 1 0 5" />
    </svg>
  );
}

/** Ionicons `ellipsis-horizontal` — the chat-details overflow menu. */
export function EllipsisIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)} fill="currentColor" stroke="none">
      <circle cx="5.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.5" cy="12" r="1.7" />
    </svg>
  );
}

/** Ionicons `ban-outline` — Block, in the member-row action menu. */
export function BlockIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </svg>
  );
}

/** Ionicons `person-remove-outline` — Remove from group. */
export function PersonRemoveIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <circle cx="10" cy="8" r="3.6" />
      <path d="M3.5 20c0-3.3 2.9-5.6 6.5-5.6s6.5 2.3 6.5 5.6" />
      <path d="M17.5 9.5h4" />
    </svg>
  );
}

/** Ionicons `pencil-outline` — edit the group name (creator only). */
export function PencilIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}

/** Ionicons `qr-code-outline` — Show QR code (Share invite panel). */
export function QrCodeIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3z" />
      <path d="M20 14v3" />
      <path d="M14 20h3" />
      <path d="M20 20h.01" />
    </svg>
  );
}

/** Ionicons `refresh-outline` — Reset link (Share invite panel). */
export function RefreshIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M20 11a8 8 0 0 0-14.3-4.9" />
      <path d="M4 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9" />
      <path d="M20 20v-5h-5" />
    </svg>
  );
}

// ─── Brand icons (footer) ───────────────────────────────────────────────────
// Redrawn as single-color outline glyphs so they match every other icon in
// this file — no logo assets, no icon-library dependency.

/** Instagram — rounded square, camera-lens circle, flash dot. */
export function InstagramIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <rect x="3" y="3" width="18" height="18" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.1" cy="6.9" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** LinkedIn — rounded square with the "in" glyph. */
export function LinkedinIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <rect x="3" y="3" width="18" height="18" rx="5.5" />
      <circle cx="8.1" cy="8.3" r="1.05" fill="currentColor" stroke="none" />
      <path d="M8.1 11v6.2" />
      <path d="M11.9 17.2v-4c0-1.4.95-2.5 2.3-2.5s2.3 1.1 2.3 2.5v4" />
    </svg>
  );
}
