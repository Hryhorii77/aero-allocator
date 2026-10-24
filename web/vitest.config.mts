import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(dirname, ".") },
      // @x402/next imports "next/server" without the extension, which Node's ESM resolver can't follow; once it is inlined below,
      // this lets Vite resolve it, so tests can run the real payment flow.
      { find: /^next\/server$/, replacement: "next/server.js" },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    server: { deps: { inline: ["@x402/next"] } },
  },
});
