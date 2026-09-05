#!/usr/bin/env node
/**
 * Backfills post_images.width/height for existing rows where either is NULL.
 *
 * Why this exists: migration 118 added width/height to post_images but never
 * backfilled pre-existing rows ("existing rows remain NULL" — see that
 * migration's own column comments). Every row still NULL forces the client
 * (apps/mobile + apps/web PhotoCarousel) to guess a fallback aspect ratio on
 * first render, then asynchronously measure the real image and change its
 * rendered height — a real, reproduced bug: on a short Home feed (as few as
 * one post) that late height change races the native scroll view's own
 * content-size bookkeeping, so the very first scroll-down attempt gets
 * clamped against the stale (too-small) bound and springs back to the top.
 * Filling in the real width/height here removes the guess-then-correct step
 * entirely for these rows, for good.
 *
 * SAFETY CONTRACT (do not weaken any of these without discussion):
 *   - READS the image bytes over plain HTTPS GET. Never uploads, deletes,
 *     renames, or recompresses anything in Storage. Never touches any row
 *     other than post_images.width/height.
 *   - Every UPDATE's WHERE clause repeats "(width IS NULL OR height IS NULL)"
 *     — even if a row's data changed between the SELECT and the UPDATE, a
 *     row that already has real values is structurally impossible to
 *     overwrite by this script. Re-running it is always safe: rows already
 *     filled in are simply excluded from the next SELECT.
 *   - image-size never decodes pixel data — it reads only the header bytes
 *     needed to report dimensions. The source file is never modified.
 *   - A row whose image can't be fetched or parsed is reported and skipped.
 *     Dimensions are NEVER guessed or estimated — a skipped row is simply
 *     left NULL, exactly as it is today, for a human to look at.
 *   - Defaults to --dry-run (the only mode that requires no flag). Writing
 *     to production requires the explicit --execute flag. Dry-run still
 *     performs the real fetch + measure step, so its report is the exact
 *     preview of what --execute would write — not a guess about a guess.
 *   - Writes happen through `supabase db query --linked`, the same
 *     Management-API-authenticated channel already used read-only elsewhere
 *     in this session — no service-role key or new secret is introduced.
 *
 * Usage:
 *   node supabase/scripts/backfill_post_image_dimensions.mjs                # dry run (default)
 *   node supabase/scripts/backfill_post_image_dimensions.mjs --execute      # writes to production
 *   node supabase/scripts/backfill_post_image_dimensions.mjs --batch-size 5 --delay-ms 500
 *
 * Rollback: this only ever changes a row from NULL -> a real number, never
 * the reverse, so nothing existing is ever at risk. If a specific written
 * value ever needs undoing, the exact recovery statement is:
 *   UPDATE public.post_images SET width = NULL, height = NULL WHERE id IN (<ids>);
 * (print the ids that were actually written — this script does, in its
 * final summary — before running that if it's ever needed.)
 */

import { execFileSync } from "node:child_process";
import { imageSize } from "image-size";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const BATCH_SIZE = Number(argFlag("--batch-size") ?? 10);
const DELAY_MS = Number(argFlag("--delay-ms") ?? 250);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1) {
  console.error(`--batch-size must be a positive integer, got: ${BATCH_SIZE}`);
  process.exit(1);
}
if (!Number.isFinite(DELAY_MS) || DELAY_MS < 0) {
  console.error(`--delay-ms must be a non-negative number, got: ${DELAY_MS}`);
  process.exit(1);
}

function argFlag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs a read-only or write SQL statement via the linked project's
 *  Management-API channel. Same mechanism already used read-only in this
 *  session — no new secret, no new client. */
function dbQuery(sql) {
  const raw = execFileSync(
    "supabase",
    ["db", "query", "--linked", sql, "--output-format", "json"],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 16 }
  );
  // The CLI prints a one-line status ("Initialising login role...") before
  // the JSON payload on some invocations — take the JSON object, wherever it
  // starts.
  const jsonStart = raw.indexOf("{");
  return JSON.parse(raw.slice(jsonStart));
}

async function fetchMissingRows() {
  const result = dbQuery(
    "SELECT id, post_id, storage_path FROM public.post_images WHERE width IS NULL OR height IS NULL ORDER BY created_at;"
  );
  return result.rows ?? [];
}

const FETCH_TIMEOUT_MS = 20_000;

/** Fetches the image over plain HTTPS GET and measures it. Never writes
 *  anything. Returns { width, height } or throws with a clear reason. Bounded
 *  by FETCH_TIMEOUT_MS so one unresponsive URL can't stall the whole run —
 *  it's treated the same as any other unreadable-file failure: reported and
 *  skipped, never guessed. */
