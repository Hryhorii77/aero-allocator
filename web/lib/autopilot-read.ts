import type { Address } from "viem";
import { AERO_CHAINS, type AeroChain } from "./aero-chains";
import { getGaugeFees } from "./gauge-fees-read";
import { rankByUsdPerDay } from "./gauge-yield";
import { client, gaugeLabel, getGauges, type GaugeRow } from "./gauges";
import { SAERO, saeroLeafAbi } from "./saero";
import { splitRate } from "./split";
import { readAllPowers } from "./top-allocators-read";
import { type AutopilotChain, type AutopilotData, type AutopilotPool } from "./autopilot";
import { findAutopilotPools } from "./autopilot-find";

const TTL_MS = 30 * 60_000;
const toTokens = (v: bigint) => Number(v) / 1e18;

let cached: { at: number; value: AutopilotData } | null = null;
let inflight: Promise<AutopilotData> | null = null;

/** One position's gauges and amounts on one chain's leaf voter (same address on every chain), whole tokens; idle power left out. */
async function leafAllocations(cfg: AeroChain, tokenId: number): Promise<Array<{ gauge: string; allocated: number }>> {
  const c = client(cfg);
  const id = BigInt(tokenId);
  const gauges = (await c.readContract({ address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "allocatedGauges", args: [id] })) as Address[];
  const real = gauges.filter((g) => !/^0x0+$/.test(g));
  if (real.length === 0) return [];
  const amounts = (await c.multicall({ allowFailure: false, contracts: real.map((g) => ({ address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "allocations" as const, args: [id, g] as const })) })) as bigint[];
  return real.map((g, i) => ({ gauge: g.toLowerCase(), allocated: toTokens(amounts[i]) })).filter((x) => x.allocated > 0);
}

/**
 * Autopilot's pools and where each one's power sits on every chain, with each gauge's rate priced like the site's splits. Kept 30
 * minutes: the keeper can only move a pool once per wait. A chain that can't be read is named in `skipped` and its part counts as nothing.
 */
export async function readAutopilot(nowMs = Date.now()): Promise<AutopilotData> {
  if (cached && nowMs - cached.at < TTL_MS) return cached.value;
  inflight ??= (async () => {
    const found = await findAutopilotPools(await readAllPowers(nowMs));
    const chains = AERO_CHAINS.filter((c) => c.feeLogs);
    const skipped = new Set<string>();
    const books = new Map(
      await Promise.all(
        chains.map(async (cfg) => {
          try {
            const [list, fees] = await Promise.all([getGauges(cfg.id), getGaugeFees(cfg.id)]);
            const rows = new Map(rankByUsdPerDay(list.gauges, fees.fees, 1, 0).map((r) => [r.gauge.toLowerCase(), r]));
            const gauges = new Map<string, GaugeRow>(list.gauges.map((g) => [g.gauge.toLowerCase(), g]));
            return [cfg.id, { rows, gauges }] as const;
          } catch {
            skipped.add(cfg.name);
            return [cfg.id, null] as const;
          }
        }),
      ),
    );
    const pools: AutopilotPool[] = await Promise.all(
      found.map(async ({ tokenId, power }) => {
        const perChain = await Promise.all(
          chains.map(async (cfg): Promise<AutopilotChain | null> => {
            const book = books.get(cfg.id);
            if (!book) return null;
            const allocs = await leafAllocations(cfg, tokenId).catch(() => {
              skipped.add(cfg.name);
              return null;
            });
            if (!allocs || allocs.length === 0) return null;
            return {
              chainId: cfg.id,
              name: cfg.name,
              gauges: allocs.map(({ gauge, allocated }) => {
                const row = book.rows.get(gauge);
                const g = book.gauges.get(gauge);
                return {
                  gauge,
                  label: row ? gaugeLabel(row) : g ? gaugeLabel(g) : `${gauge.slice(0, 6)}…`,
                  allocated,
                  rateUsdPerDay: row ? splitRate(row) : 0,
                  weight: g?.weight ?? allocated,
                  priced: !!row,
                };
              }),
            };
          }),
        );
        return { tokenId: String(tokenId), power, chains: perChain.filter((c): c is AutopilotChain => !!c) };
      }),
    );
    const value: AutopilotData = { generatedAt: nowMs, pools, skipped: [...skipped] };
    cached = { at: nowMs, value };
    return value;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

