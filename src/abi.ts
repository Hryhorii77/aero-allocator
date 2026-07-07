import { parseAbi } from "viem";

// Vyper struct Lp from LpSugar v3 (velodrome-finance/sugar contracts/LpSugar.vy).
const LP_STRUCT =
  "struct Lp { address lp; string symbol; uint8 decimals; uint256 liquidity; int24 type_; int24 tick; uint160 sqrt_ratio; address token0; uint256 reserve0; uint256 staked0; address token1; uint256 reserve1; uint256 staked1; address gauge; uint256 gauge_liquidity; bool gauge_alive; address fee; address bribe; address factory; uint256 emissions; address emissions_token; uint256 emissions_cap; uint256 pool_fee; uint256 unstaked_fee; uint256 token0_fees; uint256 token1_fees; uint256 locked; uint256 emerging; uint32 created_at; address nfpm; address alm; address root; }";

export const lpSugarAbi = parseAbi([
  LP_STRUCT,
  "struct Token { address token_address; string symbol; uint8 decimals; uint256 account_balance; bool listed; bool emerging; }",
  "function all(uint256 _limit, uint256 _offset, uint256 _filter) view returns (Lp[])",
  "function byAddress(address _address) view returns (Lp)",
  "function count() view returns (uint256)",
  "function tokens(uint256 _limit, uint256 _offset, address _account, address[] _addresses) view returns (Token[])",
]);

// Older LpSugar deployments take all(limit, offset) without the filter arg;
// keep a fallback ABI so the data layer can degrade gracefully.
export const lpSugarAbiLegacy = parseAbi([
  LP_STRUCT,
  "function all(uint256 _limit, uint256 _offset) view returns (Lp[])",
]);

export const rewardsSugarAbi = parseAbi([
  "struct LpEpochReward { address token; uint256 amount; }",
  "struct LpEpoch { uint256 ts; address lp; uint256 votes; uint256 emissions; LpEpochReward[] bribes; LpEpochReward[] fees; }",
  "function epochsLatest(uint256 _limit, uint256 _offset) view returns (LpEpoch[])",
  "function epochsByAddress(uint256 _limit, uint256 _offset, address _address) view returns (LpEpoch[])",
]);

export const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
