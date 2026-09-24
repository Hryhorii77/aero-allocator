import { describe, expect, it, vi } from "vitest";
import { logX402Usage } from "./x402-usage";

describe("logX402Usage", () => {
  it("logs a structured JSON line with the route, its price, and request params", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logX402Usage({ route: "v1/forecast", priceUsd: 0.05, refresh: true, votingPower: 25000 });

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      level: "info",
      event: "x402_request_served",
      route: "v1/forecast",
      priceUsd: 0.05,
      refresh: true,
      votingPower: 25000,
    });
    spy.mockRestore();
  });

  it("attributes each paid route to its own price, rather than a shared constant", () => {
    // The price used to be hardcoded here, which was fine with one paid
    // endpoint and silently wrong the moment a second one priced differently
    // — the revenue log would have credited every call at the first route's
    // rate.
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logX402Usage({ route: "v1/position", priceUsd: 0.25, refresh: false, votingPower: 1_000_000 });

    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ route: "v1/position", priceUsd: 0.25 });
    spy.mockRestore();
  });
});
