import { describe, expect, it } from "vitest";
import { LiveAdapter, NotYetLiveAdapter, loadLiveConfig } from "./predictive-allocation.js";

describe("NotYetLiveAdapter", () => {
  it("reports not live and throws a helpful error on submission", async () => {
    const adapter = new NotYetLiveAdapter();
    expect(adapter.isLive()).toBe(false);
    await expect(adapter.prepareSubmission({ allocations: [{ pool: "0x" + "1".repeat(40), weightPct: 100 }] })).rejects.toThrow(
      /not published yet/,
    );
  });
});

describe("loadLiveConfig", () => {
  it("returns null when env vars are unset", () => {
    expect(loadLiveConfig()).toBeNull();
  });
});

describe("LiveAdapter", () => {
  const pool = ("0x" + "ab".repeat(20)) as `0x${string}`;
  const address = ("0x" + "cd".repeat(20)) as `0x${string}`;

  it("encodes calldata for a veNftId + pools + weightsBps signature", async () => {
    const adapter = new LiveAdapter({
      address,
      abi: ["function submitAllocation(uint256 tokenId, address[] pools, uint256[] weights)"],
      functionName: "submitAllocation",
      args: ["veNftId", "pools", "weightsBps"],
    });
    expect(adapter.isLive()).toBe(true);

    const calls = await adapter.prepareSubmission({
      veNftId: 42,
      allocations: [{ pool, weightPct: 60 }, { pool, weightPct: 40 }],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe(address);
    expect(calls[0].value).toBe("0");
    expect(calls[0].data.startsWith("0x")).toBe(true);
  });

  it("throws when veNftId is required but missing", async () => {
    const adapter = new LiveAdapter({
      address,
      abi: ["function submitAllocation(uint256 tokenId, address[] pools, uint256[] weights)"],
      functionName: "submitAllocation",
      args: ["veNftId", "pools", "weightsBps"],
    });
    await expect(
      adapter.prepareSubmission({ allocations: [{ pool, weightPct: 100 }] }),
    ).rejects.toThrow(/requires veNftId/);
  });

  it("supports a wad-scaled weight convention", async () => {
    const adapter = new LiveAdapter({
      address,
      abi: ["function submitAllocation(address[] pools, uint256[] weights)"],
      functionName: "submitAllocation",
      args: ["pools", "weightsWad"],
    });
    const calls = await adapter.prepareSubmission({ allocations: [{ pool, weightPct: 100 }] });
    expect(calls[0].data.startsWith("0x")).toBe(true);
  });
});
