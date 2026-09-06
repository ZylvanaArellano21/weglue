/** @type {import('next').NextConfig} */
// Permanent public URL for the We Glue classroom presentation.
// weglue.app/slides -> the current Canva deck. Change only this constant to
// point the public URL at a new deck later; the URL itself never changes.
const SLIDES_DESTINATION = "https://canva.link/42csy3ldcy0ezm0";

const nextConfig = {
  transpilePackages: ["@weglue/shared"],
  experimental: {},
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

module.exports = nextConfig;
