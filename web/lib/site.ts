import type { Metadata } from "next";
import { DISPLAY_PRESET } from "./protocol";

/** Where this deployment lives, for absolute URLs in link previews. A self-hosted copy sets NEXT_PUBLIC_SITE_URL. */
export const SITE_URL: string = process.env.NEXT_PUBLIC_SITE_URL ?? "https://aeroallocator.app";

const TITLE = `${DISPLAY_PRESET.appName} — where your sAERO earns the most`;
const DESCRIPTION =
  "Read your sAERO positions, see which Aero gauges pay the most per day for your amount (fees and incentives, after your own dilution), " +
  "and allocate from your wallet. Non-custodial, free.";
const IMAGE_ALT = "What your sAERO earns per day in the best split of Aero gauges";

/**
 * Bump this whenever the share card's look or text changes. X and other link previews keep an image by its address, so a
 * new number is what makes them fetch the new card (posts that already unfurled keep what they showed).
 */
export const SHARE_CARD_VERSION = 2;
const SHARE_IMAGE = `/api/share?v=${SHARE_CARD_VERSION}`;

/**
 * Pasting the site's address into a post unfurls the share card
 * (app/api/share) at the default amount — the number a stranger would see
 * first. The image is the page's own answer, not a static banner: what 10,000
 * sAERO earns per day in the best split of Base gauges.
 */
export function siteMetadata(): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
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
  };
}
