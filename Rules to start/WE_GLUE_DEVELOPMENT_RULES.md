# We Glue Development and Release Rules
These 16 requirements are mandatory and apply to every Claude and Codex session, task, and response involving the We Glue repository.

## 1. Mandatory Supabase ↔ Admin Dashboard Parity Rule

Every time Claude, Codex, or any agent makes **any Supabase/backend change, no matter how small**, it must check whether the We Glue Admin Dashboard needs to be updated.

This applies to **all changes**, including new or modified tables, columns, fields, relationships, foreign keys, data structures, enums/statuses, views, RPC/database functions, triggers, RLS policies, permissions, storage/buckets/file paths, Edge Functions, webhooks, URLs/deep links, admin/moderation capabilities, renamed/deleted objects, backend features, and anything affecting what data exists, how it is accessed, or how it behaves.

After every change:

1. Inspect whether the Admin Dashboard needs to display, search, filter, inspect, create, edit, delete, moderate, manage, or otherwise understand anything affected by the change.

2. If the dashboard needs an update, **make that update as part of the same task. Do not postpone it.**

3. Make sure existing dashboard pages, queries, statistics, filters, relationships, detail views, and admin actions remain compatible with the changed Supabase schema.

4. Test that dashboard data loads correctly, relationships remain correct, admin actions work, RLS/permissions do not break required dashboard functionality, and renamed/deleted Supabase fields or objects are no longer incorrectly referenced.

5. If the Supabase change is applied to **production**, verify the Admin Dashboard against the **actual production Supabase schema/environment**, not only local or staging.

### Dashboard Parity Rule

Dashboard parity does **not** mean exposing every technical Supabase object as a visible dashboard screen.

Purely internal technical objects such as performance indexes, infrastructure, low-level helper functions, or implementation details do not need their own dashboard UI unless they are useful for **administration, moderation, operations, debugging, or understanding We Glue activity/system behavior**.

However, **every Supabase change must still be inspected for dashboard impact**. If a change affects existing dashboard functionality or introduces information/capabilities that admins should reasonably see or manage, the dashboard **must be updated**.

Never expose secrets, private tokens, service-role credentials, security-sensitive information, or backend information that should not be visible to dashboard users.

### Completion Gate

A Supabase/backend task is **NOT complete until Admin Dashboard parity has been checked**.

Every applicable task must end with exactly one of:

**Admin Dashboard Impact: UPDATED**
The dashboard required changes, and they were completed and verified.

**Admin Dashboard Impact: VERIFIED — NO UPDATE REQUIRED**
The dashboard was inspected and the Supabase/backend change requires no dashboard modification.

**Never assume that because Supabase works, the Admin Dashboard is automatically up to date. Supabase and the We Glue Admin Dashboard must evolve together.**

## 2. Work on Separate Tasks
Claude and Codex may work during the same day, but they must use separate task branches or worktrees.

Do not:
- Work directly on `main`
- Overwrite another agent’s branch
- Mix unrelated tasks in one branch
- Modify another active task without reviewing its current state
- Assume another agent’s work is finished

Before changing code, inspect:
- Current branch
- Git status
- Recent commits
- Relevant open branches and pull requests
- Concurrent Claude or Codex work that could conflict

Claude, Codex, and ChatGPT may all assist with We Glue, so always account for work that another agent may be doing.

## 3. Follow the Required Task Workflow
Every finished task must follow this sequence:

Create branch → Code → Save files → Test → Review diff → Commit → Push → Open PR → Wait for approval → Merge into `main`

A task is not complete merely because the code works locally.

## 4. Only Finished Work Enters `main`
Only code that is:
- Saved
- Tested
- Committed
- Pushed
- Reviewed
- Approved
- Merged through a pull request

may enter `main`.

Incomplete, experimental, or partially tested work must remain on its task branch and must not be merged.

## 5. Obtain User Approval Before Merging
Claude and Codex may create and update pull requests, but they must not merge a task until the user approves it.

Before requesting approval, report:
- Task objective
- Branch
- Commits
- Pull request number
- Files changed
- Tests run
- Test results
- Migrations required
- Deployments required
- Blockers
- Unrelated findings
- Explicit GO or NO-GO for merge

## 6. Keep All Applicable We Glue Systems Synchronized
After an approved pull request is merged into `main`, verify synchronization across all applicable systems:

1. Local We Glue repository folder
2. GitHub `main`
3. Vercel Production
4. Supabase Production

Requirements:
- The local We Glue repository must be updated to the approved `main`.
- GitHub `main` must contain the approved merge commit.
- Web changes must deploy successfully to Vercel Production.
- Supabase migrations, Edge Functions, RPCs, policies, secrets, schedules, or configuration must be deployed when the task includes Supabase changes.
- Deployment status must be verified rather than assumed.
- Report the exact commit, migration ledger, deployment, or function version when applicable.

Do not make unnecessary Vercel or Supabase changes.
When a system is unaffected, explicitly report:
- `No Vercel deployment required`
- `No Supabase deployment required`

