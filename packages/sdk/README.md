# @alphamarkets/sdk

Typed client for AlphaMarkets: derivatives for tokenized equities. The frontend, trading bots, market makers and integrators all use this package to reach the contracts and `services/api`.

It depends only on [viem](https://viem.sh). There is no React or browser-only code, and it ships ESM and CJS builds with type declarations.

```sh
npm install @alphamarkets/sdk viem
```

## Quick start

```typescript
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AlphaMarkets } from "@alphamarkets/sdk";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const alphaMarkets = new AlphaMarkets({
  chainId: 46630,
  transport: http(process.env.RPC_URL),
  account, // only for methods that send transactions
  apiUrl: "https://api.example.com", // options quotes, history, candles, analytics, live stream
  explorerUrl: "https://explorer.example.com",
});

// Fund the vault. Collateral must exist before any trade.
const token = alphaMarkets.addresses.settlementToken;
await alphaMarkets.erc20.approve(token, alphaMarkets.addresses.vault, "10000", { wait: true });
await alphaMarkets.vault.deposit(token, "5000", { wait: true });

// Preview first: every figure a person must see before signing.
const preview = await alphaMarkets.perps.previewOpen({
  market: "NVDA-PERP",
  side: "LONG",
  collateral: "1000",
  leverage: 5,
  user: account.address,
});
console.log(preview.liquidationPrice, preview.fee, preview.violations);

// Then trade.
const { positionId } = await alphaMarkets.perps.openPosition({
  market: "NVDA-PERP",
  side: "LONG",
  collateral: "1000",
  leverage: 5,
  tx: { wait: true, onStatus: (event) => console.log(event.status) },
});
await alphaMarkets.perps.closePosition(positionId, { tx: { wait: true } });
```

## Configuration

`new AlphaMarkets(config)` takes:

| Field | Required | What it is |
|---|---|---|
| `chainId` | yes | The chain to use (46630, Robinhood Chain testnet, is the only recorded deployment). |
| `transport` | yes | A viem transport, for example `http(rpcUrl)` in a script or `custom(window.ethereum)` in a browser. No default RPC is baked in. |
| `account` | for writes | A viem account or address. Reads work without it. |
| `apiUrl` | for API methods | Base URL of `services/api`, with no trailing slash and no `/v1`. Methods that need it throw `NotImplementedError` without it. |
| `explorerUrl` | no | Base URL for `explorer.*` links. |
| `addresses` | no | Contract addresses to use instead of the recorded deployment (a local node or a fresh redeploy). The `ALPHAMARKETS_ADDRESSES` environment variable, a JSON object, overrides single contracts. |
| `webSocket` | no | A WebSocket class (the `ws` package) for `stream.subscribe` on Node versions before 22. |

## Conventions

- **Amounts.** Money and price inputs are a decimal string (`"1000.50"`) or a base-unit `bigint`. A JS `number` is rejected, to avoid float errors. Prices and strikes are 18-decimal fixed point. Collateral, fees and premiums use the settlement token's decimals.
- **Markets.** Pass a symbol (`"NVDA"`), a label (`"NVDA-PERP"`) or a bytes32 id. Markets come from MarketRegistry, never from a list in this package, so a new market needs no SDK change.
- **Previews.** `perps.previewOpen` and `options.previewOpen` return the fee, break-even, max loss, liquidation price and every onchain rule the order would break. They are display data; the contracts stay the source of truth for margin, liquidation and settlement.
- **Transactions.** Every write simulates first, so a revert is decoded before the wallet is asked to sign. Pass `tx.onStatus` to receive `preparing`, `awaiting_wallet`, `submitted` and, with `tx.wait: true`, `confirming` then `confirmed` or `failed`.
- **Errors.** Contract reverts become typed errors, all extending `AlphaMarketsContractError`: `MarketPausedError`, `StaleOraclePriceError`, `InsufficientMarginError`, `PositionLimitExceededError`, `OpenInterestLimitExceededError`, `SlippageExceededError`, `DeadlineExpiredError`, and for limit and trigger orders `OrderNotOpenError`, `OrderExpiredError`, `LimitPriceNotReachedError`, `TriggerPriceNotReachedError`. A wallet rejection is `UserRejectedError`. Anything the SDK cannot decode is returned unchanged.
- **Display data.** History, candles, statistics, open interest and funding history come from `services/indexer` through the API. They never feed margin, liquidation or settlement.

## Perpetuals

```typescript
const info = await alphaMarkets.perps.get("NVDA");        // config, risk, funding, index / mark / last price
await alphaMarkets.perps.increasePosition(positionId, { addCollateral: "200", addSize: "1000" });
await alphaMarkets.perps.reducePosition(positionId, { size: "500" });
await alphaMarkets.perps.closePosition(positionId);
```

`increasePosition` charges the taker fee on the added size and rejects a resulting leverage above the market's maximum.

### Strategies, the volatility surface and risk

```ts
import { buildStrategy } from "@alphamarkets/sdk";

// A straddle from the live chain: quote each side, then analyse.
const quotes = { CALL: await alphaMarkets.options.quote({ underlying: "NVDA", type: "CALL", strike: "190", expiry, contracts: 1 }),
                 PUT: await alphaMarkets.options.quote({ underlying: "NVDA", type: "PUT", strike: "190", expiry, contracts: 1 }) };
const straddle = buildStrategy("STRADDLE", { strike: 190 }, {
  spot: 190,
  quote: (type) => ({ mark: quotes[type].premium, bid: quotes[type].bid, ask: quotes[type].ask }),
});
straddle.netPremium; straddle.maxLoss; straddle.breakEvens; straddle.payoffAt(200);
```

`strategies` covers the seven strategies of the brief. It is analytics: `OptionsEngine` only lets a user buy options, so a strategy with a short leg (`executable: false`) cannot be opened. `options.surface("NVDA")` returns the model's volatility, prices and Greeks per strike and expiry: it is the pricing model's surface, not a market-implied one (there is no order book to imply it from), flat until a skew is configured. `institutional.risk(user)` stress-tests a wallet's open positions (perps at the shocked mark, options at intrinsic value) and `institutional.report(user)` / `reportCsv(user)` return its activity between two dates.

### Trading API, hedging and market makers

`alphaMarkets.trading.prepare*` builds an UNSIGNED transaction for every action (deposit, open, close, orders, options, RFQ) and `simulate(tx, from)` runs it as an `eth_call` first, so a bot in any language can sign with its own key: `services/api` serves the same thing as `POST /v1/trade/...`. `hedgeBook` and `planHedge` work out the perp trades that neutralise an options book's delta (`services/hedger` runs them, and only reports unless told to trade).

Market makers answer request-for-quote over `services/api` (`/v1/rfq/...`, and `/v1/mm/...` with an API key) by signing `rfq.typedData(quote)`; a user then calls `rfq.execute(quote)` and the position opens at the quoted price, within a band around the mark. Signing keys are critical secrets (see `packages/contracts/CHANGELOG.md`).

### Subaccounts, cross margin and structured products

`subaccounts.create(index)` makes a separate trading account: send engine calls as it with `subaccounts.execute` / `multicall` (all or nothing), and name a delegate that can trade but never withdraw. `perps.openPosition({ marginMode: "CROSS" })` backs a position with the whole account; `crossMargin.health(user)` returns the contract's own equity and requirement, and `setPortfolioMargin(true)` charges a hedged book less. `structured.build({ kind: "PROTECTED_LONG", ... })` prices a package (a protected long, a straddle, a strangle), signs its option quotes for the subaccount and returns the calls to open them together. All of these need a deployment made after `[1.3.0]`, and none of the contract features is audited.

### Limit orders

A limit order rests until the mark price reaches its trigger: at or below it for a long, at or above it for a short. It opens the position at the mark price, which is at least as good as the trigger.

```typescript
const preview = await alphaMarkets.perps.previewOpen({
  market: "NVDA", side: "LONG", collateral: "1000", leverage: 5,
  orderType: "LIMIT", limitPrice: "180", user: account.address,
});

const { orderId } = await alphaMarkets.perps.placeLimitOrder({
  market: "NVDA", side: "LONG", collateral: "1000", leverage: 5,
  limitPrice: "180",
  expiry: new Date(Date.now() + 24 * 3600 * 1000), // default: 24 hours
});

await alphaMarkets.perps.orders(account.address);  // every order the user placed, with status OPEN, EXECUTED or CANCELLED
await alphaMarkets.perps.cancelLimitOrder(orderId);
```

Nothing is reserved in the vault while an order waits. The margin and the taker fee are taken when it fills, so an order cannot fill if the balance is gone by then. Anyone can fill an order whose trigger is reached with `executeLimitOrder(orderId)`; `services/keeper` does this. `openPosition({ orderType: "LIMIT" })` is rejected with a pointer to `placeLimitOrder`, because the two return different things (a position id and an order id). Limit orders need a deployment that includes `PerpOrderManager`; on an older deployment they throw `NotImplementedError` and `portfolio.orders` returns an empty list.

## Options

European, cash-settled. There is no user "exercise" call: `options.settle()` settles every position in an expired series and the contract emits `OptionExercised` for each one that is in the money.

Prices are **signed**. The contract never accepts a caller-chosen premium: `previewOpen({ ..., user })` returns an `authorization` signed by the pricing service, and `quoteClose(positionId, user)` does the same for closing. It fixes the premium, is single-use, and expires within seconds (`InvalidQuoteError`, `QuoteExpiredError`, `QuoteAlreadyUsedError`).

```typescript
const series = { underlying: "NVDA", type: "CALL", strike: "190", expiry: "2026-10-30", contracts: 10 } as const;

const user = account.address;
const preview = await alphaMarkets.options.previewOpen({ ...series, user });
// preview.premium, preview.fee, preview.breakEven, preview.maxLoss, preview.quote.{bid, ask, iv, delta, gamma, theta, vega}
await alphaMarkets.options.openPosition({ ...series, authorization: preview.authorization!, tx: { wait: true } });

const close = await alphaMarkets.options.quoteClose(positionId, user);
await alphaMarkets.options.closePosition(positionId, { authorization: close.authorization });

const stats = await alphaMarkets.options.stats("NVDA", "2026-10-30"); // open interest and 24h volume per series, in contracts
```

- **Bid and ask.** Opening pays the ask and closing receives the bid. Both come from the model's mark price and a spread the pricing service is configured with (`OPTION_SPREAD_BPS`, 0 by default, which makes bid, mark and ask equal). There is no order book, because the vault pool is the only counterparty.
- **IV.** `quote.iv` is the volatility the model prices with, and `quote.ivSource` says where it came from: `realized` (measured from the indexed price history) or `default` (a flat assumption). It is not market-implied, because there is no options market to imply it from.
- **Greeks.** `theta` is per year and `vega` is per 1.00 of volatility, as the model returns them. Divide by 365 and by 100 for per day and per volatility point.

## Vault, portfolio and market data

```typescript
await alphaMarkets.vault.balances(account.address, token);               // balance, locked margin, available
await alphaMarkets.portfolio.summary(account.address);        // balances, positions, unrealized and realized PnL
await alphaMarkets.portfolio.positions(account.address);
await alphaMarkets.portfolio.history(account.address, { limit: 50 }); // API
await alphaMarkets.portfolio.funding(account.address);        // funding the wallet paid or received, API

await alphaMarkets.markets.list();                            // MarketRegistry
await alphaMarkets.markets.stats();                           // 24h change and volumes, API
await alphaMarkets.prices.get("NVDA");                        // index, mark and last price, chain
await alphaMarkets.prices.history("NVDA", "24h");             // API
await alphaMarkets.prices.candles("NVDA", "15m", 120);        // open, high, low, close and perp volume, API
await alphaMarkets.funding.history("NVDA");                   // funding rates the chain applied, API
await alphaMarkets.risk.openInterest("NVDA");                 // long, short and total, chain
await alphaMarkets.risk.openInterestHistory("NVDA", "7d");    // API
```

Live index prices and funding rates: `const stop = alphaMarkets.stream.subscribe({ markets: ["NVDA"], onTick })` opens the API's WebSocket feed and returns a function that closes it. On Node versions before 22, pass `webSocket` (the `ws` package) in the constructor.

## Namespaces

`markets`, `perps`, `options`, `vault`, `erc20`, `portfolio`, `prices`, `oracle`, `funding`, `risk`, `fees`, `explorer`, `stream`. Methods that need `apiUrl` say so in their type documentation.

## Versioning

The package follows semantic versioning. Contract addresses and ABIs are generated from the deployed contracts, so a new deployment can change what a method does; check `CHANGELOG.md` and the contracts changelog before upgrading. Until 1.0, a minor version may include breaking changes.

## Development

```sh
pnpm --filter @alphamarkets/sdk typecheck
pnpm --filter @alphamarkets/sdk test        # unit tests, plus an Anvil integration test if anvil and forge are installed
pnpm --filter @alphamarkets/sdk build       # dist/ with ESM, CJS and .d.ts
```

ABIs live in `src/generated/abis.ts` and are generated from Foundry output. After any contract signature change:

```sh
cd packages/contracts && forge build
pnpm --filter @alphamarkets/sdk generate:abis
```

The integration test (`src/integration.test.ts`) deploys the contracts to a local Anvil node and runs deposit, open, increase, close, withdraw, signed option quotes, limit orders and stop-loss orders through the SDK. Set `SKIP_ANVIL_TESTS=1` to skip it.


### Stop-loss and take-profit

A trigger order is attached to an open perp position. When the mark price reaches the trigger, the whole remaining position closes at the mark price. A long's stop-loss and a short's take-profit fire as the price falls to the trigger; a long's take-profit and a short's stop-loss fire as it rises to it.

```ts
const { orderId } = await alphaMarkets.perps.placeTriggerOrder({
  positionId,
  kind: "STOP_LOSS", // or "TAKE_PROFIT"
  triggerPrice: "180",
  expiry: new Date("2026-12-31"), // default: 30 days
  tx: { wait: true },
});

await alphaMarkets.perps.cancelTriggerOrder(orderId);
const mine = await alphaMarkets.portfolio.triggerOrders(user); // filter on status === "OPEN"
```

At placement the trigger must sit on the side of the current mark that has not fired yet (a long's stop-loss below it, its take-profit above it; a short is the mirror image), or the call fails with `InvalidTriggerPriceError`. Anyone can fire an order whose trigger is reached with `executeTriggerOrder(orderId)`; `services/keeper` does this. Before then it fails with `TriggerPriceNotReachedError`.

The exit has no slippage bound: if the price jumps past the trigger, the position closes at the new price, not at the trigger. An order on a position that closed another way can never fire (`executeTriggerOrder` fails with the contract's `PositionNotOpen`); cancel it or let it expire. Trigger orders need a deployment made after `[1.3.0]`: `perps.supportsTriggerOrders()` tells you, and `placeTriggerOrder` throws `NotImplementedError` without it.

### Publishing

`@alphamarkets/config` and `@alphamarkets/types` are bundled into `dist/`, so consumers install only this package and `viem`. `prepublishOnly` builds and tests. Publishing is manual: run the **Release SDK** workflow (`.github/workflows/release-sdk.yml`) with an `NPM_TOKEN` secret, or `pnpm publish --access public` from this directory.
