import { supabase } from '../lib/supabase';
import { clientUuid } from '../lib/chatAttachments';

// ─── The ONE product message-deletion entry point ───────────────────────────
//
// Every "delete/unsend for everyone" action — thread (DM), custom group,
// club_group, officer_chat, and club channels — routes through here. It invokes
// the `delete-message` Edge Function, which is the single approved secure
// deletion architecture (deleted-message privacy v9,
// docs/product/deleted-message-privacy.md):
//
//   • server re-verifies authorization (sender / custom-group creator / club
//     officer) — the client is never trusted for a role;
//   • snapshots the original to founder-only history and redacts canonical
//     content in one PostgreSQL transaction (fail-closed);
//   • orchestrates managed-attachment retention + removal in Storage;
//   • scrubs pending pushes; poll / Realtime / report protections apply.
//
// It NEVER hard-deletes and NEVER writes the `messages` table from the client.
// (Direct client deletes are also revoked at the DB level in migration 051.)
//
// Old store binaries that predate this build still call the legacy
// `unsend_message` RPC directly; that RPC remains as secure server-side
// back-compat (it redacts non-managed messages and returns
// `secure_deletion_required` for managed attachments). New client code must use
// this function only.

export type SecureDeleteStatus =
  | 'completed'
  | 'already_deleted'
  | 'accepted'
  | 'manual_reconciliation';

/**
 * Securely delete a message for everyone. Resolves once the server has
 * accepted and made the content fail-closed; throws a machine-readable code
 * (e.g. `not_found_or_not_authorized`, `secure_deletion_required`) on failure.
 */
export async function secureDeleteMessage(
  messageId: string,
): Promise<SecureDeleteStatus> {
  const { data, error } = await supabase.functions.invoke('delete-message', {
    body: { message_id: messageId, idempotency_key: clientUuid() },
  });

  if (error) {
    // A FunctionsHttpError carries the machine-readable {error} code in the
    // response body; surface it so callers/UI can react (e.g. show a specific
    // message) instead of an opaque "Edge Function error".
    let code: string | undefined;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        code = ((await ctx.json()) as { error?: string })?.error;
      }
    } catch {
      // ignore body-parse failures; fall back to the generic message
    }
    throw new Error(code ?? error.message ?? 'delete_failed');
  }

  return (data as { status?: SecureDeleteStatus })?.status ?? 'completed';
}
