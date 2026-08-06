#!/usr/bin/env python3
"""
HTTP matrices for migrations 073 + 074, run against a DISPOSABLE LOCAL stack.

Why HTTP and not only SQL: every SQL harness in this repo proves the policy is
correct when Postgres evaluates it. These matrices prove the same thing through
PostgREST and Storage as a real `authenticated` student -- i.e. exactly what
DevTools, a patched bundle or curl can send. Nothing here depends on a hidden
input, a disabled button, a TypeScript type or a route guard.

Matrices covered:
  A. Directional blocking          -- who sees what, and in which direction
  B. Shared-context identity       -- the narrow readers, and their refusals
  C. Shared-message content types  -- all 7, payload by payload
  D. Storage direct access         -- the signed-URL / object-path bypass
  E. Club manipulation             -- protected identity + handle derivation

Usage:
    python3 supabase/scripts/matrix_074_http.py

Requires: a running `supabase start` stack with the full 001->075 chain.
No grants bridge: migration 075 gives the client roles their table privileges.
Uses the well-known LOCAL demo JWT secret only; no production credential is
read, written or printed.
"""

import base64
import hashlib
import hmac
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

REST = "http://127.0.0.1:54321/rest/v1"
STORAGE = "http://127.0.0.1:54321/storage/v1"
ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9."
    "CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
)
# Local demo secret shipped by the Supabase CLI. NOT a production credential.
JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long"
CONTAINER = "supabase_db_weglue"

SILVANA = "81000000-0000-0000-0000-000000000001"  # blocks LOLA
LOLA = "81000000-0000-0000-0000-000000000002"
BRUNO = "81000000-0000-0000-0000-000000000003"  # unrelated participant
OUTSIDER = "81000000-0000-0000-0000-000000000004"  # in no shared context
CLUB = "82000000-0000-0000-0000-000000000001"
CONV = "83000000-0000-0000-0000-000000000001"
PRIVATE_CONV = "83000000-0000-0000-0000-000000000002"
UNI = "80000000-0000-0000-0000-0000000000a1"
OTHER_UNI = "80000000-0000-0000-0000-0000000000a2"
SILVANA_IMG = f"{CONV}/silvana.png"
BRUNO_IMG = f"{CONV}/bruno.png"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"   [{detail}]" if detail and not ok else ""))


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def token(user_id: str) -> str:
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64(
        json.dumps(
            {"sub": user_id, "role": "authenticated", "aud": "authenticated",
             "iss": "supabase-demo", "exp": int(time.time()) + 3600},
            separators=(",", ":"),
        ).encode()
    )
    signing_input = f"{header}.{payload}".encode()
    sig = hmac.new(JWT_SECRET.encode(), signing_input, hashlib.sha256).digest()
    return f"{header}.{payload}.{b64(sig)}"


def request(url, jwt, method="GET", body=None):
    req = urllib.request.Request(url, method=method)
    req.add_header("apikey", ANON)
    req.add_header("Authorization", f"Bearer {jwt}")
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()
    except Exception as exc:  # noqa: BLE001
        return 0, str(exc)


def psql(sql: str) -> str:
    proc = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1",
         "-U", "postgres", "-d", "postgres", "-t", "-A"],
        input=sql, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print(proc.stderr[-3000:])
        sys.exit(f"fixture SQL failed: {sql[:120]}")
    return proc.stdout.strip()


