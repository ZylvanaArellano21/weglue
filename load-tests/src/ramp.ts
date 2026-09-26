import {
  CEILING_PLATEAU_HOLD_SECONDS,
  DEFAULT_RAMP,
  PLATEAU_COOLDOWN_SECONDS,
  PLATEAU_HOLD_SECONDS,
  PLATEAU_RAMP_DOWN_SECONDS,
  PLATEAU_RAMP_SECONDS,
} from './constants.js';
import type { Plateau, Scenario } from './types.js';

export function buildRampLevels(requestedUsers: number): number[] {
  const levels: number[] = DEFAULT_RAMP.filter((value) => value <= requestedUsers);
  if (levels[levels.length - 1] !== requestedUsers) levels.push(requestedUsers);
  return levels;
}

/**
 * The approved plateau schedule. Each plateau is an independent load run:
 * ramp to its user count, hold, ramp down, then idle for the cooldown so
 * recovery to idle health can be verified before the next plateau begins.
 * A cold-connect scenario replaces the two-minute ramp with the arrival rate.
 */
export function buildPlateaus(requestedUsers: number, scenario: Scenario = 'steady', coldConnectRate = 1): Plateau[] {
  return buildRampLevels(requestedUsers).map((users, index, levels) => ({
    index,
    users,
    rampSeconds: scenario === 'cold-connect' ? Math.max(1, Math.ceil(users / coldConnectRate)) : PLATEAU_RAMP_SECONDS,
    holdSeconds: PLATEAU_HOLD_SECONDS[users] ?? (index === levels.length - 1 ? CEILING_PLATEAU_HOLD_SECONDS : 600),
    rampDownSeconds: PLATEAU_RAMP_DOWN_SECONDS,
    cooldownSeconds: PLATEAU_COOLDOWN_SECONDS,
  }));
}

/** Seconds from plateau start until load stops (cooldown excluded). */
export function plateauLoadSeconds(plateau: Plateau): number {
  return plateau.rampSeconds + plateau.holdSeconds + plateau.rampDownSeconds;
}

/** Target concurrent users `elapsedSeconds` into a plateau's load phase. */
export function targetUsersAt(elapsedSeconds: number, plateau: Plateau): number {
  if (elapsedSeconds < 0) return 0;
  if (elapsedSeconds < plateau.rampSeconds) {
    return Math.min(plateau.users, Math.max(1, Math.ceil(plateau.users * (elapsedSeconds / plateau.rampSeconds))));
  }
  const afterRamp = elapsedSeconds - plateau.rampSeconds;
  if (afterRamp < plateau.holdSeconds) return plateau.users;
  const intoRampDown = afterRamp - plateau.holdSeconds;
  if (intoRampDown >= plateau.rampDownSeconds) return 0;
  return Math.max(0, Math.round(plateau.users * (1 - intoRampDown / plateau.rampDownSeconds)));
}

/** Total campaign wall-clock seconds, excluding the idle baseline. */
export function campaignSeconds(plateaus: Plateau[]): number {
  return plateaus.reduce((total, plateau) => total + plateauLoadSeconds(plateau) + plateau.cooldownSeconds, 0);
}
