"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ShareAGlue } from "./ShareAGlue";
import { EventsFeed } from "./EventsFeed";
import { PostsFeed } from "./PostsFeed";
import { useToast } from "../shared/Toast";

type Tab = "posts" | "events";

// Center column: Share a Glue, the Posts | Events selector, and the active
// feed. Home opens on Events (spec §1). Tab state lives in the URL (?tab=) so
// browser Back restores the exact prior tab.
export function HomeFeed({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const show = useToast();

  const tab: Tab = params.get("tab") === "posts" ? "posts" : "events";

  const setTab = (next: Tab) => {
    const sp = new URLSearchParams(params.toString());
    if (next === "events") sp.delete("tab");
    else sp.set("tab", next);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const handleShare = (kind: "post" | "event") => {
    // Full create flows arrive in a later phase; keep the menu functional now.
    show(
      kind === "post"
        ? "Creating a post is coming soon on web."
        : "Creating an event is coming soon on web."
    );
  };

  return (
    <div>
      <ShareAGlue userId={userId} onSelect={handleShare} />

      <div
        role="tablist"
        aria-label="Home feed"
        className="mt-3 flex border-b"
        style={{ borderColor: "#E5E7EB" }}
      >
        {(["posts", "events"] as Tab[]).map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t)}
              className="flex-1 pb-2.5 pt-1 text-[15px] transition-colors"
              style={{
                color: active ? "#0FA6A6" : "#9CA3AF",
                fontWeight: active ? 600 : 400,
                borderBottom: active ? "2px solid #0FA6A6" : "2px solid transparent",
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          );
        })}
      </div>

      <div className="pt-4">
        {tab === "events" ? <EventsFeed userId={userId} /> : <PostsFeed userId={userId} />}
      </div>
    </div>
  );
}
