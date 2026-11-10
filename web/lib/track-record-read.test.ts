// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ loadTrackLog: vi.fn(), loadTrackLogForUpdate: vi.fn(), saveTrackLog: vi.fn() }));
const gauges = vi.hoisted(() => ({ getGauges: vi.fn() }));
vi.mock("./track-record-store", () => store);
vi.mock("./gauges", async (orig) => ({ ...(await orig<typeof import("./gauges")>()), ...gauges }));
const fees = vi.hoisted(() => ({ getGaugeFees: vi.fn() }));
const autopilot = vi.hoisted(() => ({ readAutopilotSnap: vi.fn() }));
vi.mock("./gauge-fees-read", () => fees);
vi.mock("./daily-history-store", () => ({ loadDailyHistory: vi.fn() }));
vi.mock("./autopilot-read", () => autopilot);

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

  describe("logging the day", () => {
    const G = "0x00000000000000000000000000000000000000a1";
    const ready = () => {
      store.loadTrackLogForUpdate.mockResolvedValue({ state: "missing" });
      store.saveTrackLog.mockResolvedValue("saved");
      gauges.getGauges.mockResolvedValue({ gauges: [{ gauge: G, pool: "0x1", symbol: "A", weight: 200_000, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 }], cooldownSec: 169_200 });
      fees.getGaugeFees.mockResolvedValue({ chainId: 8453, generatedAt: 0, windowHours: 40, fees: [{ gauge: G, feesUsdPerDay: 1000, windowHours: 40 }] });
    };
    it("writes down where Autopilot's pools sit next to the split", async () => {
      ready();
      const snap = [{ id: 20366, power: 1_000_000, parts: [{ c: 10, g: "0xb3", a: 400_000 }] }];
      autopilot.readAutopilotSnap.mockResolvedValue(snap);
      expect(await recordTrackEntry(inWindow)).toBe("logged");
      const saved = store.saveTrackLog.mock.calls[0][0];
      expect(saved.entries[0].ap).toEqual(snap);
      expect(saved.entries[0].parts[0].g).toBe(G);
    });
    it("still logs the split when Autopilot can't be read, without the field", async () => {
      ready();
      autopilot.readAutopilotSnap.mockRejectedValue(new Error("node down"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await recordTrackEntry(inWindow)).toBe("logged");
      expect(store.saveTrackLog.mock.calls[0][0].entries[0]).not.toHaveProperty("ap");
      expect(err).toHaveBeenCalledWith(expect.stringContaining("autopilot-read-failed"));
      err.mockRestore();
    });
  });

  it("does not even read outside the first hours of the UTC day", async () => {
    expect(await recordTrackEntry(DAY * 86_400 + 5 * 3600)).toBe("outside-window");
    expect(store.loadTrackLogForUpdate).not.toHaveBeenCalled();
  });
});
