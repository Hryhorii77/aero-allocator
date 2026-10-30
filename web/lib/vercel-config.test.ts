import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(join(__dirname, "..", "vercel.json"), "utf8")) as { ignoreCommand?: string; crons?: unknown[] };

/** Vercel runs this before a build: exit 0 skips the build, any other exit builds. */
const exitFor = (env: Record<string, string | undefined>) => spawnSync("sh", ["-c", config.ignoreCommand ?? "exit 1"], { env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv }).status;

describe("vercel.json ignoreCommand", () => {
  it("skips preview builds, to save build minutes (CI already tests every pull request)", () => {
    expect(config.ignoreCommand).toBeTruthy();
    expect(exitFor({ VERCEL_ENV: "preview" })).toBe(0);
  });

  it("never skips a production build, and builds when it can't tell", () => {
    expect(exitFor({ VERCEL_ENV: "production" })).toBe(1);
    expect(exitFor({ VERCEL_ENV: "development" })).toBe(1);
    expect(exitFor({ VERCEL_ENV: "" })).toBe(1);
    expect(exitFor({})).toBe(1);
  });

  it("keeps the cron schedules", () => {
    expect(config.crons?.length).toBeGreaterThanOrEqual(7);
  });
});
