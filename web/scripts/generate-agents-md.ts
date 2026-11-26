// Writes web/docs/agents/AGENTS.md and web/docs/agents/llms.txt from lib/agents-md.ts and lib/llms-txt.ts, the same text /AGENTS.md
// and /llms.txt serve, for the production address. Run from web/: npm run generate-agents-md. With --check it writes nothing and
// exits 1 when either file is out of date (CI runs that). Not public/: see lib/agents-md.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { buildAgentsMd } from "../lib/agents-md";
import { llmsTxt } from "../lib/llms-txt";

/** Always the production address, so a local NEXT_PUBLIC_SITE_URL can't change the committed copies. */
export const PRODUCTION_URL = "https://aeroallocator.app";

export const GENERATED_FILES: Array<[string, () => string]> = [
  ["docs/agents/AGENTS.md", () => buildAgentsMd(PRODUCTION_URL)],
  ["docs/agents/llms.txt", () => llmsTxt(PRODUCTION_URL)],
];

function main() {
  const check = process.argv.includes("--check");
  const root = new URL("../", import.meta.url);
  let stale = 0;
  for (const [path, build] of GENERATED_FILES) {
    const url = new URL(path, root);
    const text = build();
    let current: string | null = null;
    try {
      current = readFileSync(url, "utf8");
    } catch {}
    if (current === text) console.log(`${path}: up to date`);
    else if (check) {
      console.error(`${path}: out of date. Run npm run generate-agents-md in web/ and commit the result.`);
      stale++;
    } else {
      writeFileSync(url, text);
      console.log(`${path}: written`);
    }
  }
  process.exit(stale ? 1 : 0);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
