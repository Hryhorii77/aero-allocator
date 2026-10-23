import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // The share card (the link preview image) lives under /api, so it stays crawlable while the rest of the API does not.
    rules: { userAgent: "*", allow: ["/", "/api/share"], disallow: ["/api/"] },
    ...(SITE_URL && { sitemap: `${SITE_URL}/sitemap.xml` }),
  };
}
