#!/usr/bin/env python3
"""
ATTACHMENT LINK REPLAY MATRIX — run against a DISPOSABLE LOCAL stack.

The founder's exact scenario:

    1. Lola can view Silvana's message attachment.
    2. Lola receives a working image/video/file link.
    3. Silvana blocks Lola.
    4. The EXACT same previously issued link is reused.

This file exists because step 4 used to succeed. A Supabase signed URL is a
self-contained token: Storage validates its signature and expiry and serves the
object WITHOUT re-evaluating the bucket's RLS policy. So the blocking check
added in migration 074 was correct and still could be walked around by anyone
who had kept a link.

It proves two things at once:

  A. THE OLD DELIVERY PATH IS REPLAYABLE. A signed URL minted before the block
     still returns 200 afterwards. This is asserted, not merely observed, so
     that nobody "fixes" the app by going back to signed URLs.

  B. THE OFFICIAL DELIVERY PATH IS NOT. Both clients now fetch through
     /storage/v1/object/authenticated/..., which evaluates the policy on every
     request. Blocked -> refused immediately; unblocked -> works again;
     unrelated participants unaffected.

NOT CLAIMED: that We Glue can recall a file the viewer already downloaded,
screenshotted or re-shared before the block. Nothing server-side can, and
nothing here pretends otherwise.

Usage:  python3 supabase/scripts/matrix_attachment_replay.py
Needs:  a running local stack on the full 001->075 chain.
Uses the well-known LOCAL demo JWT secret only; no production credential.
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

STORAGE = "http://127.0.0.1:54321/storage/v1"
ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9."
    "CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
)
SECRET = "super-secret-jwt-token-with-at-least-32-characters-long"
CONTAINER = "supabase_db_weglue"

UNI = "90000000-0000-0000-0000-0000000000a1"
SIL = "91000000-0000-0000-0000-000000000001"  # sender; blocks LOL
LOL = "91000000-0000-0000-0000-000000000002"  # viewer who gets blocked
BRU = "91000000-0000-0000-0000-000000000003"  # unrelated participant
CONV = "93000000-0000-0000-0000-000000000001"

IMG = f"{CONV}/replay.png"
VID = f"{CONV}/replay.mp4"
DOC = f"{CONV}/replay.pdf"
MIMES = {IMG: "image/png", VID: "video/mp4", DOC: "application/pdf"}

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"   [{detail}]" if detail and not ok else ""))


def b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def token(uid):
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    p = b64(json.dumps({"sub": uid, "role": "authenticated", "aud": "authenticated",
                        "iss": "supabase-demo", "exp": int(time.time()) + 3600},
                       separators=(",", ":")).encode())
    s = hmac.new(SECRET.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest()
    return f"{h}.{p}.{b64(s)}"


def psql(sql):
    r = subprocess.run(["docker", "exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1",
                        "-U", "postgres", "-d", "postgres", "-t", "-A"],
                       input=sql, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-2000:])
        sys.exit("fixture SQL failed")
    return r.stdout.strip()


def req(url, jwt=None, method="GET", body=None, ctype=None, raw=None):
    r = urllib.request.Request(url, method=method)
    r.add_header("apikey", ANON)
    if jwt:
        r.add_header("Authorization", f"Bearer {jwt}")
    if raw is not None:
        r.add_header("Content-Type", ctype or "application/octet-stream")
        r.data = raw
    elif body is not None:
        r.add_header("Content-Type", "application/json")
        r.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # noqa: BLE001
        return 0, str(e).encode()


CLEANUP = f"""
DELETE FROM public.messages WHERE conversation_id='{CONV}';
DELETE FROM public.conversation_participants WHERE conversation_id='{CONV}';
DELETE FROM public.conversations WHERE id='{CONV}';
DELETE FROM public.user_blocks
 WHERE blocker_id IN ('{SIL}','{LOL}','{BRU}') OR blocked_id IN ('{SIL}','{LOL}','{BRU}');
