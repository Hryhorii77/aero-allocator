import { NextResponse } from "next/server";
import { PROTOCOL } from "./protocol";

/**
 * Wraps a route handler so an unexpected throw (RPC down even after
 * fallback, DefiLlama down, etc.) becomes a structured JSON log line —
 * searchable/alertable in Vercel's Logs tab — instead of an unhandled
 * exception. Also returns a JSON 500 instead of Next's default HTML error
 * page, which would otherwise break every client-side `res.json()` call in
 * page.tsx (e.g. recomputeVoter has no res.ok check before parsing). The client only gets a generic message: viem errors can
 * carry the RPC URL, which may hold a provider key; the detail stays in the log.
 */
export function withApiErrorHandling<Req extends Request>(route: string, handler: (req: Req) => Promise<NextResponse>) {
  return async (req: Req): Promise<NextResponse> => {
    const startedAt = Date.now();
    try {
      return await handler(req);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      console.error(
        JSON.stringify({
          level: "error",
          route,
          protocol: PROTOCOL,
          message: error.message,
          stack: error.stack,
          durationMs: Date.now() - startedAt,
          url: req.url,
        }),
      );
      return NextResponse.json({ error: "internal error" }, { status: 500 });
    }
  };
}
