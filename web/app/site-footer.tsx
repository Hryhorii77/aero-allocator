"use client";

import { DISPLAY_PRESET } from "@/lib/protocol";
import { SAERO } from "@/lib/saero";
import { LINK } from "./ui";
import { TipJar } from "./tip-jar";
import { useAeroLive } from "./use-aero-live";
import { useProtocolAddresses } from "./wallet";

const REPO_URL = "https://github.com/Hryhorii77/aero-allocator";
const X_URL = "https://x.com/hryhorii77";

/** Brand, links and the fine print. Same layout as afterbook.app's footer: brand + tagline +
 * links on the left, onchain links on the right, a ruled legal block, then a one-line meta row. */
export function SiteFooter({ snapshotAt }: { snapshotAt: number }) {
  const { data: addresses } = useProtocolAddresses();
  const aeroLive = useAeroLive();
  const explorer = DISPLAY_PRESET.chain.blockExplorers?.default;
  const { displayName, appName, networkName, veTokenSymbol } = DISPLAY_PRESET;

  return (
    <footer className="mt-12 text-[13px] leading-relaxed text-neutral-500">
      <div className="flex flex-col gap-6 sm:flex-row sm:justify-between sm:gap-8">
        <div>
          <div className="text-base font-semibold text-neutral-100">{appName}</div>
          <p className="mb-3 mt-1 max-w-md text-neutral-400">
            {aeroLive
              ? "Where to allocate your sAERO: gauges ranked by what your amount earns per day. Allocation happens in your wallet on "
              : `Where to vote your ${veTokenSymbol} this week: forecast fees, split by dilution. Voting stays on `}
            {displayName}.
          </p>
          <div className="flex flex-wrap gap-x-4">
            <a href={X_URL} target="_blank" rel="noreferrer" className={LINK}>
              X
            </a>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className={LINK}>
              GitHub
            </a>
            <a href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer" className={LINK}>
              README
            </a>
          </div>
          <div className="mt-3">
            <TipJar placement="up" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5 sm:text-right">
          <div className="mb-0.5 text-xs uppercase tracking-wider text-neutral-500">Onchain</div>
          {aeroLive && explorer && (
            <a href={`${explorer.url}/address/${SAERO.voter}`} target="_blank" rel="noreferrer" className={LINK}>
              Aero voter contract ↗
            </a>
          )}
          {!aeroLive && explorer && addresses && (
            <a
              href={`${explorer.url}/address/${addresses.voterAddress}`}
              target="_blank"
              rel="noreferrer"
              className={LINK}
            >
              Voter contract ↗
            </a>
          )}
          <a href={aeroLive ? "https://aero.xyz" : `${DISPLAY_PRESET.appUrl}/vote`} target="_blank" rel="noreferrer" className={LINK}>
            {aeroLive ? "Aero" : displayName} ↗
          </a>
        </div>
      </div>
      <div className="mt-6 space-y-2 border-t border-neutral-800 pt-4">
        <p>Not investment advice. Forecasts are estimates and can be wrong.</p>
        <p>
          Independent and non-custodial. Not affiliated with {aeroLive ? "Aero" : displayName}, Dromos Labs or {networkName}.{" "}
          {aeroLive ? "Allocations are sent" : "Votes are cast"} from your own wallet; this app never asks for a seed phrase.
        </p>
        {!aeroLive && (
        <p>
          Or skip the UI and ask an agent:{" "}
          <span className="font-mono text-neutral-400">&quot;recommend a voter_roi allocation for my {veTokenSymbol}&quot;</span>
          . MCP server (free, self-hosted) or the x402 API (from 5¢/call, no setup), same tools and same numbers; see{" "}
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={LINK}>
            the repo
          </a>
          .
        </p>
        )}
      </div>
      <p className="mt-4">
        {aeroLive ? (
          <>Live data: Aero&rsquo;s contracts on {networkName} and the other Aero chains, trading-fee logs, and DefiLlama prices.</>
        ) : (
          <>
            Live data: {displayName} Sugar contracts on {networkName} + DefiLlama prices · snapshot{" "}
            {new Date(snapshotAt).toLocaleTimeString()}
          </>
        )}
      </p>
      <p className="mt-1">MIT licensed · Built on {networkName}</p>
    </footer>
  );
}
