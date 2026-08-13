// Bounds a promise that might otherwise hang forever — a stalled cold-start
// radio/DNS/TLS handshake neither resolves nor rejects, so a bare `await`
// (even inside try/catch) can block startup indefinitely. Race it against a
// timer instead: on timeout the caller's catch runs exactly as it would for
// a real network error.
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