DELETE FROM public.profiles WHERE id IN ('{SIL}','{LOL}','{BRU}');
DELETE FROM auth.users WHERE id IN ('{SIL}','{LOL}','{BRU}');
DELETE FROM public.universities WHERE id='{UNI}';
"""

FIXTURE = f"""
INSERT INTO public.universities (id,name,slug) VALUES ('{UNI}','Replay U','replay-u');
INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES
 ('{SIL}','sil-replay@example.test','{{}}'::jsonb),
 ('{LOL}','lol-replay@example.test','{{}}'::jsonb),
 ('{BRU}','bru-replay@example.test','{{}}'::jsonb);
INSERT INTO public.profiles
 (id,username,full_name,email_verified,onboarding_complete,onboarding_completed,university_id) VALUES
 ('{SIL}','silreplay','Sil Replay',true,true,true,'{UNI}'),
 ('{LOL}','lolreplay','Lol Replay',true,true,true,'{UNI}'),
 ('{BRU}','brureplay','Bru Replay',true,true,true,'{UNI}')
ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, email_verified=true,
 onboarding_complete=true, onboarding_completed=true, university_id=EXCLUDED.university_id;
INSERT INTO public.conversations (id,type,name,created_by)
 VALUES ('{CONV}','group','Replay Group','{SIL}');
INSERT INTO public.conversation_participants (conversation_id,user_id)
 VALUES ('{CONV}','{SIL}'),('{CONV}','{LOL}'),('{CONV}','{BRU}');
INSERT INTO public.messages
 (id,conversation_id,sender_id,message_type,attachment_url,attachment_name,attachment_mime) VALUES
 ('94000000-0000-0000-0000-000000000001','{CONV}','{SIL}','image','{IMG}','replay.png','image/png'),
 ('94000000-0000-0000-0000-000000000002','{CONV}','{SIL}','video','{VID}','replay.mp4','video/mp4'),
 ('94000000-0000-0000-0000-000000000003','{CONV}','{SIL}','file','{DOC}','replay.pdf','application/pdf');
