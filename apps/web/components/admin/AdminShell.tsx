"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ADMIN_NAV, ADMIN_NAV_GROUPS, findNavItem } from "../../lib/admin/nav";
import { GlobalSearch } from "./GlobalSearch";
import { AdminSessionGuard } from "./AdminSessionGuard";

/**
 * The Admin Dashboard application shell: persistent collapsible sidebar, top bar
 * with global search + founder indicator, and a breadcrumb + content area.
 * Desktop-first; the sidebar collapses to icons on demand and on narrow laptops.
 */
export function AdminShell({
  founderEmail,
  children,
}: {
  founderEmail: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const active = findNavItem(pathname);

  const founderInitial = founderEmail.charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen bg-gray-50 text-gray-900">
      {/* Sidebar */}
      <aside
        className={`sticky top-0 flex h-screen flex-col border-r border-gray-200 bg-white transition-all duration-200 ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-gray-100 px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-500 text-sm font-bold text-white">
            W
          </div>
          {!collapsed ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">We Glue</p>
              <p className="truncate text-[11px] leading-tight text-teal-600">Admin</p>
            </div>
          ) : null}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {ADMIN_NAV_GROUPS.map((group) => {
            const items = ADMIN_NAV.filter((i) => i.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="mb-3">
                {!collapsed ? (
                  <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    {group}
                  </p>
                ) : null}
                {items.map((item) => {
                  const isActive = active?.href === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={`group mb-0.5 flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition ${
                        isActive
                          ? "bg-teal-50 font-medium text-teal-700"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      }`}
                    >
                      <span className="w-5 shrink-0 text-center text-base leading-none">{item.icon}</span>
                      {!collapsed ? (
                        <span className="flex-1 truncate">{item.label}</span>
                      ) : null}
                      {!collapsed && !item.ready ? (
                        <span className="rounded bg-gray-100 px-1 text-[9px] font-medium text-gray-400">
                          D{item.day}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-10 items-center justify-center border-t border-gray-100 text-xs text-gray-400 hover:bg-gray-50 hover:text-gray-700"
        >
          {collapsed ? "»" : "« Collapse"}
        </button>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-gray-200 bg-white/90 px-4 backdrop-blur">
          <div className="flex-1">
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-3">
            <AdminSessionGuard />
            <span className="hidden text-right text-xs leading-tight sm:block">
              <span className="block font-medium text-gray-900">Founder</span>
              <span className="block max-w-[180px] truncate text-gray-400">{founderEmail}</span>
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-500 text-sm font-semibold text-white">
              {founderInitial}
            </div>
          </div>
        </header>

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 border-b border-gray-100 bg-white px-6 py-2 text-xs text-gray-500">
          <Link href="/admin" className="hover:text-teal-600">
            Admin
          </Link>
          {active && active.href !== "/admin" ? (
            <>
              <span className="text-gray-300">/</span>
              <span className="font-medium text-gray-700">{active.label}</span>
            </>
          ) : null}
        </div>

        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
