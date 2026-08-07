#!/usr/bin/env python3
"""
CLUB PROFILE DATA-PATH MATRIX — run against a DISPOSABLE LOCAL stack.

WHY THIS EXISTS

The club profile page was reported as stuck on its loading skeleton forever.
The obvious suspicion was a broken query, a missing permission or a bad RPC, so
this file drives EVERY request `getClubProfile()` makes, as a real
`authenticated` student over PostgREST, and asserts each one succeeds.

It did not find a defect — every request returns 200 — and that negative result
is the point: it is the evidence that the club profile's DATA path is sound, so
a stuck skeleton is not a backend problem. See the audit for the rest of the
diagnosis (the failure reproduces only under `next dev`, intermittently, and
never on a production build).

Keeping the checks is still worthwhile: they are exactly the requests that
would break if a future migration removed a grant, renamed a column or changed
the club-profile RPC, and they now run on a database built from migrations
alone with no test-only grants bridge.

Usage:  python3 supabase/scripts/matrix_club_profile.py
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
import urllib.parse
import urllib.request

REST = "http://127.0.0.1:54321/rest/v1"
ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9."
    "CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
)
SECRET = "super-secret-jwt-token-with-at-least-32-characters-long"
CONTAINER = "supabase_db_weglue"

UNI = "c0000000-0000-4000-8000-0000000000a1"
VIEWER = "c1000000-0000-4000-8000-000000000001"
CLUB = "c2000000-0000-4000-8000-000000000001"

# Byte-identical to apps/web/lib/clubs/clubProfileService.ts. If either drifts,
# this harness stops testing the real page.
CLUB_SELECT = ("id, name, handle, description, avatar_url, banner_url, meeting_day, "
               "meeting_time_start, meeting_time_end, meeting_location, meeting_building, "
               "meeting_room, meeting_schedule")
CLUB_PHOTOS_SELECT = "id, url, source, post_id, caption, created_at"

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


def get(url, jwt, extra=None):
    r = urllib.request.Request(url)
    r.add_header("apikey", ANON)
    r.add_header("Authorization", f"Bearer {jwt}")
    for k, v in (extra or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, resp.read().decode()[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]
    except Exception as e:  # noqa: BLE001
        return 0, str(e)[:200]


def post(url, jwt, body):
    r = urllib.request.Request(url, method="POST")
    r.add_header("apikey", ANON)
    r.add_header("Authorization", f"Bearer {jwt}")
    r.add_header("Content-Type", "application/json")
    r.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, resp.read().decode()[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]
    except Exception as e:  # noqa: BLE001
        return 0, str(e)[:200]


CLEANUP = f"""
-- Migration 054 keeps a club from losing its last officer. Deleting an entire
-- fixture club legitimately does exactly that, so the floor trigger is disabled
-- for the teardown only.
ALTER TABLE public.club_members DISABLE TRIGGER USER;
DELETE FROM public.club_members WHERE club_id='{CLUB}';
ALTER TABLE public.club_members ENABLE TRIGGER USER;
DELETE FROM public.conversations WHERE club_id='{CLUB}';
DELETE FROM public.clubs WHERE id='{CLUB}';
DELETE FROM public.profiles WHERE id='{VIEWER}';
DELETE FROM auth.users WHERE id='{VIEWER}';
DELETE FROM public.universities WHERE id='{UNI}';
"""

FIXTURE = f"""
INSERT INTO public.universities (id,name,slug) VALUES ('{UNI}','Club Profile U','club-profile-u');
INSERT INTO auth.users (id,email,raw_app_meta_data)
 VALUES ('{VIEWER}','viewer-cp@example.test','{{}}'::jsonb);
INSERT INTO public.profiles
 (id,username,full_name,email_verified,onboarding_complete,onboarding_completed,university_id)
 VALUES ('{VIEWER}','viewercp','Viewer CP',true,true,true,'{UNI}')
ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, email_verified=true,
 onboarding_complete=true, onboarding_completed=true, university_id=EXCLUDED.university_id;
INSERT INTO public.clubs (id,name,handle,description,university_id)
 VALUES ('{CLUB}','Club Profile Matrix','x','A club used by the club-profile harness.','{UNI}');
INSERT INTO public.club_members (club_id,user_id,role) VALUES ('{CLUB}','{VIEWER}','officer');
"""


def run():
    print("Seeding fixture…")
    psql(CLEANUP)
    psql(FIXTURE)
    jwt = token(VIEWER)
    q = urllib.parse.quote

    print("\nEvery request getClubProfile() makes, as an authenticated student")
    probes = [
        ("clubs (.single)", f"{REST}/clubs?select={q(CLUB_SELECT)}&id=eq.{CLUB}",
         {"Accept": "application/vnd.pgrst.object+json"}),
        ("club_members count", f"{REST}/club_members?select=id&club_id=eq.{CLUB}",
         {"Prefer": "count=exact", "Range": "0-0"}),
        ("club_members (mine)", f"{REST}/club_members?select=role&club_id=eq.{CLUB}&user_id=eq.{VIEWER}", None),
        ("club_goals", f"{REST}/club_goals?select={q('id, goal_text, display_order')}"
                       f"&club_id=eq.{CLUB}&order=display_order", None),
        ("club_officers + profiles", f"{REST}/club_officers?select="
                                     f"{q('id, user_id, display_name, role_title, profiles(avatar_url)')}"
                                     f"&club_id=eq.{CLUB}", None),
        ("club_photos", f"{REST}/club_photos?select={q(CLUB_PHOTOS_SELECT)}&club_id=eq.{CLUB}"
                        f"&is_visible=eq.true&or=(source.eq.officer_upload,post_id.not.is.null)"
                        f"&order=created_at.desc", None),
        ("follows (following)", f"{REST}/follows?select=following_id&follower_id=eq.{VIEWER}"
                                f"&status=eq.accepted", None),
        ("follows (followers)", f"{REST}/follows?select=follower_id&following_id=eq.{VIEWER}"
                                f"&status=eq.accepted", None),
    ]
    for name, url, extra in probes:
        st, body = get(url, jwt, extra)
        check(f"{name} returns a payload", st in (200, 206), f"HTTP {st} {body}")

    st, body = post(f"{REST}/rpc/get_club_profile_events", jwt, {"p_club_id": CLUB})
    check("get_club_profile_events RPC returns a payload", st == 200, f"HTTP {st} {body}")

    # The two 074 readers the club surfaces also depend on.
    st, body = post(f"{REST}/rpc/club_shared_identities", jwt, {"p_club_id": CLUB})
    check("club_shared_identities RPC returns the roster", st == 200 and body.strip() != "[]",
          f"HTTP {st} {body}")

    # NEGATIVE control: anon must not be able to read the club roster or events,
    # or the checks above would pass on an over-granted database.
    st, _ = get(f"{REST}/club_members?select=role&club_id=eq.{CLUB}", ANON)
    check("NEGATIVE anon cannot read the club roster", st >= 400, f"HTTP {st}")

    print("\nCleaning up…")
    psql(CLEANUP)

    failed = [r for r in results if not r[1]]
    print("\n" + "=" * 62)
    print(f"{len(results) - len(failed)}/{len(results)} club-profile data-path checks passed")
    if failed:
        for name, _, detail in failed:
            print(f"  FAILED: {name}  [{detail}]")
        sys.exit(1)
    print("All club-profile data-path checks passed — the backend serves this page correctly.")


if __name__ == "__main__":
    run()