All applicable systems must reflect the same approved code and schema state.

## 7. Do Not Release Mobile Changes During Development
Claude and Codex must not independently:
- Publish an EAS Update
- Create an iOS release build
- Create an Android release build
- Upload to App Store Connect
- Submit to App Review
- Upload to Google Play
- Change a Google Play release track
- Roll out a mobile release

unless the user gives explicit release authorization.
Merging code into `main` does not authorize a mobile release.

## 8. Release Only Approved Code From `main`
Mobile releases may include only the exact approved code merged into `main`.

Never release from:
- An unmerged feature branch
- A dirty worktree
- Uncommitted files
- An unknown commit
- A branch containing unrelated or unapproved work

The exact release commit must be recorded before any release operation begins.

## 9. Use One Release Manager
Claude and Codex must not both release the same mobile version.
At the end of the day, one dedicated Codex release session is the only mobile release manager.
It must first analyze the exact current `main` commit and determine whether the changes require:
- A compatible OTA/EAS Update
- New native builds
- Holding changes for the next App Store version
- A manual product or release decision

The analysis phase must not publish, build, submit, or release anything.

## 10. Obtain User Approval Before Release Execution
Before any mobile release, the release manager must return:
- Exact `main` commit analyzed
- Pull requests included
- Complete mobile delta
- Currently distributed iOS build
- Currently distributed Android build
- Runtime-version comparison
- Native-fingerprint comparison
- OTA technical compatibility
- OTA policy appropriateness
- Native-build requirement
- Existing store-review conflicts
- Proposed version and build numbers
- Recommended release path
- Explicit GO or NO-GO

No OTA, build, upload, submission, or rollout may begin until the user approves the recommended path.

Before executing, confirm that `main` has not changed since the analysis.

## 11. Use the Correct Store Destinations
When the user authorizes a native release:

### iOS
The final destination is the public Apple App Store, not only TestFlight.
Codex may create and upload the build, but the user normally will do:
- Opens the correct App Store version
- Attaches the correct uploaded build
- Reviews metadata and release notes
- Clicks **Add for Review**
- Clicks **Submit for Review**

TestFlight may be used for QA, but it is not the final public release.
The App is already approved on App store for the public

### Android
The current destination is:
`Google Play → Internal Testing `
unless the user explicitly changes this rule.

The App is already approved on Play Store for the public

## 12. Do Not Replace Submitted Releases for Ordinary Changes
When an iOS version is already under Apple review:
- Ordinary new features wait for the next App Store version.
- Native changes wait for the next App Store version.
- Compatible minor corrections may be evaluated for OTA.
- Only critical crashes, security problems, data-loss risks, legal problems, or severe defects justify replacing the submitted build.
Do not restart App Review merely to add another ordinary feature.

## 13. Provide a Final Task Checkpoint
At the end of every task, return:
- Objective
- Completed work
- Product decisions followed
- Branch
- Commits
- Pull request
- Merge status
- Files changed
- Tests and results
- Local repository status
- GitHub status
- Vercel status
- Supabase status
- Mobile release status
- Unfinished work
- Blockers
- Exact next action
- Whether the terminal/session is safe to close

Do not claim completion when any required code, test, merge, synchronization, or deployment step remains unfinished.

## 14. Think Ahead — Professional, Scalable, and Store-Ready
Build as a professional engineer shipping a worldwide application for millions of users.
Always consider:
- Apple App Store requirements
- Google Play requirements
- Pre-launch and post-launch behavior
- Performance and scalability
- Database and API load
- Concurrency and race conditions
- Security and privacy
- Maintainability
- Monitoring and observability
- Failure recovery
- Backward compatibility
- Accessibility
- Internationalization readiness
- Worldwide audience support
- Applicable legal and policy requirements
- Store disclosure implications
- Professional code quality

Do not implement temporary shortcuts that create unsafe, fragile, unscalable, or difficult-to-maintain Production behavior.

Do not overengineer unrelated systems, but ensure the requested implementation is Production-ready.

## 15. Ask Questions Before Starting
Before changing code, identify any blockers, ambiguities, risks, or product decisions that require the user’s input.

Surface all genuinely necessary questions before implementation begins—not halfway through the work.

Examples include:
- Conflicting product requirements
- Unclear destructive behavior
- Missing release authorization
- Unclear store destination
- Required credentials or access that are unavailable
- Migration-number collisions
- Data-retention decisions
- Security or privacy choices
- Multiple valid designs with materially different consequences
- Unclear interaction with concurrent Claude or Codex work

Do not ask unnecessary questions when the correct answer can be determined safely by inspecting the repository, tests, schema, documentation, or current configuration.

After the user answers, restate the approved decisions before implementation.

## 16. Play a Completion Sound
After completing all tasks in a prompt, or when user approval is required before continuing, run:
```bash
afplay /System/Library/Sounds/Glass.aiff
and then say this ONLY IF ITS TRUE AND ACCURATE:
“I have read, understood, and completed all the 16 requirements.”
