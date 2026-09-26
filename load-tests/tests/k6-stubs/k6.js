export const sleeps = [];
export function check() { return true; }
export function fail(message) { throw new Error(message); }
export function sleep(seconds) { sleeps.push(seconds); }
