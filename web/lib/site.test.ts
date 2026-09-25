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
    expect(m.openGraph?.images).toEqual([expect.objectContaining({ url: "/api/share", width: 1200, height: 630 })]);
    expect(m.twitter).toMatchObject({ card: "summary_large_image", images: ["/api/share"] });
  });

  it("uses NEXT_PUBLIC_SITE_URL when a deployment sets one", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://votes.example.org");
    expect(String((await load()).metadataBase)).toBe("https://votes.example.org/");
  });

  it("gives a Velodrome deployment with no site URL a plain title, not our card on someone else's domain", async () => {
    vi.stubEnv("NEXT_PUBLIC_AERO_PROTOCOL", "velodrome");
    const m = await load();
    expect(m.openGraph).toBeUndefined();
    expect(m.twitter).toBeUndefined();
    expect(m.title).toMatch(/Velodrome Allocator/);
  });
});
