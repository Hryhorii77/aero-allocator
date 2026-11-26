import { SITE_URL } from "@/lib/site";
import { agentDocHeaders } from "@/lib/agents-md";
import { llmsTxt } from "@/lib/llms-txt";

/** A plain-text description of the site for agents and the tools that fetch /llms.txt. Any origin may fetch it, like /AGENTS.md. */
export function GET() {
  return new Response(llmsTxt(SITE_URL), { headers: agentDocHeaders("text/plain; charset=utf-8") });
}
