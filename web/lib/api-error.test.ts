import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { withApiErrorHandling } from "./api-error";

describe("withApiErrorHandling", () => {
  it("passes through a successful handler's response unchanged", async () => {
    const handler = withApiErrorHandling("test", async () => NextResponse.json({ ok: true }));
    const res = await handler(new Request("http://localhost/api/test"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("catches a thrown error and returns a JSON 500 instead of propagating", async () => {
    const handler = withApiErrorHandling("test", async () => {
      throw new Error("boom");
    });
    const res = await handler(new Request("http://localhost/api/test"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });

  it("logs a structured JSON line with route context on error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withApiErrorHandling("my-route", async () => {
      throw new Error("boom");
    });
    await handler(new Request("http://localhost/api/test?foo=bar"));

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ level: "error", route: "my-route", message: "boom", url: "http://localhost/api/test?foo=bar" });
    expect(logged.stack).toContain("boom");
    spy.mockRestore();
  });

  it("stringifies a non-Error throw", async () => {
    const handler = withApiErrorHandling("test", async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "a plain string throw";
    });
    const res = await handler(new Request("http://localhost/api/test"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("a plain string throw");
  });
});
