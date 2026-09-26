import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { APPLICATION_CONTRACT_COMMIT, ARCHETYPE_MIX, THINK_TIME_MAX_MS, THINK_TIME_MIN_MS } from './constants.js';
import type { ActionTrace, Archetype, JourneyName, TraceAction } from './types.js';

// Per-archetype journey weights (percent). Browsers read Home, events,
// discovery and clubs; social users add notifications and RSVP/save/like
// toggles; communicators work in the inbox and threads and send messages.
export const ARCHETYPE_JOURNEYS: Readonly<Record<Archetype, ReadonlyArray<{ name: JourneyName; weight: number }>>> = Object.freeze({
  browser: [
    { name: 'home', weight: 35 },
    { name: 'events', weight: 25 },
    { name: 'discover', weight: 20 },
    { name: 'club', weight: 20 },
  ],
  social: [
    { name: 'home', weight: 20 },
    { name: 'events', weight: 15 },
    { name: 'club', weight: 10 },
    { name: 'notifications', weight: 25 },
    { name: 'social-write', weight: 30 },
  ],
  communicator: [
    { name: 'inbox', weight: 35 },
    { name: 'thread', weight: 35 },
    { name: 'message-send', weight: 20 },
    { name: 'notifications', weight: 10 },
  ],
});

// Longest plateau load phase is 120 s ramp + 900 s hold + 30 s ramp-down;
// at the 8 s minimum think time a user performs at most ~131 actions.
export const DEFAULT_ITERATIONS_PER_USER = 140;

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Sequential largest-deficit assignment: every prefix of users (and therefore
 * every plateau) stays as close as possible to the approved 60/25/15 mix.
 */
export function assignArchetypes(users: number): Archetype[] {
  const order: Archetype[] = ['browser', 'social', 'communicator'];
  const counts: Record<Archetype, number> = { browser: 0, social: 0, communicator: 0 };
  const result: Archetype[] = [];
  for (let index = 0; index < users; index += 1) {
    let best: Archetype = 'browser';
    let bestDeficit = -Infinity;
    for (const archetype of order) {
      const deficit = (index + 1) * ARCHETYPE_MIX[archetype] - counts[archetype];
      if (deficit > bestDeficit + 1e-9) {
        best = archetype;
        bestDeficit = deficit;
      }
    }
    counts[best] += 1;
    result.push(best);
  }
  return result;
}

function chooseJourney(archetype: Archetype, random: number): JourneyName {
  const journeys = ARCHETYPE_JOURNEYS[archetype];
  const total = journeys.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random * total;
  for (const item of journeys) {
    cursor -= item.weight;
    if (cursor < 0) return item.name;
  }
  return journeys[journeys.length - 1]!.name;
}

function traceHash(payload: Omit<ActionTrace, 'sha256'>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function generateTrace(namespace: string, seed: number, users: number, iterationsPerUser = DEFAULT_ITERATIONS_PER_USER): ActionTrace {
  const random = mulberry32(seed);
  const archetypes = assignArchetypes(users);
  const actions: TraceAction[] = [];
  let sequence = 0;
  for (let iteration = 0; iteration < iterationsPerUser; iteration += 1) {
    for (let userIndex = 0; userIndex < users; userIndex += 1) {
      // Draw the same number of values for every action so the stream stays
      // aligned regardless of which journey is chosen.
      const journeyDraw = random();
      const entityDraw = random();
      const thinkDraw = random();
      actions.push({
        sequence,
        userIndex,
        // Every user's first action of a plateau is a cold authenticated launch.
        journey: iteration === 0 ? 'launch' : chooseJourney(archetypes[userIndex]!, journeyDraw),
        entityIndex: Math.floor(entityDraw * Math.max(1, users)),
        thinkTimeMs: THINK_TIME_MIN_MS + Math.floor(thinkDraw * (THINK_TIME_MAX_MS - THINK_TIME_MIN_MS + 1)),
        clientTag: `${namespace}:${seed}:${sequence}`,
      });
      sequence += 1;
    }
  }
  const payload = {
    schemaVersion: 2 as const,
    applicationContract: APPLICATION_CONTRACT_COMMIT,
    namespace,
    seed,
    users,
    iterationsPerUser,
    archetypes,
    actions,
  };
  return { ...payload, sha256: traceHash(payload) };
}

export function verifyTrace(trace: ActionTrace): void {
  const { sha256, ...payload } = trace;
  if (payload.schemaVersion !== 2) throw new Error('Unsupported action trace schema');
  if (payload.applicationContract !== APPLICATION_CONTRACT_COMMIT) throw new Error('Action trace application contract mismatch');
  if (traceHash(payload) !== sha256) throw new Error('Action trace hash mismatch');
}

export function writeTrace(path: string, trace: ActionTrace): void {
  verifyTrace(trace);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(trace)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function readTrace(path: string): ActionTrace {
  const trace = JSON.parse(readFileSync(path, 'utf8')) as ActionTrace;
  verifyTrace(trace);
  return trace;
}
