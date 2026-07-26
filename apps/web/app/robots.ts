import type { MetadataRoute } from "next";

/**
 * Site robots policy. The admin portal is explicitly disallowed from all
 * crawlers and excluded from any sitemap — admin URLs must never be indexed.
 * (Per-response `X-Robots-Tag: noindex` is also set in middleware, and the
 * /admin pages carry `robots: { index:false }` metadata, as defense in depth.)
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: ["/admin", "/admin/"],
      },
    ],
  };
}
