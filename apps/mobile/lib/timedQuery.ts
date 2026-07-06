// Dev-only Supabase request timing. Wrap important query promises so slow
// backend calls show up in Metro logs as `[Supabase timing] label: 123ms`.

export async function timedQuery<T>(
  label: string,
  queryPromise: Promise<T>,
): Promise<T> {
  const start = Date.now();

  try {
    const result = await queryPromise;
    const duration = Date.now() - start;

    if (__DEV__) {
      console.log(`[Supabase timing] ${label}: ${duration}ms`);
    }

    return result;
  } catch (error) {
    const duration = Date.now() - start;

    if (__DEV__) {
      console.warn(`[Supabase timing] ${label} failed after ${duration}ms`, error);
    }

    throw error;
  }
}
