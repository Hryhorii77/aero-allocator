import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return SITE_URL
    ? [
        { url: SITE_URL, changeFrequency: "hourly", priority: 1 },
        { url: `${SITE_URL}/track-record`, changeFrequency: "daily", priority: 0.5 },
      ]
    : [];
}
