"use server";

/**
 * Signup consent is persisted by the auth.users INSERT trigger, which derives
 * the profile identity from NEW.id. There must not be a public server action
 * that accepts a caller-supplied profile UUID and writes with the service role.
 */
