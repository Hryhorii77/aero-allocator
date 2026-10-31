# aeroallocator-mcp

A free MCP server over [aeroallocator.app](https://aeroallocator.app)'s read-only APIs. An agent can ask where an amount of sAERO earns the most on each Aero chain, how best to split it across chains, which gauges are gaining power, and how the site's own advice has held up.

It **never signs or sends anything**, needs **no key or account**, and has **no dependencies** (Node 22 or newer).

## Add it to a client

```json
{ "mcpServers": { "aeroallocator": { "command": "npx", "args": ["-y", "aeroallocator-mcp"] } } }
```

Claude Code: `claude mcp add aeroallocator -- npx -y aeroallocator-mcp`

## Tools

| Tool | What it answers |
|---|---|
| `top_gauges` | The gauges on a chain (or on every chain at once with `chain: "all"`) ranked by what an amount earns per day after it joins the power already there, with the low case, pace (thin / fair / solid / spiky), steadiness and incentive-end notes. |
| `best_split_all_chains` | The best split of an amount over every Aero chain after the one-off ETH each extra chain costs, next to Base alone. |
| `power_flows` | Which gauges are gaining or losing share of a chain's allocation weight, and which got new incentives. |
| `gauge_history` | One gauge's recent fees, weight and steadiness, and up to 90 days of daily records. |
| `allocation_fee` | The ETH an allocation to another chain costs on Base. |
| `track_record` | The site's own forward-only record: each day's recommended split, logged before the fact, against what those gauges paid. Shown after 14 checked days. |

Chains: Base 8453, Ethereum 1, OP 10, Arbitrum 42161, Ink 57073, Robinhood Chain 4663, Arc 5042.

## What it does not do

- It does not allocate. Allocating is done from the owner's own wallet on the site (the site can also prepare the transactions for an agent through its paid, pay-per-call API; see https://aeroallocator.app/llms.txt).
- Its figures are estimates from the recent fee pace, not promises and not financial advice. Fees come in lumps, incentives end, and a new gauge's first hours say little.

`AEROALLOCATOR_URL` points it at another host (for example a local copy of the site).
