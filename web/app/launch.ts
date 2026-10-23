/** Aero launch instant: "October 21, 2026 at 8:00 PM EDT (October 22, 00:00 UTC)" per Aero's article. */
export const AERO_LAUNCH_AT_MS = Date.UTC(2026, 9, 22, 0, 0, 0);

/** True once Aero's launch instant has passed. Pages decide per render so server and first paint stay the same. */
export const hasAeroLaunched = (nowMs: number = Date.now()) => nowMs >= AERO_LAUNCH_AT_MS;
