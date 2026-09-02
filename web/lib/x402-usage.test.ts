import { describe, expect, it, vi } from "vitest";
import { logX402Usage } from "./x402-usage";

describe("logX402Usage", () => {
  it("logs a structured JSON line with the fixed price, route, and request params", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logX402Usage({ refresh: true, votingPower: 25000 });

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
});
