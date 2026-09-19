import * as Sentry from "@sentry/nextjs";

// P0 perf task 10: this is what's actually watching for slow requests and
// regressions server-side. Missing DSN (e.g. a fork without the env var set)
// disables the SDK gracefully rather than throwing.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
});
