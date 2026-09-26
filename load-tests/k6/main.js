import http from 'k6/http';
import exec from 'k6/execution';
import crypto from 'k6/crypto';
import { SharedArray } from 'k6/data';
import { check, fail, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { actionClientTag, assertAllowedStages, buildJourney, JOURNEY_NAMES } from './lib/journeys.js';
import { uuidFromSha256Hex } from './lib/uuid.js';

// One k6 process runs exactly one plateau (ramp → hold → ramp-down). The
// supervisor (src/campaign.ts) decides whether the next plateau may start.

for (const name of Object.keys(__ENV)) {
  if (/SERVICE_ROLE|DATABASE_URL/i.test(name)) throw new Error(`k6 must not receive privileged variable ${name}`);
}

const baseUrl = __ENV.LOADTEST_SUPABASE_URL;
const anonKey = __ENV.LOADTEST_SUPABASE_ANON_KEY;
const namespace = __ENV.LOADTEST_NAMESPACE;
const state = __ENV.LOADTEST_EXPECTED_STATE;
const maxUsers = Number(__ENV.LOADTEST_REQUESTED_USERS);
const effectiveCeiling = Number(__ENV.LOADTEST_EFFECTIVE_CEILING);
const plateauIndex = Number(__ENV.LOADTEST_PLATEAU_INDEX);
const plateauUsers = Number(__ENV.LOADTEST_PLATEAU_USERS);
const rampSeconds = Number(__ENV.LOADTEST_PLATEAU_RAMP_SECONDS);
const holdSeconds = Number(__ENV.LOADTEST_PLATEAU_HOLD_SECONDS);
const rampDownSeconds = Number(__ENV.LOADTEST_PLATEAU_RAMP_DOWN_SECONDS);
if (!baseUrl || !anonKey || !namespace || !state) throw new Error('k6 environment is incomplete');
if (![plateauIndex, plateauUsers, rampSeconds, holdSeconds, rampDownSeconds].every((value) => Number.isInteger(value) && value >= 0)) {
  throw new Error('k6 plateau configuration is invalid');
}
if (plateauUsers < 1 || plateauUsers > maxUsers || maxUsers > 150 || maxUsers > effectiveCeiling) throw new Error('k6 user ceiling guard rejected the plateau');

const manifest = JSON.parse(open(__ENV.LOADTEST_MANIFEST_FILE));
const sessionBundle = JSON.parse(open(__ENV.LOADTEST_SESSIONS_FILE));
const traceHeader = new SharedArray('trace-header', () => {
  const trace = JSON.parse(open(__ENV.LOADTEST_TRACE_FILE));
  return [{ namespace: trace.namespace, seed: trace.seed, users: trace.users, sha256: trace.sha256, applicationContract: trace.applicationContract, iterationsPerUser: trace.iterationsPerUser }];
})[0];
// Per-user action lists, shared read-only across VUs.
const userActions = new SharedArray('trace-actions', () => {
  const trace = JSON.parse(open(__ENV.LOADTEST_TRACE_FILE));
  const grouped = Array.from({ length: trace.users }, () => []);
  for (const action of trace.actions) grouped[action.userIndex].push(action);
  return grouped;
});
if (traceHeader.namespace !== namespace || traceHeader.users !== maxUsers || manifest.namespace !== namespace || sessionBundle.namespace !== namespace) {
  throw new Error('k6 artifact identity mismatch');
}

const totalSeconds = rampSeconds + holdSeconds + rampDownSeconds;
const windowCount = Math.ceil(totalSeconds / 60) + 1;

const requestErrors = new Rate('weglue_request_errors');
const timeouts = new Rate('weglue_timeouts');
const journeyDuration = new Trend('weglue_journey_duration', true);
const interactiveDuration = new Trend('weglue_interactive_duration', true);
const launchDuration = new Trend('weglue_launch_duration', true);
const journeyFailures = new Counter('weglue_journey_failures');
const writes = new Counter('weglue_synthetic_writes');
const statusCodes = new Counter('weglue_status');

// Sub-metrics only appear in the end-of-test summary when a threshold names
// them, so every window/journey sub-metric carries an always-true threshold.
const reporting = {};
for (let window = 0; window < windowCount; window += 1) {
  reporting[`weglue_interactive_duration{window:${window}}`] = ['p(95)>=0'];
  reporting[`weglue_request_errors{window:${window}}`] = ['rate>=0'];
  reporting[`weglue_timeouts{window:${window}}`] = ['rate>=0'];
}
for (const journey of JOURNEY_NAMES) {
  reporting[`weglue_journey_duration{journey:${journey}}`] = ['p(95)>=0'];
  reporting[`weglue_request_errors{journey:${journey}}`] = ['rate>=0'];
}
for (const code of ['0', '401', '403', '404', '409', '429', '500', '502', '503', '504']) reporting[`weglue_status{status:${code}}`] = ['count>=0'];

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
  scenarios: {
    plateau: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: `${rampSeconds}s`, target: plateauUsers },
        { duration: `${holdSeconds}s`, target: plateauUsers },
        { duration: `${rampDownSeconds}s`, target: 0 },
      ],
      gracefulRampDown: '20s',
      gracefulStop: '20s',
    },
  },
  thresholds: {
    ...reporting,
    // Approved hard stops. k6 thresholds are cumulative over the plateau run.
    weglue_request_errors: [{ threshold: 'rate<=0.05', abortOnFail: true, delayAbortEval: '60s' }],
    weglue_timeouts: [{ threshold: 'rate<=0.01', abortOnFail: true, delayAbortEval: '60s' }],
    weglue_interactive_duration: [{ threshold: 'p(95)<=5000', abortOnFail: true, delayAbortEval: '120s' }],
    weglue_launch_duration: [{ threshold: 'p(95)<=15000', abortOnFail: true, delayAbortEval: '60s' }],
  },
};

