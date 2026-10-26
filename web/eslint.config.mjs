import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Next 16 removed `next lint`; this is the flat config its docs describe (Next, React and React Hooks rules plus typescript-eslint),
// run with `npm run lint` (CI runs it; errors fail the job, warnings do not).
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The page sets "mounted" and "loading" state inside effects on purpose: it keeps server and client HTML identical and resets a
      // panel when its inputs change. Those uses are tested, so the rule is a nudge for new code, not a failure.
      "react-hooks/set-state-in-effect": "warn",
      // A leading underscore marks a parameter that is deliberately unused (a mock's signature, for example).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/**", "node_modules/**"]),
]);
