// k6 ramping-vus stages that follow src/ramp.ts targetUsersAt exactly, so the
// HTTP generator and the Realtime worker have the same users active at every
// moment. Every stage is either an instant step (duration 0) or a flat hold.
// Shared with the tests; keep it free of k6 imports.

export function plateauStages(users, rampSeconds, holdSeconds, rampDownSeconds) {
  const rampMs = rampSeconds * 1000;
  const downStart = rampMs + holdSeconds * 1000;
  const endMs = downStart + rampDownSeconds * 1000;
  // Absolute step times. Ramp: ceil(users * t / ramp), one user from t = 0.
  // Ramp-down: round(users * (1 - i / rampDown)), stepping to k at
  // i = rampDown * (1 - (k + 0.5) / users).
  const steps = [];
  for (let k = 1; k <= users; k += 1) steps.push({ at: ((k - 1) * rampMs) / users, target: k });
  for (let k = users - 1; k >= 0; k -= 1) steps.push({ at: downStart + rampDownSeconds * 1000 * (1 - (k + 0.5) / users), target: k });
  const stages = [];
  let clock = 0;
  let current = 0;
  for (const step of steps) {
    const at = Math.round(step.at);
    if (at > clock) stages.push({ duration: `${at - clock}ms`, target: current });
    stages.push({ duration: '0s', target: step.target });
    clock = Math.max(clock, at);
    current = step.target;
  }
  if (endMs > clock) stages.push({ duration: `${Math.round(endMs) - clock}ms`, target: current });
  return stages;
}

/** VUs a ramping-vus executor runs `ms` into these flat/step stages. */
export function stageTargetAt(stages, ms) {
  let clock = 0;
  let target = 0;
  for (const stage of stages) {
    const duration = Number(stage.duration.replace(/ms$/, '').replace(/s$/, '')) * (stage.duration.endsWith('ms') ? 1 : 1000);
    if (duration === 0) {
      if (clock <= ms) target = stage.target;
      continue;
    }
    if (ms < clock + duration) return target;
    clock += duration;
    target = stage.target;
  }
  return target;
}
