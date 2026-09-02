"use client";

import { useEffect } from "react";

// Catches throws in the root layout itself (rare — layout.tsx has no data
// fetching — but a broken font/env read would otherwise render nothing at
// all with no log). Must render its own <html>/<body>: this replaces the
// root layout, which is what failed.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        source: "root-layout",
        message: error.message,
        digest: error.digest,
        stack: error.stack,
      }),
    );
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-200">
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
      </body>
    </html>
  );
}
