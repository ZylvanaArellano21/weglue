const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DeleteMessageRequest = {
  messageId: string;
  idempotencyKey: string;
};

/** Parse only the two opaque UUIDs accepted by the deletion endpoint. */
export function parseDeleteMessageRequest(input: unknown): DeleteMessageRequest | null {
  if (!input || typeof input !== "object") return null;
  const { messageId, idempotencyKey } = input as Record<string, unknown>;
  if (typeof messageId !== "string" || typeof idempotencyKey !== "string") return null;
  if (!UUID_RE.test(messageId) || !UUID_RE.test(idempotencyKey)) return null;
  return { messageId, idempotencyKey };
}
