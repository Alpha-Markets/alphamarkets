# @orionis/sdk

Typed client for Orionis Markets: derivatives for tokenized equities. The frontend, trading bots, market makers and integrators all use this package to reach the contracts and `services/api`.

It depends only on [viem](https://viem.sh). There is no React or browser-only code, and it ships ESM and CJS builds with type declarations.

```sh
npm install @orionis/sdk viem
```

## Quick start

```typescript
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Orionis } from "@orionis/sdk";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const orionis = new Orionis({
  chainId: 46630,
  transport: http(process.env.RPC_URL),
  account, // only for methods that send transactions
  apiUrl: "https://api.example.com", // options quotes, history, candles, analytics, live stream
  explorerUrl: "https://explorer.example.com",
});

// Fund the vault. Collateral must exist before any trade.
const token = orionis.addresses.settlementToken;
await orionis.erc20.approve(token, orionis.addresses.vault, "10000", { wait: true });
await orionis.vault.deposit(token, "5000", { wait: true });

// Preview first: every figure a person must see before signing.
const preview = await orionis.perps.previewOpen({
  market: "NVDA-PERP",
  side: "LONG",
  collateral: "1000",
  leverage: 5,
  user: account.address,
});
console.log(preview.liquidationPrice, preview.fee, preview.violations);

// Then trade.
const { positionId } = await orionis.perps.openPosition({
  market: "NVDA-PERP",
  side: "LONG",
  collateral: "1000",
  leverage: 5,
  tx: { wait: true, onStatus: (event) => console.log(event.status) },
});
await orionis.perps.closePosition(positionId, { tx: { wait: true } });
```

## Configuration

`new Orionis(config)` takes:

| Field | Required | What it is |
|---|---|---|
| `chainId` | yes | The chain to use (46630, Robinhood Chain testnet, is the only recorded deployment). |
| `transport` | yes | A viem transport, for example `http(rpcUrl)` in a script or `custom(window.ethereum)` in a browser. No default RPC is baked in. |
| `account` | for writes | A viem account or address. Reads work without it. |
| `apiUrl` | for API methods | Base URL of `services/api`, with no trailing slash and no `/v1`. Methods that need it throw `NotImplementedError` without it. |
| `explorerUrl` | no | Base URL for `explorer.*` links. |
| `addresses` | no | Contract addresses to use instead of the recorded deployment (a local node or a fresh redeploy). The `ORIONIS_ADDRESSES` environment variable, a JSON object, overrides single contracts. |
| `webSocket` | no | A WebSocket class (the `ws` package) for `stream.subscribe` on Node versions before 22. |

## Conventions

- **Amounts.** Money and price inputs are a decimal string (`"1000.50"`) or a base-unit `bigint`. A JS `number` is rejected, to avoid float errors. Prices and strikes are 18-decimal fixed point. Collateral, fees and premiums use the settlement token's decimals.
- **Markets.** Pass a symbol (`"NVDA"`), a label (`"NVDA-PERP"`) or a bytes32 id. Markets come from MarketRegistry, never from a list in this package, so a new market needs no SDK change.
- **Previews.** `perps.previewOpen` and `options.previewOpen` return the fee, break-even, max loss, liquidation price and every onchain rule the order would break. They are display data; the contracts stay the source of truth for margin, liquidation and settlement.
- **Transactions.** Every write simulates first, so a revert is decoded before the wallet is asked to sign. Pass `tx.onStatus` to receive `preparing`, `awaiting_wallet`, `submitted` and, with `tx.wait: true`, `confirming` then `confirmed` or `failed`.
- **Errors.** Contract reverts become typed errors, all extending `OrionisContractError`: `MarketPausedError`, `StaleOraclePriceError`, `InsufficientMarginError`, `PositionLimitExceededError`, `OpenInterestLimitExceededError`, `SlippageExceededError`, `DeadlineExpiredError`, and for limit orders `OrderNotOpenError`, `OrderExpiredError`, `LimitPriceNotReachedError`. A wallet rejection is `UserRejectedError`. Anything the SDK cannot decode is returned unchanged.
- **Display data.** History, candles, statistics, open interest and funding history come from `services/indexer` through the API. They never feed margin, liquidation or settlement.

## Perpetuals

```typescript
const info = await orionis.perps.get("NVDA");        // config, risk, funding, index / mark / last price
await orionis.perps.increasePosition(positionId, { addCollateral: "200", addSize: "1000" });
await orionis.perps.reducePosition(positionId, { size: "500" });
await orionis.perps.closePosition(positionId);
```

`increasePosition` charges the taker fee on the added size and rejects a resulting leverage above the market's maximum.

### Limit orders

A limit order rests until the mark price reaches its trigger: at or below it for a long, at or above it for a short. It opens the position at the mark price, which is at least as good as the trigger.

```typescript
const preview = await orionis.perps.previewOpen({
  market: "NVDA", side: "LONG", collateral: "1000", leverage: 5,
  orderType: "LIMIT", limitPrice: "180", user: account.address,
});

const { orderId } = await orionis.perps.placeLimitOrder({
  market: "NVDA", side: "LONG", collateral: "1000", leverage: 5,
  limitPrice: "180",
  expiry: new Date(Date.now() + 24 * 3600 * 1000), // default: 24 hours
});

await orionis.perps.orders(account.address);  // every order the user placed, with status OPEN, EXECUTED or CANCELLED
await orionis.perps.cancelLimitOrder(orderId);
```

Nothing is reserved in the vault while an order waits. The margin and the taker fee are taken when it fills, so an order cannot fill if the balance is gone by then. Anyone can fill an order whose trigger is reached with `executeLimitOrder(orderId)`; `services/keeper` does this. `openPosition({ orderType: "LIMIT" })` is rejected with a pointer to `placeLimitOrder`, because the two return different things (a position id and an order id). Limit orders need a deployment that includes `PerpOrderManager`; on an older deployment they throw `NotImplementedError` and `portfolio.orders` returns an empty list.

## Options

European, cash-settled. There is no user "exercise" call: `options.settle()` settles every position in an expired series and the contract emits `OptionExercised` for each one that is in the money.

Prices are **signed**. The contract never accepts a caller-chosen premium: `previewOpen({ ..., user })` returns an `authorization` signed by the pricing service, and `quoteClose(positionId, user)` does the same for closing. It fixes the premium, is single-use, and expires within seconds (`InvalidQuoteError`, `QuoteExpiredError`, `QuoteAlreadyUsedError`).

```typescript
const series = { underlying: "NVDA", type: "CALL", strike: "190", expiry: "2026-10-30", contracts: 10 } as const;

const user = account.address;
const preview = await orionis.options.previewOpen({ ...series, user });
// preview.premium, preview.fee, preview.breakEven, preview.maxLoss, preview.quote.{bid, ask, iv, delta, gamma, theta, vega}
await orionis.options.openPosition({ ...series, authorization: preview.authorization!, tx: { wait: true } });

const close = await orionis.options.quoteClose(positionId, user);
await orionis.options.closePosition(positionId, { authorization: close.authorization });

const stats = await orionis.options.stats("NVDA", "2026-10-30"); // open interest and 24h volume per series, in contracts
```

- **Bid and ask.** Opening pays the ask and closing receives the bid. Both come from the model's mark price and a spread the pricing service is configured with (`OPTION_SPREAD_BPS`, 0 by default, which makes bid, mark and ask equal). There is no order book, because the vault pool is the only counterparty.
- **IV.** `quote.iv` is the volatility the model prices with, and `quote.ivSource` says where it came from: `realized` (measured from the indexed price history) or `default` (a flat assumption). It is not market-implied, because there is no options market to imply it from.
- **Greeks.** `theta` is per year and `vega` is per 1.00 of volatility, as the model returns them. Divide by 365 and by 100 for per day and per volatility point.

## Vault, portfolio and market data

```typescript
await orionis.vault.balances(account.address, token);               // balance, locked margin, available
await orionis.portfolio.summary(account.address);        // balances, positions, unrealized and realized PnL
await orionis.portfolio.positions(account.address);
await orionis.portfolio.history(account.address, { limit: 50 }); // API
await orionis.portfolio.funding(account.address);        // funding the wallet paid or received, API

await orionis.markets.list();                            // MarketRegistry
await orionis.markets.stats();                           // 24h change and volumes, API
await orionis.prices.get("NVDA");                        // index, mark and last price, chain
await orionis.prices.history("NVDA", "24h");             // API
await orionis.prices.candles("NVDA", "15m", 120);        // open, high, low, close and perp volume, API
await orionis.funding.history("NVDA");                   // funding rates the chain applied, API
await orionis.risk.openInterest("NVDA");                 // long, short and total, chain
await orionis.risk.openInterestHistory("NVDA", "7d");    // API
```

Live index prices and funding rates: `const stop = orionis.stream.subscribe({ markets: ["NVDA"], onTick })` opens the API's WebSocket feed and returns a function that closes it. On Node versions before 22, pass `webSocket` (the `ws` package) in the constructor.

## Namespaces

`markets`, `perps`, `options`, `vault`, `erc20`, `portfolio`, `prices`, `oracle`, `funding`, `risk`, `fees`, `explorer`, `stream`. Methods that need `apiUrl` say so in their type documentation.

## Versioning

The package follows semantic versioning. Contract addresses and ABIs are generated from the deployed contracts, so a new deployment can change what a method does; check `CHANGELOG.md` and the contracts changelog before upgrading. Until 1.0, a minor version may include breaking changes.

## Development

```sh
pnpm --filter @orionis/sdk typecheck
pnpm --filter @orionis/sdk test        # unit tests, plus an Anvil integration test if anvil and forge are installed
pnpm --filter @orionis/sdk build       # dist/ with ESM, CJS and .d.ts
```

ABIs live in `src/generated/abis.ts` and are generated from Foundry output. After any contract signature change:

```sh
cd packages/contracts && forge build
pnpm --filter @orionis/sdk generate:abis
```

The integration test (`src/integration.test.ts`) deploys the contracts to a local Anvil node and runs deposit, open, increase, close, withdraw, signed option quotes and limit orders through the SDK. Set `SKIP_ANVIL_TESTS=1` to skip it.

### Publishing

`@orionis/config` and `@orionis/types` are bundled into `dist/`, so consumers install only this package and `viem`. `prepublishOnly` builds and tests. Publishing is manual: run the **Release SDK** workflow (`.github/workflows/release-sdk.yml`) with an `NPM_TOKEN` secret, or `pnpm publish --access public` from this directory.
