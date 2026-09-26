import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRun } from './analyze.js';
import { prepareSessions } from './auth.js';
import { runCampaign } from './campaign.js';
import { cleanupSyntheticData, resetActionWrites } from './cleanup.js';
import { compareRuns, loadRun, renderMarkdown } from './compare.js';
import { assertCampaignApproved, assertWriteApproved, loadConfig, plannedJoinsPerSecond } from './config.js';
import { assertComparisonMigrations, buildContract } from './contract.js';
import { buildPlateaus, campaignSeconds } from './ramp.js';
import { generateTrace, writeTrace } from './trace.js';
import { runPreflight } from './preflight.js';
import { seedSyntheticData } from './seed.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const [command, ...args] = process.argv.slice(2);
const USAGE = 'Usage: cli.js <plan|preflight|trace|seed|prepare-auth|reset-actions|cleanup|campaign> | analyze <run-dir> | compare --pre <run-dir>... --post <run-dir>... [--out <file-prefix>]';

function flagValues(flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue;
    for (let next = index + 1; next < args.length && !args[next]!.startsWith('--'); next += 1) values.push(args[next]!);
  }
  return values;
}

async function main(): Promise<void> {
  // Offline commands: read local result files only; no target configuration.
  if (command === 'analyze') {
    const runDir = args[0];
    if (!runDir) throw new Error(USAGE);
    const analysis = analyzeRun(resolve(runDir));
    writeFileSync(resolve(runDir, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ runId: analysis.runId, invalid: analysis.invalid, safeTestedConcurrency: analysis.safeTestedConcurrency, degradationPoint: analysis.degradationPoint, breakingPoint: analysis.breakingPoint }, null, 2)}\n`);
    return;
  }
  if (command === 'compare') {
    const pre = flagValues('--pre').map((dir) => loadRun(resolve(dir)));
    const post = flagValues('--post').map((dir) => loadRun(resolve(dir)));
    const report = compareRuns(pre, post);
    const out = flagValues('--out')[0];
    if (out) {
      mkdirSync(dirname(resolve(out)), { recursive: true });
      writeFileSync(`${resolve(out)}.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      writeFileSync(`${resolve(out)}.md`, renderMarkdown(report), 'utf8');
    }
    process.stdout.write(renderMarkdown(report));
    if (report.verdict === 'INVALID') process.exitCode = 2;
    return;
  }

  const config = loadConfig();
  if (command === 'plan') {
    assertComparisonMigrations(repoRoot);
    const plateaus = buildPlateaus(config.requestedUsers, config.scenario, config.coldConnectRate);
    process.stdout.write(`${JSON.stringify({
      targetRef: config.stagingRef,
      state: config.state,
      scenario: config.scenario,
      cacheMode: config.cacheMode,
      runLabel: config.runLabel,
      applicationContract: buildContract(config.state, repoRoot).applicationCommit,
      requestedUsers: config.requestedUsers,
      verifiedRealtimeLimit: config.realtimeLimit,
      effectiveCeiling: config.effectiveCeiling,
      plannedPeakJoinsPerSecond: plannedJoinsPerSecond(config.requestedUsers, config.scenario, config.coldConnectRate),
      joinsPerSecondBudget: Math.floor(config.joinsPerSecondLimit * 0.75),
      idleBaselineSeconds: config.idleBaselineSeconds,
      plateaus,
      campaignSecondsExcludingIdle: campaignSeconds(plateaus),
      namespace: config.namespace,
      runDir: config.runDir,
      writesApproved: config.writeApproved,
      campaignApproved: config.campaignApproved,
    }, null, 2)}\n`);
    return;
  }
  if (command === 'preflight') {
    const report = await runPreflight(config, repoRoot);
    process.stdout.write(`${JSON.stringify({ ...report, fingerprint: { sections: report.fingerprint.sections, objectCount: Object.keys(report.fingerprint.objects).length } }, null, 2)}\n`);
    return;
  }
  if (command === 'trace') {
    const trace = generateTrace(config.namespace, config.seed, config.requestedUsers);
    writeTrace(config.traceFile, trace);
    process.stdout.write(`Wrote ${config.traceFile} (${trace.sha256})\n`);
    return;
  }
  // Approval gates run before any network access.
  if (command === 'seed' || command === 'reset-actions' || command === 'cleanup') assertWriteApproved(config);
  if (command === 'campaign') assertCampaignApproved(config);
  if (command === 'seed') {
    await runPreflight(config, repoRoot);
    const manifest = await seedSyntheticData(config);
    process.stdout.write(`Seeded ${manifest.users.length} synthetic users; manifest ${config.manifestFile}\n`);
    return;
  }
  if (command === 'prepare-auth') {
    await runPreflight(config, repoRoot);
    const bundle = await prepareSessions(config);
    process.stdout.write(`Prepared ${bundle.sessions.length} synthetic sessions in ${config.sessionsFile}\n`);
    return;
  }
  if (command === 'reset-actions') {
    await runPreflight(config, repoRoot);
    process.stdout.write(`${JSON.stringify(await resetActionWrites(config), null, 2)}\n`);
    return;
  }
  if (command === 'cleanup') {
    await runPreflight(config, repoRoot);
    await cleanupSyntheticData(config);
    return;
  }
  if (command === 'campaign') {
    const manifest = await runCampaign(config, repoRoot);
    process.stdout.write(`Campaign ${manifest.runId} finished: ${manifest.status}${manifest.stopReason ? ` (${manifest.stopReason})` : ''}\n`);
    return;
  }
  throw new Error(USAGE);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
