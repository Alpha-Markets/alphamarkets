import { env } from "@/lib/env";

/// Every contract in the deployment (`ContractAddresses`, packages/config/src/deployments.ts) —
/// shown in full so a trader can verify all of it directly on the block explorer instead of taking
/// custody and settlement on trust, matching what the landing page's own FAQ already claims ("every
/// contract AlphaMarkets runs on is listed"). The five marked optional in `ContractAddresses` (limit
/// orders, the insurance fund, cross margin, subaccounts, RFQ) were added after the first deployment
/// and are `undefined` on a deployment made before they existed; `LandingContracts` already renders
/// an `undefined` address as "not yet deployed", so listing them here costs nothing on an older chain.
export const CONTRACTS = [
  { label: "Market registry", description: "Lists every tokenized equity market and its parameters.", address: env.addresses.marketRegistry },
  { label: "Vault", description: "Holds trader collateral and settles every trade's PnL.", address: env.addresses.vault },
  { label: "Collateral manager", description: "Keeps the ledger of what each account has deposited.", address: env.addresses.collateralManager },
  { label: "Fee manager", description: "Collects trading fees and routes a share to the buyback module.", address: env.addresses.feeManager },
  { label: "Buyback module", description: "Uses protocol revenue to buy back the protocol token.", address: env.addresses.buybackModule },
  { label: "Risk manager", description: "Sets each market's open-interest cap and leverage tiers.", address: env.addresses.riskManager },
  { label: "Oracle router", description: "Routes and validates the mark and index price every contract reads.", address: env.addresses.oracleRouter },
  { label: "Price validator", description: "Rejects stale or out-of-bounds oracle prices before they're used.", address: env.addresses.priceValidator },
  { label: "Perps engine", description: "Executes leveraged long and short perpetual positions.", address: env.addresses.perpsEngine },
  { label: "Perp position manager", description: "Stores perpetual positions; the perps engine is the only writer.", address: env.addresses.perpPositionManager },
  { label: "Funding manager", description: "Charges the side pushing price away from index, pays the other.", address: env.addresses.fundingManager },
  { label: "Liquidation engine", description: "Lets anyone liquidate an eligible position for a reward.", address: env.addresses.liquidationEngine },
  { label: "Perp order manager", description: "Holds resting limit and trigger orders until they fill.", address: env.addresses.perpOrderManager },
  { label: "Options engine", description: "Prices and settles cash-settled calls and puts.", address: env.addresses.optionsEngine },
  { label: "Option market", description: "Tracks each option series and its open interest.", address: env.addresses.optionMarket },
  { label: "Option position manager", description: "Stores option positions; the options engine is the only writer.", address: env.addresses.optionPositionManager },
  { label: "Insurance fund", description: "Covers a liquidated position's shortfall so bad debt stays rare.", address: env.addresses.insuranceFund },
  { label: "Cross margin manager", description: "Backs a cross position with the whole account, not just itself.", address: env.addresses.crossMargin },
  { label: "Subaccount factory", description: "Creates subaccounts and limits what they're allowed to call.", address: env.addresses.subaccountFactory },
  { label: "RFQ manager", description: "Lets a market maker quote a user's trade directly, off the order book.", address: env.addresses.rfqManager },
];
