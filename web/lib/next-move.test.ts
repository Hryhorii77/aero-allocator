import { describe, expect, it } from "vitest";
import { AERO_FINAL_VOTE_CLOSE_MS, nextBestMove } from "./next-move";

const LAUNCH = Date.UTC(2026, 9, 22);
const H = 3_600_000;

describe("nextBestMove", () => {
  it("warns inside the last 48h before the final vote and points at the split", () => {
    const m = nextBestMove({ nowMs: AERO_FINAL_VOTE_CLOSE_MS - 10 * H, launchAtMs: LAUNCH, hasVotedThisEpoch: true });
    expect(m.tone).toBe("warn");
    expect(m.go).toBe("vote");
    expect(m.body).toMatch(/claim rewards and rebases/i);
  });

  it("after the final close, only the claim-and-reset warning remains", () => {
    const m = nextBestMove({ nowMs: AERO_FINAL_VOTE_CLOSE_MS + H, launchAtMs: LAUNCH, hasVotedThisEpoch: false });
    expect(m.title).toMatch(/closed/i);
    expect(m.go).toBeNull();
  });

  it("says weekly voting has ended once Aero has launched", () => {
    const m = nextBestMove({ nowMs: LAUNCH + H, launchAtMs: LAUNCH, hasVotedThisEpoch: null });
    expect(m.title).toMatch(/ended/i);
    expect(m.cta).toBeNull();
  });

  it("nudges a wallet that has not voted this epoch", () => {
    const m = nextBestMove({ nowMs: AERO_FINAL_VOTE_CLOSE_MS - 100 * H, launchAtMs: LAUNCH, hasVotedThisEpoch: false });
    expect(m.title).toMatch(/haven't voted/i);
    expect(m.tone).toBe("info");
  });

  it("has no launch deadlines on a protocol without a cut-over", () => {
    const m = nextBestMove({ nowMs: LAUNCH + H, launchAtMs: null, hasVotedThisEpoch: null });
    expect(m.tone).toBe("info");
    expect(m.go).toBe("vote");
  });
});
