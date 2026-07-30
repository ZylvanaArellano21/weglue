#!/usr/bin/env node
// ============================================================================
// Generate the private administrator entry-gateway secrets.
//
//   node apps/web/scripts/generate-admin-entry-secrets.mjs
//
// Prompts for the access phrase with echo OFF, then prints ONLY:
//   • ADMIN_ENTRY_SECRET_HASH   — a salted scrypt digest (phrase unrecoverable)
//   • ADMIN_ENTRY_COOKIE_SECRET — a fresh 48-byte random key
//
// The plaintext phrase is never echoed, never written to disk, never logged, and
// never leaves this process. Paste the two values straight into Vercel.
//
// Choose ADMIN_ENTRY_PATH yourself and enter it directly in Vercel — this script
// deliberately does not generate or handle it, so it never appears in any output
// that might be copied into a transcript.
// ============================================================================

import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_MAXMEM = 96 * 1024 * 1024;
const MIN_PHRASE_LENGTH = 16;

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const stdin = process.stdin;
    const onData = (char) => {
      const s = char.toString("utf8");
      // Ctrl-C / Ctrl-D — abort without printing anything.
      if (s === "" || s === "") {
        cleanup();
        reject(new Error("aborted"));
      }
    };
    const cleanup = () => {
      stdin.removeListener("data", onData);
      if (typeof stdin.setRawMode === "function") stdin.setRawMode(false);
      rl.close();
    };
    // Suppress echo so the phrase never appears on screen or in scrollback.
    rl.output.write(question);
    const origWrite = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = function () {
      /* echo nothing */
    };
    stdin.on("data", onData);
    rl.question("", (answer) => {
      rl._writeToOutput = origWrite ?? rl._writeToOutput;
      rl.output.write("\n");
      cleanup();
      resolve(answer);
    });
  });
}

function createScryptHash(phrase) {
  const salt = randomBytes(16);
  const hash = scryptSync(phrase, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64"), hash.toString("base64")].join("$");
}

const phrase = await promptHidden("Access phrase (not echoed): ");
const confirm = await promptHidden("Confirm phrase:            ");

if (phrase !== confirm) {
  console.error("\nPhrases did not match. Nothing generated.");
  process.exit(1);
}
if (phrase.length < MIN_PHRASE_LENGTH) {
  console.error(
    `\nPhrase must be at least ${MIN_PHRASE_LENGTH} characters. Use a long, random passphrase.`
  );
  process.exit(1);
}

const hash = createScryptHash(phrase);
const cookieSecret = randomBytes(48).toString("base64url");

console.log(`
Paste these into Vercel → Settings → Environment Variables
(targets: Production AND Preview; never prefix with NEXT_PUBLIC_)

ADMIN_ENTRY_SECRET_HASH
${hash}

ADMIN_ENTRY_COOKIE_SECRET
${cookieSecret}

Still to set manually (choose these yourself, do not paste them anywhere else):
  ADMIN_ENTRY_PATH                e.g. a long unguessable path beginning with "/"
  ADMIN_ENTRY_COOKIE_TTL_MINUTES  10

Then redeploy — these are read at build time by Edge middleware.
`);
