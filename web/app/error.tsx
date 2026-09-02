"use client";

import { useEffect } from "react";

// Next.js App Router error boundary: catches render/effect throws that
// bypass page.tsx's own try/catch (e.g. a bug in state derivation, not a
// failed fetch). Logs structured JSON so it's searchable in Vercel's Logs
// tab the same way withApiErrorHandling's API-route errors are, then offers
// a retry via Next's reset() instead of forcing a full page reload.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        source: "page",
        message: error.message,
        digest: error.digest,
        stack: error.stack,
      }),
    );
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="max-w-md rounded-xl border border-rose-900 bg-rose-950/40 px-6 py-8 text-center">
        <p className="mb-2 text-sm font-medium text-rose-300">Something went wrong.</p>
        <p className="mb-6 text-xs text-neutral-400">{error.message || "An unexpected error occurred."}</p>
        <button
          onClick={reset}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500 hover:text-white"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
