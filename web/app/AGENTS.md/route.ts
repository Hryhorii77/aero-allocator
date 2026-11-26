import { buildAgentsMd } from "@/lib/agents-md";
import { SITE_URL } from "@/lib/site";

/** The "read me first" document for AI agents (lib/agents-md.ts). Any origin may fetch it, like /llms.txt. */
export function GET() {
  return new Response(buildAgentsMd(SITE_URL), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400", "Access-Control-Allow-Origin": "*" },
  });
}
