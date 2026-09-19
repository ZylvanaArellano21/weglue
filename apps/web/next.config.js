const { withSentryConfig } = require("@sentry/nextjs/config");

/** @type {import('next').NextConfig} */
// Permanent public URL for the We Glue classroom presentation.
// weglue.app/slides -> the current Canva deck. Change only this constant to
// point the public URL at a new deck later; the URL itself never changes.
const SLIDES_DESTINATION = "https://canva.link/42csy3ldcy0ezm0";

const nextConfig = {
  transpilePackages: ["@weglue/shared"],
  // Required for instrumentation.ts (Sentry's server/edge init) to be picked
  // up at all on Next.js < 15 — this repo is on 14.2.35. Next 15+ ignores
  // this flag entirely (and warns if set), but it's a no-op there, not a
  // conflict, so no version-gating needed if this app ever upgrades.
  experimental: { instrumentationHook: true },
  async redirects() {
    return [
      {
        // Evaluated at the routing layer before middleware runs, so this is a
        // plain HTTP 307 with no auth check, no marketing page, and no
        // "Open We Glue" app prompt. `permanent: false` keeps it a 307 that
        // browsers do not cache long-term, so the destination stays editable.
        source: "/slides",
        destination: SLIDES_DESTINATION,
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/.well-known/:path*",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ];
  },
};

// No org/project/authToken here: source-map upload needs a separate Sentry
// auth token this task doesn't have yet, so the build stays a no-op upload
// (silent skip, not a failure). Runtime error/performance capture works
// fully off the DSN alone — this only affects stack-trace readability in the
// Sentry dashboard. Add authToken + org + project later if that's wanted.
module.exports = withSentryConfig(nextConfig, {
  silent: !process.env.CI,
});
