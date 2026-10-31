import type { Metadata } from "next";
import Link from "next/link";
import { DISPLAY_PRESET } from "@/lib/protocol";
import { siteMetadata } from "@/lib/site";
import { SiteFooter } from "../site-footer";
import { TrackRecordPanel } from "../track-record";
import { LINK } from "../ui";

const TITLE = `Track record · ${DISPLAY_PRESET.appName}`;
const DESCRIPTION =
  "Every day the site logs the split it would recommend for 10,000 sAERO on Base before the gauges pay, and checks it two days later against what they did pay.";

/** A shareable page for the track-record panel, which also sits on the home page. Same data, from the public /api/track-record. */
export function generateMetadata(): Metadata {
  const base = siteMetadata();
  return {
    ...base,
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: "/track-record" },
    openGraph: { ...base.openGraph, url: "/track-record", title: TITLE, description: DESCRIPTION },
    twitter: { ...base.twitter, title: TITLE, description: DESCRIPTION },
  };
}

export default function TrackRecordPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 overflow-x-clip px-6 py-10 lg:px-8">
      <Link href="/" className={`text-sm ${LINK}`}>
        &larr; {DISPLAY_PRESET.appName}
      </Link>
      <TrackRecordPanel standalone />
      <SiteFooter />
    </main>
  );
}
