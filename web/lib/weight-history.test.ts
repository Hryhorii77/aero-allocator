import { describe, expect, it } from "vitest";
import { computeFlows, formatFlow, MIN_SNAPSHOT_GAP_SEC, RETAIN_SEC, recordSnapshot, topMovers, type Flow } from "./weight-history";

const A = "0xAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xCcccccccccccccccccccccccccccccccccccccc";
const H = 3600;

describe("recordSnapshot", () => {
  it("starts a record with lowercase addresses and whole-token weights", () => {
    const h = recordSnapshot(null, 8453, [{ gauge: A, weight: 1000.6 }, { gauge: B, weight: 5 }], 1000);
    expect(h.gauges).toEqual([A.toLowerCase(), B.toLowerCase()]);
    expect(h.points).toEqual([{ t: 1000, w: [1001, 5] }]);
  });
  it("skips a snapshot that is too soon after the last one", () => {
    const h = recordSnapshot(null, 8453, [{ gauge: A, weight: 1 }], 1000);
    expect(recordSnapshot(h, 8453, [{ gauge: A, weight: 2 }], 1000 + MIN_SNAPSHOT_GAP_SEC - 1)).toBe(h);
  });
  it("appends new gauges at the end, so earlier snapshots stay aligned, and a vanished gauge reads 0", () => {
    let h = recordSnapshot(null, 8453, [{ gauge: A, weight: 10 }, { gauge: B, weight: 20 }], 0);
    h = recordSnapshot(h, 8453, [{ gauge: B, weight: 25 }, { gauge: C, weight: 7 }], H);
    expect(h.gauges).toEqual([A, B, C].map((x) => x.toLowerCase()));
    expect(h.points[0].w).toEqual([10, 20]);
    expect(h.points[1].w).toEqual([0, 25, 7]);
  });
  it("drops snapshots past retention and starts over for another chain's record", () => {
    let h = recordSnapshot(null, 8453, [{ gauge: A, weight: 1 }], 0);
    h = recordSnapshot(h, 8453, [{ gauge: A, weight: 1 }], RETAIN_SEC + 10);
    expect(h.points.map((p) => p.t)).toEqual([RETAIN_SEC + 10]);
    expect(recordSnapshot(h, 10, [{ gauge: B, weight: 1 }], RETAIN_SEC + 20 * H).gauges).toEqual([B.toLowerCase()]);
  });
});

describe("computeFlows", () => {
  const history = (then: number[], now: number[], hours: number) => {
    let h = recordSnapshot(null, 8453, then.map((weight, i) => ({ gauge: [A, B, C][i], weight })), 0);
    h = recordSnapshot(h, 8453, now.map((weight, i) => ({ gauge: [A, B, C][i], weight })), hours * H);
    return h;
  };
  it("compares shares, so a decay that lowers every gauge equally shows no flow", () => {
    const f = computeFlows(history([1_000_000, 3_000_000], [900_000, 2_700_000], 10), 10 * H);
    expect(f.spanHours).toBe(10);
    for (const x of f.flows) expect(Math.abs(x.sharePctChange)).toBeLessThan(0.01);
  });
  it("shows power moving from one gauge to another", () => {
    const f = computeFlows(history([1_000_000, 1_000_000], [1_500_000, 500_000], 6), 6 * H);
    const byGauge = Object.fromEntries(f.flows.map((x) => [x.gauge, x]));
    expect(byGauge[A.toLowerCase()].sharePctChange).toBeCloseTo(50);
    expect(byGauge[B.toLowerCase()].sharePctChange).toBeCloseTo(-50);
    expect(byGauge[A.toLowerCase()].powerChange).toBe(500_000);
  });
  it("shows nothing with under two hours of history, no record, or one snapshot", () => {
    expect(computeFlows(history([1e6, 1e6], [2e6, 1e6], 1), H).flows).toEqual([]);
    expect(computeFlows(null, 0).spanHours).toBe(0);
    expect(computeFlows(recordSnapshot(null, 8453, [{ gauge: A, weight: 1e6 }], 0), 0).flows).toEqual([]);
  });
  it("leaves out a gauge that did not exist, or was too thin, at the start", () => {
    const f = computeFlows(history([1_000_000, 100], [1_000_000, 900_000, 800_000], 5), 5 * H);
    expect(f.flows.map((x) => x.gauge)).toEqual([A.toLowerCase()]);
  });
  it("looks back only as far as the window", () => {
    let h = recordSnapshot(null, 8453, [{ gauge: A, weight: 1e6 }, { gauge: B, weight: 1e6 }], 0);
    h = recordSnapshot(h, 8453, [{ gauge: A, weight: 1e6 }, { gauge: B, weight: 1e6 }], 40 * H);
    h = recordSnapshot(h, 8453, [{ gauge: A, weight: 2e6 }, { gauge: B, weight: 1e6 }], 46 * H);
    expect(computeFlows(h, 46 * H, 24).spanHours).toBe(6);
  });
});

describe("topMovers and formatFlow", () => {
  const f = (gauge: string, pct: number, weight = 500_000): Flow => ({ gauge, sharePctChange: pct, powerChange: 0, weight });
  it("ranks the biggest risers and fallers among gauges with enough power", () => {
    const m = topMovers([f("a", 40), f("b", 10), f("c", -30), f("d", -5), f("tiny", 900, 10)], 1);
    expect(m.gaining.map((x) => x.gauge)).toEqual(["a"]);
    expect(m.losing.map((x) => x.gauge)).toEqual(["c"]);
  });
  it("formats with a sign and calls tiny moves flat", () => {
    expect(formatFlow(12.4)).toBe("+12%");
    expect(formatFlow(-3.26)).toBe("−3.3%");
    expect(formatFlow(0.2)).toBe("flat");
    expect(formatFlow(250)).toBe("+250%");
  });
});