function currentWindow() {
  return String(Math.floor((Date.now() - exec.scenario.startTime) / 60_000));
}

function headers(session, extra) {
  return { apikey: anonKey, Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json', ...(extra || {}) };
}

function runStage(session, journey, stage) {
  const window = currentWindow();
  const responses = http.batch(stage.map((call) => ({
    method: call.method,
    url: `${baseUrl}${call.path}`,
    body: call.body === undefined ? null : JSON.stringify(call.body),
    params: {
      headers: headers(session, call.headers),
      timeout: '20s',
      tags: { journey, endpoint: `${call.method} ${call.path.split('?')[0]}`, state, window, plateau: String(plateauIndex) },
    },
  })));
  let allOk = true;
  responses.forEach((response, index) => {
    const ok = response.status >= 200 && response.status < 300;
    const timedOut = response.status === 0 || response.error_code === 1050;
    requestErrors.add(!ok, { journey, window });
    timeouts.add(timedOut, { journey, window });
    statusCodes.add(1, { status: String(response.status) });
    if (stage[index].write) writes.add(1, { journey });
    check(response, { [`${journey}: 2xx`]: () => ok });
    if (!ok) allOk = false;
  });
  return allOk;
}

export default function () {
  const userIndex = (exec.vu.idInTest - 1) % plateauUsers;
  const session = sessionBundle.sessions[userIndex];
  if (!session || session.userIndex !== userIndex) fail(`Missing deterministic session for user ${userIndex}`);
  const actions = userActions[userIndex];
  const iteration = exec.vu.iterationInScenario;
  const action = actions[iteration % actions.length];
  if (!action) fail(`Missing trace action for user ${userIndex}`);
  const cycle = Math.floor(iteration / actions.length);
  const stages = buildJourney(action.journey, {
    session,
    manifest,
    action,
    namespace,
    cycle,
    nowIso: new Date().toISOString(),
    sentAt: Date.now(),
    clientTag: action.journey === 'message-send'
      ? actionClientTag((input) => crypto.sha256(input, 'hex'), uuidFromSha256Hex, namespace, action, `${plateauIndex}:${cycle}`)
      : undefined,
  });
  assertAllowedStages(action.journey, stages);

  const started = Date.now();
  let ok = true;
  for (const stage of stages) ok = runStage(session, action.journey, stage) && ok;
  const elapsed = Date.now() - started;
  const window = currentWindow();
  journeyDuration.add(elapsed, { journey: action.journey, window });
  if (action.journey === 'launch') launchDuration.add(elapsed, { window });
  else interactiveDuration.add(elapsed, { journey: action.journey, window });
  if (!ok) journeyFailures.add(1, { journey: action.journey });
  sleep(action.thinkTimeMs / 1000);
}

export function handleSummary(data) {
  return {
    [__ENV.LOADTEST_SUMMARY_FILE]: JSON.stringify({
      schemaVersion: 2,
      state,
      namespace,
      plateau: { index: plateauIndex, users: plateauUsers, rampSeconds, holdSeconds, rampDownSeconds },
      seed: traceHeader.seed,
      traceSha256: traceHeader.sha256,
      applicationContract: traceHeader.applicationContract,
      metrics: data.metrics,
    }, null, 2),
  };
}
