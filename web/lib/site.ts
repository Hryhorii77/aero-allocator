import type { Metadata } from "next";
import { DISPLAY_PRESET, PROTOCOL } from "./protocol";

/**
 * Where this deployment lives, for absolute URLs in link previews. The hosted
 * Aerodrome site is the only one we know the address of; a self-hosted or
 * Velodrome deployment sets NEXT_PUBLIC_SITE_URL, and without one gets no
 * preview image rather than a card advertising somebody else's domain.
 */
export const SITE_URL: string | undefined =
  process.env.NEXT_PUBLIC_SITE_URL ?? (PROTOCOL === "aerodrome" ? "https://aeroallocator.app" : undefined);

const TITLE = `${DISPLAY_PRESET.displayName} Allocator — predicted hot pools`;
const DESCRIPTION =
  `Live forecast of next-epoch fee demand across ${DISPLAY_PRESET.displayName} pools on ${DISPLAY_PRESET.networkName}, ` +
  `with dilution-aware ${DISPLAY_PRESET.veTokenSymbol} allocation recommendations.`;

/**
 * Pasting the site's address into a post unfurls the share card
 * (app/api/share) at the default amount — the number a stranger would see
 * first. The image is the page's own answer, not a static banner, so it
 * carries the current expected $ and the time left to vote.
 */
export function siteMetadata(): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    ...(SITE_URL && {
      metadataBase: new URL(SITE_URL),
      openGraph: {
        title: TITLE,
        description: DESCRIPTION,
        siteName: `${DISPLAY_PRESET.displayName} Allocator`,
        type: "website",
        images: [{ url: "/api/share", width: 1200, height: 630, alt: "Expected voter $ next epoch" }],
      },
      twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/api/share"] },
    }),
  };
}
