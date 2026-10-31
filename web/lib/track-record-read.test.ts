// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ loadTrackLog: vi.fn(), loadTrackLogForUpdate: vi.fn(), saveTrackLog: vi.fn() }));
const gauges = vi.hoisted(() => ({ getGauges: vi.fn() }));
vi.mock("./track-record-store", () => store);
vi.mock("./gauges", () => gauges);
vi.mock("./gauge-fees-read", () => ({ getGaugeFees: vi.fn() }));
vi.mock("./daily-history-store", () => ({ loadDailyHistory: vi.fn() }));

import { recordTrackEntry } from "./track-record-read";

const DAY = 20_758;
const inWindow = DAY * 86_400 + 600;

beforeEach(() => vi.clearAllMocks());

describe("recordTrackEntry", () => {
  it("writes nothing after a failed read, so a blip can't replace the record with a one-day log", async () => {
    store.loadTrackLogForUpdate.mockResolvedValue({ state: "error" });
    expect(await recordTrackEntry(inWindow)).toBe("load-failed");
    expect(store.saveTrackLog).not.toHaveBeenCalled();
    expect(gauges.getGauges).not.toHaveBeenCalled();
  });

  it("stops before any read once today is logged", async () => {
    store.loadTrackLogForUpdate.mockResolvedValue({ state: "ok", etag: '"e"', value: { version: 1, chainId: 8453, entries: [{ day: DAY }] } });
    expect(await recordTrackEntry(inWindow)).toBe("already");
    expect(gauges.getGauges).not.toHaveBeenCalled();
  });

  it("does not even read outside the first hours of the UTC day", async () => {
    expect(await recordTrackEntry(DAY * 86_400 + 5 * 3600)).toBe("outside-window");
    expect(store.loadTrackLogForUpdate).not.toHaveBeenCalled();
  });
});
