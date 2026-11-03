// A split chosen elsewhere on the page (today: "use this split" on a top allocator) for the Base allocate panel to start from. It lives in
// the browser tab only and is never sent anywhere; the owner still reviews the shares and signs. useSyncExternalStore reads it.

export interface PresetSplit {
  /** Where it came from, shown in the allocate panel, e.g. "position #10426". */
  from: string;
  /** Gauge addresses (lowercase) and shares in percent, adding up to 100. */
  parts: Array<{ gauge: string; pct: number }>;
}

let current: PresetSplit | null = null;
const listeners = new Set<() => void>();

export const getPresetSplit = (): PresetSplit | null => current;
export const getServerPresetSplit = (): PresetSplit | null => null;

export function setPresetSplit(next: PresetSplit | null): void {
  current = next;
  for (const l of listeners) l();
}

export function subscribePresetSplit(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
