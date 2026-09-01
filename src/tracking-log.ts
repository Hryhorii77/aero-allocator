import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { LoggedRecommendation } from "./tracking.js";

// Resolved relative to this module's own location (not process.cwd()) so it
// works the same whether run via `npm run` (cwd = repo root) or as an MCP
// server launched by an external client with an arbitrary cwd. src/ and
// dist/ sit at the same depth from the repo root, so this holds for both
// the tsx-run source and the compiled build.
const DEFAULT_LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "voter-roi-log.jsonl");

export { DEFAULT_LOG_PATH };

/** One JSON object per line; malformed lines are skipped rather than failing the whole read. */
export function readRecommendationLog(path: string = DEFAULT_LOG_PATH): LoggedRecommendation[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const entries: LoggedRecommendation[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed line
    }
  }
  return entries;
}

/**
 * Inserts or replaces the log entry for (epochStart, protocol) — idempotent
 * across the multiple scheduled epoch-reminder runs per epoch, so the log
 * ends up with exactly one entry per epoch, reflecting whichever run was
 * closest to lock (the most accurate, since it's closest to when a real
 * voter would actually cast this).
 */
export function upsertRecommendationLog(entry: LoggedRecommendation, path: string = DEFAULT_LOG_PATH): void {
  const existing = readRecommendationLog(path);
  const filtered = existing.filter(
    (e) => !(e.epochStart === entry.epochStart && e.protocol === entry.protocol),
  );
  filtered.push(entry);
  filtered.sort((a, b) => a.epochStart - b.epochStart);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, filtered.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}
