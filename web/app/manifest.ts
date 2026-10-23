import type { MetadataRoute } from "next";
import { DISPLAY_PRESET } from "@/lib/protocol";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: DISPLAY_PRESET.appName,
    short_name: DISPLAY_PRESET.appName,
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
