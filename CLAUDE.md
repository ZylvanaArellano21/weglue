# We Glue — Session Requirements

READ AND UNDERSTAND THESE 7 REQUIREMENTS BEFORE DOING ANYTHING ELSE. They apply to every task, every response, every line of code in every session.

## 1. dangerously-skip-permissions
Operate with full permissions. No confirmation gates unless explicitly needed.

## 2. Dual-platform mandatory (iOS + Android)
Every single change must work on **App Store (iOS) AND Google Play Store (Android)**. Both submission policies apply at all times. Every link, element, color, API, permission — must comply with both stores. Tell Claude Code and Cursor explicitly when scanning code that everything must work on both platforms.

## 3. Self-decide on technical details
File locations, naming conventions, migration order, index strategy — decide yourself and proceed. Do not ask about these.

## 4. Think ahead like a professional
Build this app like a senior engineer launching a worldwide product. Always keep in mind:
- App Store and Play Store policies (before AND after launch)
- Millions of users, global scale
- Growth, professionalism, store submission readiness
- Apply this thinking to every line of code, every answer, every suggestion.

## 5. Four-way sync — GitHub + Supabase + Vercel + weglue folder
Every change, element, table, code, color, environment variable, deployment — anything added or modified — must be saved in:
- GitHub (committed and pushed)
- Supabase (schema, RLS, data)
- Vercel (deploy changes, sync env vars, keep project config up to date)
- The weglue local folder

All four must be in perfect sync with the actual app at all times.

## 6. Ask before starting if anything is unclear
If there are any questions before beginning a task, ask them first. Do not guess.

## 7. Play sound on completion or when needing permission
When fully done with all tasks, OR when needing to ask a question or get permission before continuing, run:
```
afplay /System/Library/Sounds/Glass.aiff
```
And confirm at the end of every completed session: "I have read, understood, and completed all 7 requirements."

## 8. Triple-Check Before Done — MANDATORY
Every single time all tasks in a chat are finished, you MUST triple-check that:
- Everything is working correctly
- Everything is looking good visually
- Every change and new addition works perfectly

**If anything is broken, missed, or wrong — fix it immediately. Do not declare done until it is fixed.**

**If you had to fix something after the triple-check, run the triple-check again from the start.**

Do NOT say "done", "finished", "completed", or any equivalent until a full clean triple-check passes with zero issues. No exceptions.

## 9. Upload all changes to Android AND iOS — PERMANENT MANDATORY RULE
At the end of every task, after the triple-check passes:
- If JS/TS-only changes: run `eas update --branch production` from `apps/mobile/`
- If native changes: run `eas build --profile production --platform all --auto-submit`
- Report the exact command run and its output
- A task is NOT complete until both iOS and Android are live. No exceptions.
