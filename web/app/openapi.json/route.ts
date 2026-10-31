import { openApiSpec } from "@/lib/openapi";
import { SITE_URL } from "@/lib/site";
import { x402Status } from "@/lib/x402";

/** The OpenAPI description of the free reads and the three paid x402 routes, for agents and marketplaces that read /openapi.json. */
export function GET() {
  const status = x402Status();
  return Response.json(openApiSpec(SITE_URL, status.configured ? status.payTo : undefined), {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