FIXTURE = f"""
INSERT INTO public.universities (id, name, slug) VALUES
  ('{UNI}',       'HTTP Matrix U',       'http-matrix-u'),
  ('{OTHER_UNI}', 'HTTP Matrix U Other', 'http-matrix-u-other')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('{SILVANA}',  'silvana-http@example.test',  '{{}}'::jsonb),
  ('{LOLA}',     'lola-http@example.test',     '{{}}'::jsonb),
  ('{BRUNO}',    'bruno-http@example.test',    '{{}}'::jsonb),
  ('{OUTSIDER}', 'outsider-http@example.test', '{{}}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, username, full_name, email_verified,
                             onboarding_complete, onboarding_completed, university_id) VALUES
  ('{SILVANA}',  'silvanahttp',  'Silvana Blocker', true, true, true, '{UNI}'),
  ('{LOLA}',     'lolahttp',     'Lola Blocked',    true, true, true, '{UNI}'),
  ('{BRUNO}',    'brunohttp',    'Bruno Bystander', true, true, true, '{UNI}'),
  ('{OUTSIDER}', 'outsiderhttp', 'Olive Outsider',  true, true, true, '{UNI}')
ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username,
  full_name = EXCLUDED.full_name, email_verified = EXCLUDED.email_verified,
  onboarding_complete = EXCLUDED.onboarding_complete,
  onboarding_completed = EXCLUDED.onboarding_completed,
  university_id = EXCLUDED.university_id;

INSERT INTO public.clubs (id, name, handle, description, university_id)
VALUES ('{CLUB}', 'HTTP Matrix Club', 'ignored', 'd', '{UNI}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.club_members (club_id, user_id, role) VALUES
  ('{CLUB}', '{SILVANA}', 'officer'),
  ('{CLUB}', '{LOLA}',    'member'),
  ('{CLUB}', '{BRUNO}',   'member')
ON CONFLICT DO NOTHING;

INSERT INTO public.conversations (id, type, name, created_by) VALUES
  ('{CONV}',         'group', 'HTTP Shared Group',  '{SILVANA}'),
  ('{PRIVATE_CONV}', 'group', 'HTTP Private Group', '{SILVANA}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
  ('{CONV}', '{SILVANA}'), ('{CONV}', '{LOLA}'), ('{CONV}', '{BRUNO}'),
  ('{PRIVATE_CONV}', '{SILVANA}'), ('{PRIVATE_CONV}', '{OUTSIDER}')
ON CONFLICT DO NOTHING;

-- One message of every payload-carrying type, plus text and poll.
INSERT INTO public.messages
  (id, conversation_id, sender_id, content, message_type, attachment_url, attachment_name, attachment_mime) VALUES
  ('84000000-0000-0000-0000-000000000001', '{CONV}', '{SILVANA}', 'silvana text', 'text',  NULL, NULL, NULL),
  ('84000000-0000-0000-0000-000000000002', '{CONV}', '{SILVANA}', NULL, 'image', '{SILVANA_IMG}', 'silvana.png', 'image/png'),
  ('84000000-0000-0000-0000-000000000003', '{CONV}', '{SILVANA}', NULL, 'video', '{CONV}/silvana.mp4', 'silvana.mp4', 'video/mp4'),
  ('84000000-0000-0000-0000-000000000004', '{CONV}', '{SILVANA}', NULL, 'file',  '{CONV}/silvana.pdf', 'silvana.pdf', 'application/pdf'),
  ('84000000-0000-0000-0000-000000000005', '{CONV}', '{BRUNO}',   NULL, 'image', '{BRUNO_IMG}', 'bruno.png', 'image/png'),
  ('84000000-0000-0000-0000-000000000006', '{CONV}', '{SILVANA}', 'Poll?', 'poll', NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- A club-tagged post and a personal post by the blocker (073's subject).
INSERT INTO public.posts (id, author_id, club_id, post_type, caption) VALUES
  ('85000000-0000-0000-0000-000000000001', '{SILVANA}', '{CLUB}', 'picture', 'club tagged'),
  ('85000000-0000-0000-0000-000000000002', '{SILVANA}', NULL,     'picture', 'personal')
ON CONFLICT (id) DO NOTHING;
"""

