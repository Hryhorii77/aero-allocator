import { DISPLAY_PRESET } from "@/lib/protocol";
import { hasAeroLaunched } from "./launch";

/**
 * True once Aero is live on the Aerodrome build. Plain, not state: the launch is in the past, so the static page is built live and
 * the browser agrees on first paint (no flash of the retired weekly page, and no weekly snapshot fetch).
 */
export function useAeroLive(): boolean {
  return DISPLAY_PRESET.protocol === "aerodrome" && hasAeroLaunched();
}
