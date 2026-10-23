"use client";

import { useEffect, useState } from "react";
import { DISPLAY_PRESET } from "@/lib/protocol";
import { hasAeroLaunched } from "./launch";

/** True once Aero is live on the Aerodrome build (client only, so the server render and first paint match). */
export function useAeroLive(): boolean {
  const [live, setLive] = useState(false);
  useEffect(() => {
    setLive(DISPLAY_PRESET.protocol === "aerodrome" && hasAeroLaunched());
  }, []);
  return live;
}
