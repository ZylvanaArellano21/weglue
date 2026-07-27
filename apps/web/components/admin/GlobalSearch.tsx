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
interface PostHit {
  id: string;
  caption: string | null;
  author_username: string;
  club_name: string | null;
}
interface CommentHit {
  id: string;
  content: string;
  author_username: string;
}
interface EventHit {
  id: string;
  title: string;
  club_name: string | null;
  event_date: string;
}
interface RsvpHit {
  id: string;
  event_id: string;
  attendee_username: string;
  event_title: string;
  status: string;
}
interface ConversationHit {
  id: string;
  title: string;
  type_label: string;
  club_name: string | null;
}
interface ChannelHit {
  id: string;
  name: string;
  conversation_title: string;
  club_name: string | null;
}
interface MessageHit {
  id: string;
  conversation_id: string;
  sender_username: string;
  conversation_title: string;
  message_type: string;
  deleted: boolean;
}
interface NotificationHit {
  id: string;
  type: string;
  recipient_username: string;
  title: string | null;
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
  const [posts, setPosts] = useState<PostHit[]>([]);
  const [comments, setComments] = useState<CommentHit[]>([]);
  const [events, setEvents] = useState<EventHit[]>([]);
  const [rsvps, setRsvps] = useState<RsvpHit[]>([]);
  const [conversations, setConversations] = useState<ConversationHit[]>([]);
  const [channels, setChannels] = useState<ChannelHit[]>([]);
  const [messages, setMessages] = useState<MessageHit[]>([]);
  const [notifications, setNotifications] = useState<NotificationHit[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  function clearAll() {
    setUsers([]);
    setClubs([]);
    setUniversities([]);
    setOfficers([]);
    setPosts([]);
    setComments([]);
    setEvents([]);
    setRsvps([]);
    setConversations([]);
    setChannels([]);
    setMessages([]);
    setNotifications([]);
  }

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
      clearAll();
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
        setPosts(data.posts ?? []);
        setComments(data.comments ?? []);
        setEvents(data.events ?? []);
        setRsvps(data.rsvps ?? []);
        setConversations(data.conversations ?? []);
        setChannels(data.channels ?? []);
        setMessages(data.messages ?? []);
        setNotifications(data.notifications ?? []);
        setOpen(true);
      } catch {
        clearAll();
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
    users.length > 0 ||
    clubs.length > 0 ||
    universities.length > 0 ||
    officers.length > 0 ||
    posts.length > 0 ||
    comments.length > 0 ||
    events.length > 0 ||
    rsvps.length > 0 ||
    conversations.length > 0 ||
    channels.length > 0 ||
    messages.length > 0 ||
    notifications.length > 0;

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

              {events.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Events
                  </p>
                  {events.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => go(`/admin/events/${e.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-sm">📅</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{e.title}</span>
                        <span className="block truncate text-xs text-gray-500">
                          {e.club_name ? `${e.club_name} · ` : ""}
                          {e.event_date}
                        </span>
                      </span>
                      <span className="text-[10px] uppercase text-gray-400">Event</span>
                    </button>
                  ))}
                </>
              ) : null}

              {posts.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Posts
                  </p>
                  {posts.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => go(`/admin/posts/${p.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-sm">🖼️</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">
                          {p.caption || "No caption"}
                        </span>
                        <span className="block truncate text-xs text-gray-500">
                          @{p.author_username}
                          {p.club_name ? ` · ${p.club_name}` : ""}
                        </span>
                      </span>
                      <span className="text-[10px] uppercase text-gray-400">Post</span>
                    </button>
                  ))}
                </>
              ) : null}

              {comments.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Comments
                  </p>
                  {comments.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => go(`/admin/comments/${c.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-sm">💬</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{c.content}</span>
                        <span className="block truncate text-xs text-gray-500">@{c.author_username}</span>
                      </span>
                      <span className="text-[10px] uppercase text-gray-400">Comment</span>
                    </button>
                  ))}
                </>
              ) : null}

              {rsvps.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    RSVPs
                  </p>
                  {rsvps.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => go(`/admin/rsvps?event=${r.event_id}`)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-sm">✅</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">
                          @{r.attendee_username} · {r.event_title}
                        </span>
                        <span className="block truncate text-xs text-gray-500 capitalize">{r.status}</span>
                      </span>
                      <span className="text-[10px] uppercase text-gray-400">RSVP</span>
                    </button>
                  ))}
                </>
              ) : null}

              {conversations.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Conversations</p>
                  {conversations.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => go(`/admin/conversations/${c.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-sm">🗨️</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{c.title}</span>
                        <span className="block truncate text-xs text-gray-500">
                          {c.type_label}
                          {c.club_name ? ` · ${c.club_name}` : ""}
                        </span>
                      </span>
                      <span className="text-[10px] uppercase text-gray-400">Conversation</span>
                    </button>
                  ))}
                </>
              ) : null}

              {channels.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Channels</p>
                  {channels.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => go(`/admin/channels/${c.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-sm">📢</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">#{c.name}</span>
                        <span className="block truncate text-xs text-gray-500">
                          {c.conversation_title}
                          {c.club_name ? ` · ${c.club_name}` : ""}
                        </span>
                      </span>
                      <span className="text-[10px] uppercase text-gray-400">Channel</span>
                    </button>
                  ))}
                </>
              ) : null}

              {messages.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Messages</p>
                  {messages.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => go(`/admin/messages/${m.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-sm">✉️</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">
                          {m.deleted ? "Deleted message" : `@${m.sender_username}`}
                          <span className="ml-1 text-xs font-normal capitalize text-gray-400">· {m.message_type.replace("_", " ")}</span>
                        </span>
                        <span className="block truncate text-xs text-gray-500">{m.conversation_title}</span>
                      </span>
                      <span className="text-[10px] uppercase text-gray-400">Message</span>
                    </button>
                  ))}
                </>
              ) : null}

              {notifications.length > 0 ? (
                <>
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Notifications</p>
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => go(`/admin/notifications/${n.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-sm">🔔</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{n.type}</span>
                        <span className="block truncate text-xs text-gray-500">
                          @{n.recipient_username}
                          {n.title ? ` · ${n.title}` : ""}
                        </span>
                      </span>
                      <span className="text-[10px] uppercase text-gray-400">Notification</span>
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
