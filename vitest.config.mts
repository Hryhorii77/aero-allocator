import { defineConfig } from "vitest/config";

// web/ has its own vitest.config.mts (jsdom, React plugin, its own test
// script) — without this, the default `**/*.test.ts` glob also picks up
// web/'s test files here, running them without the jsdom environment or
// path aliasing they need.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
