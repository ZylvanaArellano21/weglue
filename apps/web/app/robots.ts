import type { MetadataRoute } from "next";

/**
 * Site robots policy.
 *
 * NOTE ON THE REMOVED `/admin` DISALLOW — deliberate; do not re-add it.
 * A `Disallow: /admin` line is public, world-readable disclosure that an
 * administration area exists, which directly defeats the entry gateway's
 * concealment: every /admin path now returns an ordinary 404 to anyone without a
 * valid entry ticket, so there is nothing left for a crawler to reach and nothing
 * that needs excluding. Naming it here would only hand an attacker the target.
 *
 * Admin responses are still kept out of indexes by the layers that apply AFTER
 * the gateway is passed:
 *   • `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` on every /admin
 *     response (middleware)
 *   • `robots: { index: false, follow: false }` page metadata (/admin layout)
 *   • `Cache-Control: no-store` on every /admin response
 *
 * The private entry path itself is configured only through ADMIN_ENTRY_PATH and
 * must never appear here, in a sitemap, in navigation, or in any client bundle.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
  };
}
