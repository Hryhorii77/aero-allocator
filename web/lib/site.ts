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

// Aero retired the weekly vote on 2026-10-22, so the hosted Aerodrome site describes sAERO allocation; the Velodrome build still
// describes the weekly vote.
const AERO = PROTOCOL === "aerodrome";
const TITLE = AERO ? `${DISPLAY_PRESET.appName} — where your sAERO earns the most` : `${DISPLAY_PRESET.appName} — predicted hot pools`;
const DESCRIPTION = AERO
  ? "Read your sAERO positions, see which Aero gauges pay the most per day for your amount (fees and incentives, after your own dilution), " +
    "and allocate from your wallet. Non-custodial, free."
  : `Live forecast of next-epoch fee demand across ${DISPLAY_PRESET.displayName} pools on ${DISPLAY_PRESET.networkName}, ` +
    `with dilution-aware ${DISPLAY_PRESET.veTokenSymbol} allocation recommendations.`;
const IMAGE_ALT = AERO ? "What your sAERO earns per day in the best split of Aero gauges" : "Expected voter $ next epoch";

/**
 * Bump this whenever the share card's look or text changes. X and other link previews keep an image by its address, so a
 * new number is what makes them fetch the new card (posts that already unfurled keep what they showed).
 */
export const SHARE_CARD_VERSION = 2;
const SHARE_IMAGE = `/api/share?v=${SHARE_CARD_VERSION}`;

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
      alternates: { canonical: "/" },
      openGraph: {
        url: "/",
        title: TITLE,
        description: DESCRIPTION,
        siteName: DISPLAY_PRESET.appName,
        type: "website",
        images: [{ url: SHARE_IMAGE, width: 1200, height: 630, alt: IMAGE_ALT }],
      },
      twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [SHARE_IMAGE] },
    }),
  };
}
