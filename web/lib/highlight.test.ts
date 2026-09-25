import { describe, expect, it } from "vitest";
import { highlightForPool, HIGHLIGHTED_TOKENS } from "./highlight";

const BNKR = "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b";

describe("highlightForPool", () => {
  it("recognises a pool by either of its token addresses, whatever the casing", () => {
    expect(highlightForPool({ token0: BNKR, token1: "0xaaa" })?.label).toBe("BNKR");
    expect(highlightForPool({ token0: "0xaaa", token1: BNKR.toUpperCase().replace("0X", "0x") })?.label).toBe("BNKR");
  });

  it("doesn't match on anything but the address — a look-alike token isn't highlighted", () => {
    // The pool's SYMBOL isn't even an input; a different address is a different token.
    expect(highlightForPool({ token0: "0x1111111111111111111111111111111111111111", token1: "0xaaa" })).toBeNull();
  });

  it("copes with pools from a cache written before token addresses were served", () => {
    expect(highlightForPool({})).toBeNull();
    expect(highlightForPool({ token0: undefined, token1: undefined })).toBeNull();
  });

  it("is a list of addresses, lower-cased, so lookups can't miss on casing", () => {
    for (const addr of Object.keys(HIGHLIGHTED_TOKENS)) expect(addr).toBe(addr.toLowerCase());
  });
});
