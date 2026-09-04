import { describe, expect, it } from "vitest";
import { wagmiConfig } from "./wagmi";
import { DATA_SUFFIX } from "./attribution";

describe("wagmiConfig", () => {
  it("carries the ERC-8021 attribution suffix at the client-config level", () => {
    // Client-level (not per-call) so every wagmi-sent transaction —
    // castVote today, anything added later — is attributed automatically
    // without each call site needing to remember to pass it. The
    // no-wallet calldata-copy path (lib/voter.ts's buildVoteCalldata)
    // never goes through this client, so it appends the suffix itself.
    const client = wagmiConfig.getClient();
    expect(client.dataSuffix).toBe(DATA_SUFFIX);
  });
});
