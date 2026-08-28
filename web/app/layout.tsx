import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import { DISPLAY_PRESET } from "@/lib/protocol";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `${DISPLAY_PRESET.displayName} Allocator — predicted hot pools`,
  description:
    `Live forecast of next-epoch fee demand across ${DISPLAY_PRESET.displayName} pools on ${DISPLAY_PRESET.networkName}, ` +
    `with dilution-aware ${DISPLAY_PRESET.veTokenSymbol} allocation recommendations.`,
};

// This UI is always dark — declaring that explicitly (also set as a CSS
// property in globals.css) stops some mobile browsers from applying their
// own forced-dark heuristics on top of it, which otherwise washes out the
// colors instead of leaving them alone.
export const viewport: Viewport = {
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-200">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
