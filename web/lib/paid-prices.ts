// The three paid x402 routes' prices in USD, in a module with no imports so /llms.txt, /AGENTS.md and their generator
// (scripts/generate-agents-md.ts) can read them without loading the routes, next/server or a node client. Each route
// re-exports its own price from here, so the price charged and the price written down are one constant.
export const POSITION_PRICE_USD = 0.05;
export const ALLOCATE_PLAN_PRICE_USD = 0.1;
export const CROSS_CHAIN_PLAN_PRICE_USD = 0.25;
