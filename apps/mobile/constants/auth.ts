/**
 * PERMANENT STANDARD — exact wait times in error copy:
 *
 * All user-facing wait-time messages MUST reference RESEND_COOLDOWN_SECONDS
 * directly, e.g. `Wait ${RESEND_COOLDOWN_SECONDS} seconds and try again.`
 *
 * Never write vague language like "wait a moment", "try again shortly", or
 * "please wait". If a wait time is controlled by a third party (e.g. Supabase
 * server-side rate limits, network back-off), say so explicitly instead of
 * guessing — e.g. "Rate limited by the server. Try again in a few minutes."
 * Flag any unpredictable-duration case for a product decision rather than
 * choosing a number arbitrarily.
 *
 * This constant is the single source of truth for the client-side resend
 * cooldown. Both the button countdown display and error copy must derive from
 * it so they can never drift apart.
 */
export const RESEND_COOLDOWN_SECONDS = 60;
