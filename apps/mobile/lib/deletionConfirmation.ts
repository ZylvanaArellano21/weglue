// The typed-confirmation gate for permanent account deletion.
//
// Deliberately side-effect free and dependency free — it must be importable by
// a unit test without dragging in the Supabase client (which needs env vars at
// module load) or anything else from the account layer.

/** The word the user must type before the destructive action is armed. */
export const DELETE_CONFIRMATION_WORD = 'DELETE';

/**
 * True only for a deliberate confirmation. Casing and surrounding whitespace
 * are forgiven because mobile keyboards add both; nothing else is.
 */
export function isDeletionConfirmed(input: string): boolean {
  return input.trim().toUpperCase() === DELETE_CONFIRMATION_WORD;
}