CLEANUP = f"""
DELETE FROM public.messages WHERE conversation_id IN ('{CONV}', '{PRIVATE_CONV}');
DELETE FROM public.conversation_participants WHERE conversation_id IN ('{CONV}', '{PRIVATE_CONV}');
DELETE FROM public.conversations WHERE id IN ('{CONV}', '{PRIVATE_CONV}');
DELETE FROM public.posts WHERE author_id IN ('{SILVANA}', '{LOLA}', '{BRUNO}', '{OUTSIDER}');
DELETE FROM public.user_blocks WHERE blocker_id IN ('{SILVANA}', '{LOLA}')
                                  OR blocked_id IN ('{SILVANA}', '{LOLA}');
-- Drop the officer floor trigger for the teardown only: deleting an entire
-- fixture club legitimately removes its last officer.
ALTER TABLE public.club_members DISABLE TRIGGER USER;
DELETE FROM public.club_members WHERE club_id = '{CLUB}';
ALTER TABLE public.club_members ENABLE TRIGGER USER;
DELETE FROM public.conversations WHERE club_id = '{CLUB}';
DELETE FROM public.clubs WHERE id = '{CLUB}';
DELETE FROM public.profiles WHERE id IN ('{SILVANA}', '{LOLA}', '{BRUNO}', '{OUTSIDER}');
DELETE FROM auth.users WHERE id IN ('{SILVANA}', '{LOLA}', '{BRUNO}', '{OUTSIDER}');
DELETE FROM public.universities WHERE id IN ('{UNI}', '{OTHER_UNI}');
"""


def rows(status, body):
    if status != 200:
        return None
    try:
        return json.loads(body)
    except Exception:  # noqa: BLE001
        return None


def upload(path, jwt):
    """Upload through the real Storage API so the uploader is recorded as owner,
    exactly as the app's own upload path does. Storage refuses direct SQL writes
    to storage.objects, and rightly so."""
    req = urllib.request.Request(f"{STORAGE}/object/chat-attachments/{path}", method="POST")
    req.add_header("apikey", ANON)
    req.add_header("Authorization", f"Bearer {jwt}")
    req.add_header("Content-Type", "image/png")
    req.data = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status
    except urllib.error.HTTPError as exc:
        return exc.code


def remove(path, jwt):
    request(f"{STORAGE}/object/chat-attachments/{path}", jwt, "DELETE")


