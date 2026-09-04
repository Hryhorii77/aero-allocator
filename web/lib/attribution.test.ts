import { describe, expect, it } from "vitest";
import { Attribution } from "ox/erc8021";
import { BUILDER_CODE, DATA_SUFFIX } from "./attribution";

describe("attribution", () => {
  it("ends with the fixed 16-byte ERC-8021 marker (0x8021 repeating)", () => {
    // Per ox/erc8021's own spec: the last 34 hex chars (16 bytes, plus the
    // "0x") are this constant, regardless of which codes are embedded.
    expect(DATA_SUFFIX.endsWith("80218021802180218021802180218021")).toBe(true);
  });

  it("embeds the registered builder code as a readable ASCII segment", () => {
    // Schema 0 (canonical registry, the default toDataSuffix({ codes }) uses)
    // encodes codes as comma-joined ASCII before the length/schema/marker
    // tail — so the code should appear as literal hex-encoded ASCII bytes.
    const codeAsHex = Buffer.from(BUILDER_CODE, "ascii").toString("hex");
    expect(DATA_SUFFIX.toLowerCase()).toContain(codeAsHex);
  });

  it("is a pure function of the builder code — same input always produces the same suffix", () => {
    // Guards against something accidentally non-deterministic (a
    // timestamp, a random ID) getting mixed into the suffix, which would
    // make Base unable to consistently attribute transactions.
    expect(Attribution.toDataSuffix({ codes: [BUILDER_CODE] })).toBe(DATA_SUFFIX);
  });
});
