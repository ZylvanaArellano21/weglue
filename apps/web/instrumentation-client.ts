import * as Sentry from "@sentry/nextjs";

// Browser-side error + performance capture. Deliberately NOT enabling
// Session Replay or the feedback widget here — those record user screens,
// which is a real privacy question for a campus social app and wasn't part
// of what this P0 task asked for (detecting slow requests/regressions).
// Revisit only with an explicit product decision.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
