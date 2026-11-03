// Aero's Autopilot pools depositors' sAERO into one position per option and its keeper allocates it across chains. Found on-chain on
// 2026-11-03: the pools are positions owned by EIP-1167 clones made by AUTOPILOT_FACTORY (#20365 and #20366 then, both minted 2026-10-30
// and empty until Aero's "Autopilot is LIVE" post on 2026-10-31, growing steadily after). This file prices what a deposit would earn.

/** The factory whose clones own Autopilot's pooled positions on Base. A position counts as Autopilot only if its owner says so. */
export const AUTOPILOT_FACTORY = "0xA5283582951ae0cF72bE4BEA54dA63D199264B78";
/** The pools known when this was built; the reader also looks for new ones among the largest positions. */
export const KNOWN_AUTOPILOT_POOLS = [20366, 20365];

export interface AutopilotGauge {
  gauge: string;
  label: string;
  /** The pool's power on this gauge, whole tokens. */
  allocated: number;
  /** What the gauge pays everyone in it per day, priced like the site's splits (a burst at its usual level); 0 when it has no estimate. */
  rateUsdPerDay: number;
  /** Power in the gauge, the pool's included, whole tokens. */
  weight: number;
  priced: boolean;
}

export interface AutopilotChain {
  chainId: number;
  name: string;
  gauges: AutopilotGauge[];
}

export interface AutopilotPool {
  tokenId: string;
  /** Voting power, whole tokens. */
  power: number;
  chains: AutopilotChain[];
}

export interface AutopilotData {
  generatedAt: number;
  pools: AutopilotPool[];
  /** Chains whose gauges or the pool's allocation there couldn't be read just now: their part counts as earning nothing. */
  skipped: string[];
}

/** Power the pool has on gauges, whole tokens (the rest of its power is idle or in transit and earns nothing). */
export const allocatedPower = (p: AutopilotPool) => p.chains.reduce((s, c) => s + c.gauges.reduce((t, g) => t + g.allocated, 0), 0);

/**
 * What the pool earns per day now: each gauge pays the pool its rate times the pool's share of the gauge's weight.
 */
export function poolUsdPerDay(p: AutopilotPool): number {
  let usd = 0;
  for (const c of p.chains) for (const g of c.gauges) if (g.priced && g.allocated > 0) usd += (g.rateUsdPerDay * g.allocated) / Math.max(g.weight, g.allocated);
  return usd;
}

/**
 * What `amount` of power earns per day once deposited into the pool, assuming the keeper keeps its split: the pool grows from P to P + a,
 * each gauge's share grows pro rata (adding allocated x a/P to that gauge's weight too), and the depositor gets a / (P + a) of the total.
 * For an amount small next to the pool this is close to a x (the pool's earnings / P). Before Autopilot's own fee, which Aero hasn't published.
 */
export function depositUsdPerDay(p: AutopilotPool, amount: number): number {
  const P = p.power;
  if (!(P > 0) || !(amount > 0)) return 0;
  const grow = amount / P;
  let usd = 0;
  for (const c of p.chains)
    for (const g of c.gauges) {
      if (!g.priced || !(g.allocated > 0)) continue;
      const alloc = g.allocated * (1 + grow);
      usd += (g.rateUsdPerDay * alloc) / (Math.max(g.weight, g.allocated) + g.allocated * grow);
    }
  return (usd * amount) / (P + amount);
}

/** The pool's power by chain as a share of all its power, largest first; what isn't on gauges is reported as idle. */
export function chainShares(p: AutopilotPool): { chains: Array<{ chainId: number; name: string; pct: number }>; idlePct: number } {
  if (!(p.power > 0)) return { chains: [], idlePct: 0 };
  const chains = p.chains
    .map((c) => ({ chainId: c.chainId, name: c.name, pct: (c.gauges.reduce((s, g) => s + g.allocated, 0) / p.power) * 100 }))
    .filter((c) => c.pct > 0)
    .sort((a, b) => b.pct - a.pct);
  return { chains, idlePct: Math.max(0, 100 - chains.reduce((s, c) => s + c.pct, 0)) };
}
