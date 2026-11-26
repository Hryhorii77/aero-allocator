import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return SITE_URL
    ? [
        { url: SITE_URL, changeFrequency: "hourly", priority: 1 },
        { url: `${SITE_URL}/track-record`, changeFrequency: "daily", priority: 0.5 },
        // The two documents for AI agents (lib/agents-md.ts, lib/llms-txt.ts).
        { url: `${SITE_URL}/AGENTS.md`, changeFrequency: "weekly", priority: 0.3 },
        { url: `${SITE_URL}/llms.txt`, changeFrequency: "weekly", priority: 0.3 },
      ]
    : [];
}
