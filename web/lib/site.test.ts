import { describe, expect, it, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  return (await import("./site")).siteMetadata();
}

describe("siteMetadata", () => {
  it("points the link preview at the share card, as a large summary card, on the hosted domain", async () => {
    const m = await load();
    expect(String(m.metadataBase)).toBe("https://aeroallocator.app/");
    expect(m.openGraph?.images).toEqual([expect.objectContaining({ url: "/api/share?v=4", width: 1200, height: 630 })]);
    expect(m.twitter).toMatchObject({ card: "summary_large_image", images: ["/api/share?v=4"] });
    expect(m.alternates?.canonical).toBe("/");
    expect(m.openGraph?.url).toBe("/");
  });

  it("describes sAERO allocation on the hosted Aerodrome site, not the retired weekly vote", async () => {
    const m = await load();
    expect(String(m.title)).toMatch(/sAERO/);
    expect(String(m.title)).not.toMatch(/hot pools/);
    expect(String(m.description)).not.toMatch(/next-epoch/);
    expect(m.openGraph?.images).toEqual([expect.objectContaining({ alt: expect.stringMatching(/sAERO/) })]);
  });

  it("uses NEXT_PUBLIC_SITE_URL when a deployment sets one", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://votes.example.org");
    expect(String((await load()).metadataBase)).toBe("https://votes.example.org/");
  });
});
