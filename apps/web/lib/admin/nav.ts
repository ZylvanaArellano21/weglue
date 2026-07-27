// Admin Dashboard navigation model. The FULL future information architecture is
// declared here now so the shell is complete on Day 1; sections not yet built
// render a polished "Scheduled for Day X" state instead of a broken route.

export interface AdminNavItem {
  label: string;
  href: string;
  /** Emoji glyph used as a lightweight, dependency-free sidebar icon. */
  icon: string;
  /** Which build day ships this section (for the Coming-Soon state). */
  day: number;
  /** True once the section is a real, live screen. */
  ready: boolean;
  group: "Core" | "People" | "Community" | "Content" | "Messaging" | "Moderation" | "System";
}

export const ADMIN_NAV: AdminNavItem[] = [
  { label: "Overview", href: "/admin", icon: "📊", day: 1, ready: true, group: "Core" },

  { label: "Users", href: "/admin/users", icon: "👤", day: 1, ready: true, group: "People" },
  { label: "Officers", href: "/admin/officers", icon: "🎖️", day: 2, ready: true, group: "People" },
  { label: "Restrictions", href: "/admin/restrictions", icon: "🚫", day: 2, ready: true, group: "People" },
  { label: "Gluemates", href: "/admin/gluemates", icon: "🔗", day: 2, ready: true, group: "People" },

  { label: "Clubs", href: "/admin/clubs", icon: "🏛️", day: 1, ready: true, group: "Community" },
  { label: "Memberships", href: "/admin/memberships", icon: "🎟️", day: 2, ready: true, group: "Community" },
  { label: "Universities", href: "/admin/universities", icon: "🎓", day: 2, ready: true, group: "Community" },

  { label: "Posts", href: "/admin/posts", icon: "🖼️", day: 3, ready: true, group: "Content" },
  { label: "Comments", href: "/admin/comments", icon: "💬", day: 3, ready: true, group: "Content" },
  { label: "Events", href: "/admin/events", icon: "📅", day: 3, ready: true, group: "Content" },
  { label: "RSVPs", href: "/admin/rsvps", icon: "✅", day: 3, ready: true, group: "Content" },

  { label: "Conversations", href: "/admin/conversations", icon: "🗨️", day: 4, ready: true, group: "Messaging" },
  { label: "Channels", href: "/admin/channels", icon: "📢", day: 4, ready: true, group: "Messaging" },
  { label: "Messages", href: "/admin/messages", icon: "✉️", day: 4, ready: true, group: "Messaging" },
  { label: "Notifications", href: "/admin/notifications", icon: "🔔", day: 4, ready: true, group: "Messaging" },

  { label: "Reports", href: "/admin/reports", icon: "🚩", day: 2, ready: false, group: "Moderation" },
  { label: "Deleted Content", href: "/admin/deleted-content", icon: "🗑️", day: 5, ready: false, group: "Moderation" },
  { label: "Edit History", href: "/admin/edit-history", icon: "📝", day: 5, ready: false, group: "Moderation" },
  { label: "Audit History", href: "/admin/audit-history", icon: "🕵️", day: 5, ready: false, group: "Moderation" },

  { label: "Data Health", href: "/admin/data-health", icon: "🩺", day: 6, ready: false, group: "System" },
  { label: "Admin Settings", href: "/admin/settings", icon: "⚙️", day: 7, ready: false, group: "System" },
];

export const ADMIN_NAV_GROUPS: AdminNavItem["group"][] = [
  "Core",
  "People",
  "Community",
  "Content",
  "Messaging",
  "Moderation",
  "System",
];

export function findNavItem(pathname: string): AdminNavItem | undefined {
  // Longest matching href wins so /admin/users/123 resolves to Users, not Overview.
  return [...ADMIN_NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(item.href + "/"));
}