def run():
    print("Seeding fixture…")
    psql(CLEANUP)
    psql(FIXTURE)
    lola, silvana, bruno, outsider = token(LOLA), token(SILVANA), token(BRUNO), token(OUTSIDER)

    # Objects are uploaded BEFORE the block exists, by their real senders.
    for path, jwt, who in ((SILVANA_IMG, silvana, "Silvana"), (BRUNO_IMG, bruno, "Bruno")):
        remove(path, jwt)
        code = upload(path, jwt)
        if code not in (200, 201):
            sys.exit(f"fixture upload failed for {who}: HTTP {code}")

    # ─────────────────────────────────────────────────────────────────────
    print("\nBASELINE (no block) — positive controls")
    st, bd = request(f"{REST}/profiles?id=eq.{SILVANA}&select=id", lola)
    check("baseline: Lola can read Silvana's profile", bool(rows(st, bd)), f"{st} {bd[:120]}")
    st, bd = request(f"{REST}/posts?id=eq.85000000-0000-0000-0000-000000000001&select=id", lola)
    check("baseline: Lola can read the club-tagged post", bool(rows(st, bd)))
    st, bd = request(f"{REST}/rpc/club_shared_identities", lola, "POST", {"p_club_id": CLUB})
    check("baseline: club roster returns all 3 members", len(rows(st, bd) or []) == 3)

    psql(f"INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('{SILVANA}', '{LOLA}');")

    # ── A. DIRECTIONAL BLOCKING ──────────────────────────────────────────
    print("\nMATRIX A — directional blocking")
    st, bd = request(f"{REST}/profiles?id=eq.{SILVANA}&select=id", lola)
    check("A1 blocked person cannot read the blocker's profile", rows(st, bd) == [])
    st, bd = request(f"{REST}/profiles?id=eq.{LOLA}&select=id", silvana)
    check("A2 blocker cannot read the blocked profile either (mutual)", rows(st, bd) == [])
    st, bd = request(f"{REST}/rpc/current_user_blocks", silvana, "POST", {"p_target": LOLA})
    check("A3 blocker gets the directional 'I blocked them' = true", bd.strip() == "true")
    st, bd = request(f"{REST}/rpc/current_user_blocks", lola, "POST", {"p_target": SILVANA})
    check("A4 blocked person gets false — direction is never revealed", bd.strip() == "false")
    st, bd = request(f"{REST}/rpc/target_is_blocked_from_current_user", lola, "POST", {"p_target": SILVANA})
    check("A5 the symmetric question is true for both parties", bd.strip() == "true")
    st, bd = request(f"{REST}/profiles?id=eq.{BRUNO}&select=id", lola)
    check("A6 positive control: an unrelated profile is still readable", bool(rows(st, bd)))
    st, bd = request(f"{REST}/user_blocks?select=blocker_id,blocked_id", lola)
    check("A7 blocked person cannot enumerate who blocked them", rows(st, bd) == [])

    # ── B. SHARED-CONTEXT IDENTITY ───────────────────────────────────────
    print("\nMATRIX B — shared-context structural identity")
    st, bd = request(f"{REST}/rpc/club_shared_identities", lola, "POST", {"p_club_id": CLUB})
    data = rows(st, bd) or []
    check("B1 blocker still appears in the shared club roster", any(r["id"] == SILVANA for r in data))
    check("B2 the roster is still complete (3 of 3)", len(data) == 3)
    fields = set(data[0].keys()) if data else set()
    check("B3 only the 5 structural fields are returned",
          fields == {"id", "username", "full_name", "avatar_url", "role"}, str(fields))
    check("B4 the officer role is preserved for the shared list",
          any(r["id"] == SILVANA and r["role"] == "officer" for r in data))
    st, bd = request(f"{REST}/rpc/conversation_shared_identities", lola, "POST", {"p_conversation_id": CONV})
    data = rows(st, bd) or []
    check("B5 blocker keeps identity in the shared conversation", any(r["id"] == SILVANA for r in data))
    st, bd = request(f"{REST}/rpc/conversation_shared_identities", lola, "POST",
                     {"p_conversation_id": PRIVATE_CONV})
    check("B6 NEGATIVE: non-participant gets an empty roster", rows(st, bd) == [])
    st, bd = request(f"{REST}/rpc/conversation_shared_identities", outsider, "POST",
                     {"p_conversation_id": CONV})
    check("B7 NEGATIVE: an outsider gets nothing for a chat they are not in", rows(st, bd) == [])
    st, bd = request(f"{REST}/rpc/club_shared_identities", outsider, "POST",
                     {"p_club_id": "00000000-0000-0000-0000-000000000000"})
    check("B8 an arbitrary club id yields nothing rather than an oracle", rows(st, bd) == [])
    st, bd = request(f"{REST}/rpc/club_shared_identities", lola, "POST",
                     {"p_club_id": CLUB, "p_viewer": SILVANA})
    check("B9 NEGATIVE: a viewer-id argument is rejected (no impersonation)", st >= 400, str(st))
    # A blocked person must still be missing from GENERAL search.
    st, bd = request(f"{REST}/profiles?username=eq.silvanahttp&select=id", lola)
    check("B10 blocked person stays absent from a general profiles query", rows(st, bd) == [])

    # ── C. SHARED-MESSAGE CONTENT TYPES ──────────────────────────────────
    print("\nMATRIX C — every shared-message content type")
    st, bd = request(f"{REST}/messages?conversation_id=eq.{CONV}&select=id,message_type", lola)
    data = rows(st, bd) or []
    check("C1 all 6 message rows survive the block (history preserved)", len(data) == 6, str(len(data)))
    check("C2 text history is readable", any(r["message_type"] == "text" for r in data))
    check("C3 poll history is readable", any(r["message_type"] == "poll" for r in data))
    check("C4 image/video/file rows remain as historical references",
          {"image", "video", "file"} <= {r["message_type"] for r in data})
    st, bd = request(f"{REST}/posts?id=eq.85000000-0000-0000-0000-000000000001&select=id", lola)
    check("C5 shared_post target returns no payload while blocked", rows(st, bd) == [])
    st, bd = request(f"{REST}/posts?id=eq.85000000-0000-0000-0000-000000000002&select=id", lola)
    check("C6 the blocker's personal post is also refused", rows(st, bd) == [])
    st, bd = request(f"{REST}/rpc/conversation_restricted_senders", lola, "POST",
                     {"p_conversation_id": CONV})
    data = rows(st, bd) or []
    check("C7 restricted senders names the blocker", SILVANA in data)
    check("C8 restricted senders excludes the unrelated participant", BRUNO not in data)
    st, bd = request(f"{REST}/rpc/conversation_restricted_senders", outsider, "POST",
                     {"p_conversation_id": CONV})
    check("C9 NEGATIVE: a non-participant gets no restricted-sender list", rows(st, bd) == [])

    # ── D. STORAGE DIRECT ACCESS ─────────────────────────────────────────
    print("\nMATRIX D — direct storage access (the real enforcement point)")
    st, bd = request(f"{STORAGE}/object/authenticated/chat-attachments/{SILVANA_IMG}", lola)
    check("D1 blocked person cannot fetch the blocker's object directly", st in (400, 401, 403, 404), str(st))
    st, bd = request(f"{STORAGE}/object/sign/chat-attachments/{SILVANA_IMG}", lola, "POST",
                     {"expiresIn": 60})
    check("D2 blocked person cannot even mint a signed URL for it", st in (400, 401, 403, 404), str(st))
    st, bd = request(f"{STORAGE}/object/sign/chat-attachments/{BRUNO_IMG}", lola, "POST",
                     {"expiresIn": 60})
    check("D3 POSITIVE CONTROL: an unrelated participant's object still signs", st == 200, str(st))
    st, bd = request(f"{STORAGE}/object/sign/chat-attachments/{SILVANA_IMG}", silvana, "POST",
                     {"expiresIn": 60})
    check("D4 the author keeps their own object", st == 200, str(st))
    st, bd = request(f"{STORAGE}/object/sign/chat-attachments/{BRUNO_IMG}", outsider, "POST",
                     {"expiresIn": 60})
    check("D5 a non-participant cannot sign any object in the chat", st in (400, 401, 403, 404), str(st))

    # Removed from the conversation -> everything goes, block or no block.
    psql(f"DELETE FROM public.conversation_participants WHERE conversation_id='{CONV}' AND user_id='{BRUNO}';")
    st, bd = request(f"{STORAGE}/object/sign/chat-attachments/{BRUNO_IMG}", bruno, "POST",
                     {"expiresIn": 60})
    check("D6 a removed participant loses their own attachment access", st in (400, 401, 403, 404), str(st))
    psql(f"INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES ('{CONV}','{BRUNO}');")

    # Deleted message -> object is no longer readable by anyone.
    psql(f"""UPDATE public.messages SET deleted_at = now(), deletion_kind='sender_deleted',
             deleted_by='{BRUNO}' WHERE id='84000000-0000-0000-0000-000000000005';""")
    st, bd = request(f"{STORAGE}/object/sign/chat-attachments/{BRUNO_IMG}", lola, "POST",
                     {"expiresIn": 60})
    check("D7 a deleted message's attachment stops signing", st in (400, 401, 403, 404), str(st))
    psql(f"""UPDATE public.messages SET deleted_at = NULL, deletion_kind='active', deleted_by=NULL
             WHERE id='84000000-0000-0000-0000-000000000005';""")

    # ── UNBLOCK restores ─────────────────────────────────────────────────
    print("\nUNBLOCK — eligible content comes back")
    psql(f"DELETE FROM public.user_blocks WHERE blocker_id='{SILVANA}' AND blocked_id='{LOLA}';")
    st, bd = request(f"{STORAGE}/object/sign/chat-attachments/{SILVANA_IMG}", lola, "POST",
                     {"expiresIn": 60})
    check("U1 attachment access is restored after unblock", st == 200, str(st))
    st, bd = request(f"{REST}/posts?id=eq.85000000-0000-0000-0000-000000000001&select=id", lola)
    check("U2 the club-tagged post is readable again", bool(rows(st, bd)))
    st, bd = request(f"{REST}/profiles?id=eq.{SILVANA}&select=id", lola)
    check("U3 the normal profile is readable again", bool(rows(st, bd)))
    st, bd = request(f"{REST}/rpc/conversation_restricted_senders", lola, "POST",
                     {"p_conversation_id": CONV})
    check("U4 nothing is restricted any more", rows(st, bd) == [])

    # ── E. CLUB MANIPULATION ─────────────────────────────────────────────
    print("\nMATRIX E — club manipulation (072 identity + 073 handle)")
    handle = psql(f"SELECT handle FROM public.clubs WHERE id='{CLUB}';")
    check("E1 the client-supplied handle was overwritten on create", handle == "HTTPMatrixClub", handle)
    st, bd = request(f"{REST}/clubs?id=eq.{CLUB}", silvana, "PATCH", {"handle": "ChosenByMe"})
    handle = psql(f"SELECT handle FROM public.clubs WHERE id='{CLUB}';")
    check("E2 an officer cannot persist a handle of their own choosing", handle == "HTTPMatrixClub", handle)
    st, bd = request(f"{REST}/clubs?id=eq.{CLUB}", silvana, "PATCH", {"description": "new description"})
    handle = psql(f"SELECT handle FROM public.clubs WHERE id='{CLUB}';")
    check("E3 a description-only PATCH leaves the handle alone", handle == "HTTPMatrixClub", handle)
    st, bd = request(f"{REST}/clubs?id=eq.{CLUB}", silvana, "PATCH", {"name": "HTTP Renamed Club"})
    row = psql(f"SELECT name || '|' || handle FROM public.clubs WHERE id='{CLUB}';")
    check("E4 a rename moves name and handle together",
          row == "HTTP Renamed Club|HTTPRenamedClub", row)
    # A DIFFERENT university, or 072's change-only guard would correctly allow it.
    st, bd = request(f"{REST}/clubs?id=eq.{CLUB}", silvana, "PATCH",
                     {"university_id": OTHER_UNI, "name": "X Club"})
    row = psql(f"SELECT name || '|' || university_id FROM public.clubs WHERE id='{CLUB}';")
    check("E5 072 blocks a university move smuggled with a rename, and the whole "
          "statement is rejected", row == f"HTTP Renamed Club|{UNI}", row)
    st, bd = request(f"{REST}/clubs?id=eq.{CLUB}", silvana, "PATCH", {"member_count": 9999})
    row = psql(f"SELECT member_count FROM public.clubs WHERE id='{CLUB}';")
    check("E6 072 still blocks member_count inflation", row != "9999", row)
    st, bd = request(f"{REST}/clubs?id=eq.{CLUB}", bruno, "PATCH", {"name": "Member Rename"})
    row = psql(f"SELECT name FROM public.clubs WHERE id='{CLUB}';")
    check("E7 an ordinary member still cannot rename the club", row == "HTTP Renamed Club", row)

    print("\nCleaning up…")
    remove(SILVANA_IMG, silvana)
    remove(BRUNO_IMG, bruno)
    psql(CLEANUP)

    failed = [r for r in results if not r[1]]
    print(f"\n{'=' * 62}\n{len(results) - len(failed)}/{len(results)} HTTP matrix checks passed")
    if failed:
        for name, _, detail in failed:
            print(f"  FAILED: {name}  [{detail}]")
        sys.exit(1)
    print("All HTTP matrices passed.")


if __name__ == "__main__":
    run()
