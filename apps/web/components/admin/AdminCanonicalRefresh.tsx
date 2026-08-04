"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Dashboard mutations already refresh their own route after the atomic action
// resolves. This supplies the no-polling recovery path for a tab that missed an
// action, a report-outbox delivery update, or a reconnect while backgrounded.
// /admin is force-dynamic and every loader repeats the secure-admin gate, so a
// refresh is a fresh canonical server read rather than client-side state reuse.
export function AdminCanonicalRefresh(): null {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, 100);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
