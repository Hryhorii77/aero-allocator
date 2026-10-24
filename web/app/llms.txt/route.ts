import { SITE_URL } from "@/lib/site";
import { llmsTxt } from "@/lib/llms-txt";

/** A plain-text description of the site for agents and the tools that fetch /llms.txt. */
export function GET() {
  return new Response(llmsTxt(SITE_URL), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