"""


def upload(path, jwt):
    req(f"{STORAGE}/object/chat-attachments/{path}", jwt, "DELETE")
    st, _ = req(f"{STORAGE}/object/chat-attachments/{path}", jwt, "POST",
                raw=b"\x89PNG\r\n\x1a\n" + b"0" * 64, ctype=MIMES[path])
    return st


def sign(path, jwt, seconds=3600):
    st, body = req(f"{STORAGE}/object/sign/chat-attachments/{path}", jwt, "POST",
                   {"expiresIn": seconds})
    if st != 200:
        return st, None
    url = json.loads(body)["signedURL"]
    return st, (STORAGE + url if url.startswith("/") else url)


def authed(path, jwt):
    return req(f"{STORAGE}/object/authenticated/chat-attachments/{path}", jwt)


def run():
    print("Seeding fixture…")
    psql(CLEANUP)
    psql(FIXTURE)
    sil, lol, bru = token(SIL), token(LOL), token(BRU)
    for path in (IMG, VID, DOC):
        if upload(path, sil) not in (200, 201):
            sys.exit(f"fixture upload failed for {path}")

    # ── STEPS 1 + 2: Lola is authorized and gets working links ───────────────
    print("\nSTEPS 1-2 — Lola is authorized")
    old_links = {}
    for path, label in ((IMG, "image"), (VID, "video"), (DOC, "file")):
        st, url = sign(path, lol)
        old_links[path] = url
        check(f"1/2 Lola mints a {label} link while authorized", st == 200, str(st))
        st, data = authed(path, lol)
        check(f"1/2 Lola opens the {label} through the official path", st == 200 and len(data) > 0, str(st))

    # ── STEP 3 ───────────────────────────────────────────────────────────────
    print("\nSTEP 3 — Silvana blocks Lola")
    psql(f"INSERT INTO public.user_blocks (blocker_id,blocked_id) VALUES ('{SIL}','{LOL}');")

    # ── STEP 4: replay the exact same links ──────────────────────────────────
    print("\nSTEP 4 — replay the EXACT links issued in step 1")
    replayable = 0
    for path, label in ((IMG, "image"), (VID, "video"), (DOC, "file")):
        st, _ = req(old_links[path])
        if st == 200:
            replayable += 1
        print(f"        replayed {label:5} signed URL -> HTTP {st}")
    # This is the DEFECT being guarded against, asserted so the finding cannot
    # silently disappear: a signed URL is not revocable, which is exactly why
    # the official delivery path must not use one.
    check("4 signed URLs ARE replayable after a block (the reason for the fix)",
          replayable == 3, f"{replayable}/3 replayed")

    # ── THE OFFICIAL PATH: re-authorized on every fetch ──────────────────────
    print("\nOFFICIAL DELIVERY PATH — authorization checked at fetch time")
    for path, label in ((IMG, "image"), (VID, "video"), (DOC, "file")):
        st, _ = authed(path, lol)
        check(f"blocked viewer is refused the {label} on every fetch", st >= 400, str(st))
    for path, label in ((IMG, "image"), (VID, "video"), (DOC, "file")):
        st, _ = sign(path, lol)
        check(f"blocked viewer cannot mint a NEW {label} link", st >= 400, str(st))

    # Positive controls — the fix must not hide legitimate content.
    st, _ = authed(IMG, sil)
    check("POSITIVE the author still fetches their own attachment", st == 200, str(st))
    st, _ = authed(IMG, bru)
    check("POSITIVE an unrelated participant still fetches it", st == 200, str(st))

    # ── UNBLOCK restores ─────────────────────────────────────────────────────
    print("\nUNBLOCK — access returns")
    psql(f"DELETE FROM public.user_blocks WHERE blocker_id='{SIL}' AND blocked_id='{LOL}';")
    for path, label in ((IMG, "image"), (VID, "video"), (DOC, "file")):
        st, _ = authed(path, lol)
        check(f"unblocked viewer fetches the {label} again", st == 200, str(st))

    # ── Other revocation paths must also apply at fetch time ─────────────────
    print("\nOTHER ACCESS CHANGES — same fetch-time check")
    psql(f"DELETE FROM public.conversation_participants WHERE conversation_id='{CONV}' AND user_id='{LOL}';")
    st, _ = authed(IMG, lol)
    check("a removed participant is refused at fetch time", st >= 400, str(st))
    psql(f"INSERT INTO public.conversation_participants (conversation_id,user_id) VALUES ('{CONV}','{LOL}');")

    psql(f"""UPDATE public.messages SET deleted_at=now(), deletion_kind='sender_deleted',
             deleted_by='{SIL}' WHERE id='94000000-0000-0000-0000-000000000001';""")
    st, _ = authed(IMG, lol)
    check("a deleted message's attachment is refused at fetch time", st >= 400, str(st))
    psql("""UPDATE public.messages SET deleted_at=NULL, deletion_kind='active', deleted_by=NULL
            WHERE id='94000000-0000-0000-0000-000000000001';""")

    st, _ = req(f"{STORAGE}/object/authenticated/chat-attachments/{IMG}")
    check("an unauthenticated fetch is refused", st >= 400, str(st))

    print("\nCleaning up…")
    for path in (IMG, VID, DOC):
        req(f"{STORAGE}/object/chat-attachments/{path}", sil, "DELETE")
    psql(CLEANUP)

    failed = [r for r in results if not r[1]]
    print("\n" + "=" * 62)
    print(f"{len(results) - len(failed)}/{len(results)} attachment replay checks passed")
    if failed:
        for name, _, detail in failed:
            print(f"  FAILED: {name}  [{detail}]")
        sys.exit(1)
    print("All attachment replay checks passed.")


if __name__ == "__main__":
    run()