async function measure(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`timed out after ${FETCH_TIMEOUT_MS}ms fetching image`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`);
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(`unexpected content-type "${contentType}"`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const dims = imageSize(buf); // header-only read — never decodes pixels
  if (!dims.width || !dims.height || dims.width <= 0 || dims.height <= 0) {
    throw new Error("image-size returned no usable dimensions");
  }
  if (!Number.isInteger(dims.width) || !Number.isInteger(dims.height)) {
    throw new Error("measured dimensions were not whole numbers");
  }
  return { width: dims.width, height: dims.height };
}

/** Writes one batch's measured dimensions in a single atomic UPDATE.
 *  Every id is validated as a UUID and every width/height as a positive
 *  integer before being interpolated — nothing here is free-text or
 *  user-supplied, but this is deliberately defensive anyway. */
function writeBatch(rows) {
  for (const r of rows) {
    if (!UUID_RE.test(r.id)) throw new Error(`refusing to write non-UUID id: ${r.id}`);
    if (!Number.isInteger(r.width) || r.width <= 0) throw new Error(`bad width for ${r.id}`);
    if (!Number.isInteger(r.height) || r.height <= 0) throw new Error(`bad height for ${r.id}`);
  }
  const values = rows
    .map((r) => `('${r.id}'::uuid, ${r.width}, ${r.height})`)
    .join(", ");
  // COALESCE, not a bare assignment: a row could in principle already have
  // ONE of the two columns set (e.g. a future caller fills width but not
  // height). Only the still-NULL column gets the measured value — a column
  // that already holds a real value is structurally impossible for this
  // statement to overwrite, no matter what the (unused, for this exact row)
  // measured value is.
  const sql = `
    UPDATE public.post_images AS pi
    SET width = COALESCE(pi.width, v.width), height = COALESCE(pi.height, v.height)
    FROM (VALUES ${values}) AS v(id, width, height)
    WHERE pi.id = v.id AND (pi.width IS NULL OR pi.height IS NULL)
    RETURNING pi.id;
  `.trim();
  return { sql, result: dbQuery(sql) };
}

async function main() {
  console.log(`Mode: ${EXECUTE ? "EXECUTE (will write to production)" : "DRY RUN (no writes)"}`);
  console.log(`Batch size: ${BATCH_SIZE}, delay between batches: ${DELAY_MS}ms\n`);

  const rows = await fetchMissingRows();
  console.log(`Found ${rows.length} row(s) in post_images with width IS NULL OR height IS NULL.\n`);
  if (rows.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const measured = [];
  const failed = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    console.log(`Measuring batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} row(s))...`);
    for (const row of batch) {
      try {
        const dims = await measure(row.storage_path);
        measured.push({ ...row, ...dims });
        console.log(`  OK   ${row.id}  ${dims.width}x${dims.height}  ${row.storage_path}`);
      } catch (err) {
        failed.push({ ...row, reason: err instanceof Error ? err.message : String(err) });
        console.log(`  SKIP ${row.id}  ${err instanceof Error ? err.message : err}  ${row.storage_path}`);
      }
    }
    if (i + BATCH_SIZE < rows.length) await sleep(DELAY_MS);
  }

  console.log(`\nMeasured OK: ${measured.length}. Skipped (unreadable/unparseable): ${failed.length}.`);
  if (failed.length > 0) {
    console.log("\nSkipped rows (left untouched, NOT guessed):");
    for (const f of failed) console.log(`  ${f.id}  post_id=${f.post_id}  reason: ${f.reason}`);
  }

  if (measured.length === 0) {
    console.log("\nNo rows to write.");
    return;
  }

  console.log(`\n${EXECUTE ? "Writing" : "Would write"} ${measured.length} row(s):`);
  const writtenIds = [];
  for (let i = 0; i < measured.length; i += BATCH_SIZE) {
    const batch = measured.slice(i, i + BATCH_SIZE);
    const values = batch.map((r) => `('${r.id}'::uuid, ${r.width}, ${r.height})`).join(", ");
    const previewSql = `UPDATE public.post_images AS pi SET width = COALESCE(pi.width, v.width), height = COALESCE(pi.height, v.height) FROM (VALUES ${values}) AS v(id, width, height) WHERE pi.id = v.id AND (pi.width IS NULL OR pi.height IS NULL);`;
    console.log(`\n  ${previewSql}`);

    if (EXECUTE) {
      const { result } = writeBatch(batch);
      const ids = (result.rows ?? []).map((r) => r.id);
      writtenIds.push(...ids);
      console.log(`  -> updated ${ids.length} row(s)`);
      if (i + BATCH_SIZE < measured.length) await sleep(DELAY_MS);
    }
  }

  if (EXECUTE) {
    console.log(`\nDone. Updated ${writtenIds.length} row(s).`);
    if (writtenIds.length > 0) {
      console.log("\nRollback (only if ever needed — sets these specific rows back to NULL):");
      console.log(
        `  UPDATE public.post_images SET width = NULL, height = NULL WHERE id IN (${writtenIds
          .map((id) => `'${id}'::uuid`)
          .join(", ")});`
      );
    }
  } else {
    console.log("\nThis was a dry run — no production write occurred. Re-run with --execute to apply.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
