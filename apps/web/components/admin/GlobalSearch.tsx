"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "../shared/Avatar";

interface UserHit {
  id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  email: string | null;
}
interface ClubHit {
  id: string;
  name: string;
  handle: string;
  avatar_url: string | null;
  university: string | null;
}
interface UniversityHit {
  id: string;
  name: string;
  slug: string;
}
interface OfficerHit {
  id: string;
  user_id: string;
  full_name: string;
  username: string;
  club_name: string;
  role_title: string | null;
}

/**
 * Global entity search. Debounced, founder-authorized server-side via
 * /admin/api/search. Day-1 entities: users (name/username/email) + clubs
 * (name/handle). Results are human-readable and route to the correct detail
 * page — no UUIDs required.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<UserHit[]>([]);
  const [clubs, setClubs] = useState<ClubHit[]>([]);
  const [universities, setUniversities] = useState<UniversityHit[]>([]);
  const [officers, setOfficers] = useState<OfficerHit[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const q = term.trim();
    if (q.length < 2) {
      setUsers([]);
      setClubs([]);
      setUniversities([]);
      setOfficers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/admin/api/search?q=${encodeURIComponent(q)}`, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setUsers(data.users ?? []);
        setClubs(data.clubs ?? []);
        setUniversities(data.universities ?? []);
        setOfficers(data.officers ?? []);
        setOpen(true);
      } catch {
        setUsers([]);
        setClubs([]);
        setUniversities([]);
        setOfficers([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [term]);

  function go(href: string) {
    setOpen(false);
    setTerm("");
    router.push(href);
  }

  const hasResults =
    users.length > 0 || clubs.length > 0 || universities.length > 0 || officers.length > 0;

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => term.trim().length >= 2 && setOpen(true)}
          placeholder="Search users by name, username, email — or clubs by name, handle…"
          className="no-native-clear w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-9 text-sm text-gray-900 outline-none transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100"
          type="search"
          aria-label="Global admin search"
        />
        {loading ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>
        ) : null}
      </div>

      {open ? (
        <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          {!hasResults ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500">
              {loading ? "Searching…" : `No matches for “${term.trim()}”.`}
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto py-1">
              {users.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Users
                  </p>
                  {users.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => go(`/admin/users/${u.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
                    >
                      <Avatar uri={u.avatar_url} name={u.full_name} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{u.full_name}</span>
                        <span className="block truncate text-xs text-gray-500">
                          @{u.username}
                          {u.email ? ` · ${u.email}` : ""}
                        </span>
                      </span>
                      <span className="text-[10px] uppercase text-gray-400">User</span>
                    </button>
                  ))}
                </>
              ) : null}

              {clubs.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Clubs
                  </p>
                  {clubs.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => go(`/admin/clubs/${c.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
                    >
                      <Avatar uri={c.avatar_url} name={c.name} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{c.name}</span>
                        <span className="block truncate text-xs text-gray-500">
                          @{c.handle}
                          {c.university ? ` · ${c.university}` : ""}
                        </span>
                      </span>
                      <span className="text-[10px] uppercase text-gray-400">Club</span>
                    </button>
                  ))}
                </>
              ) : null}

              {officers.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Officers
                  </p>
                  {officers.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => go(`/admin/users/${o.user_id}`)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-sm">🎖️</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{o.full_name || o.username}</span>
                        <span className="block truncate text-xs text-gray-500">
                          {o.role_title ? `${o.role_title} · ` : ""}
                          {o.club_name}
                        </span>
                      </span>
                      <span className="text-[10px] uppercase text-gray-400">Officer</span>
                    </button>
                  ))}
                </>
              ) : null}

              {universities.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Universities
                  </p>
                  {universities.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => go(`/admin/universities/${u.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-sm">🎓</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{u.name}</span>
                        <span className="block truncate text-xs text-gray-500">@{u.slug}</span>
                      </span>
                      <span className="text-[10px] uppercase text-gray-400">University</span>
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
