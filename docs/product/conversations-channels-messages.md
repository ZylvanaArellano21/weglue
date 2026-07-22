# Conversations, Channels & Messages

## Hierarchy (do NOT flatten)

```
conversations
  └─ conversation_channels          (subchannels; is_default, is_restricted)
       └─ messages                  (message_type, content, attachments…)
            ├─ polls → poll_options → poll_votes   (poll attached via polls.message_id)
            ├─ shared_event_id  → events   (reference, CASCADE)
            └─ shared_post_id   → posts    (reference, CASCADE)
  └─ conversation_participants       (membership + last_read_at)
```

The dashboard must preserve this hierarchy in its data model and navigation.
Messages, channels, and conversations are **separate tables** — never merge them
into one admin table, and never copy full event/poll data into a message row
(shared content is referenced by id).

## Conversation types

`conversations.type` (TEXT) distinguishes: direct message, custom group chat,
club member chat, club officer chat. **Enumerate the exact string values from
migrations 001/035/040/041 before building type filters** (open-uncertainties.md).
`conversations.club_id` links club conversations to their club; `name`/
`avatar_url` are display copies of the club for club chats.

## Channels

`conversation_channels` are the subchannels (e.g. Main / Announcements / Events /
Resources / custom). Flags: `is_default`, `is_restricted`. Migration 041 adds:
- `channel_posters` — who may post (`post_permission`).
- `channel_mutes`, `channel_reads` — per-user mute/read state.

> ⚠️ **Authorization gap (confirmed):** migration 001 created
> `"conv_channels: participants can manage"` — a `FOR ALL` policy allowing **any
> participant** to insert/rename/delete channels. Migrations 010/041 added
> officer-scoped INSERT/DELETE policies but **never dropped the 001 `FOR ALL`
> policy**; because permissive policies are OR'd, any participant can still mutate
> channels. Intended per-type permissions must be re-established (own security
> task — see the phased security plan).

## Message payload types

`messages.message_type` (TEXT) + payload columns support at least: text
(`content`), image/file attachments (`attachment_url` + `attachment_mime`,
`attachment_name`, `attachment_size`), polls (via `polls.message_id`), shared
events (`shared_event_id`), shared posts (`shared_post_id`), and system messages.
**Enumerate the full `message_type` value set from migrations before building the
Messages filters** so every current payload is representable
(open-uncertainties.md).

## Deletion & retention (see deletion doc for the full rule)

`messages` carry `deleted_at`, `deleted_by` **only** (040:35). There is **no
`messages.hidden_at`** and **no snapshot columns on messages**. `hidden_at` is
per-user on `conversation_participants` (inbox "delete-for-me") and on the
`message_hides` table (per-user per-message hide). The protected retention
snapshot (`content_snapshot`/`attachment_snapshot`) lives on **`reports`** for
reported messages, not on `messages`. ⚠️ `unsend_message` does not null `content`,
and the SELECT RLS does not filter `deleted_at`, so deleted-message content is
currently retrievable by participants (see deletion doc).

## Admin implications

- Conversation/channel/message admin = filtered reads over these tables, with
  the report/deletion columns joined in.
- **Private-conversation access must be audited** (brief §22): opening a
  conversation's messages in the dashboard should require a reason and write an
  audit row, because it exposes private DMs. Prefer metadata/previews in list
  views; deliberate open for full content.
- Repair operations the dashboard should offer (all read-only to design first):
  conversations without valid participants, conversations without channels,
  channels without conversations, messages without a valid sender/channel,
  orphaned attachments, poll option/vote inconsistencies. These become the
  "Data Health" checks.
