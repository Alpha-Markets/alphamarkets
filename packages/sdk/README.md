# @orionis/sdk

Typed client for Orionis Markets — derivatives for tokenized equities. The frontend, trading bots, market makers and integrators all use this package to reach the contracts and `services/api`.

## Usage

```typescript
import { http } from "viem";
import { Orionis } from "@orionis/sdk";

const orionis = new Orionis({
  chainId: 46630,
  transport: http(process.env.RPC_URL),
  account, // only needed for methods that send transactions
  apiUrl: "https://api.example.com", // options quotes, history, WebSocket stream
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL,
});

const markets = await orionis.markets.list();

// Preview first: every value the terminal must show before signing.
const preview = await orionis.perps.previewOpen({
  market: "NVDA-PERP",
  side: "LONG",
  collateral: "1000",
  leverage: 5,
  user: account.address,
});

await orionis.perps.openPosition({
  market: "NVDA-PERP",
  side: "LONG",
  collateral: "1000",
  leverage: 5,
  tx: { wait: true, onStatus: (event) => console.log(event.status) },
});
```

## Conventions

- **Amounts.** Money and price inputs are a decimal string (`"1000.50"`) or a base-unit `bigint`. JS `number` is rejected. Prices and strikes are 18-decimal fixed point; collateral and premiums use the settlement token's decimals.
- **Markets.** Pass a symbol (`"NVDA"`), a label (`"NVDA-PERP"`) or a bytes32 id. Markets come from MarketRegistry, never from a list in this package.
- **Transactions.** Every write simulates first, so reverts are decoded before the wallet is asked to sign. Pass `tx.onStatus` to receive `preparing`, `awaiting_wallet`, `submitted`, and, with `tx.wait: true`, `confirming` then `confirmed` or `failed`.
- **Errors.** Contract reverts become typed errors (`MarketPausedError`, `StaleOraclePriceError`, `InsufficientMarginError`, ...), all extending `OrionisContractError`. A wallet rejection becomes `UserRejectedError`.
- **Previews.** `perps.previewOpen` and `options.previewOpen` return fee, break-even, max loss, liquidation price and any onchain rule the order would break. The contracts stay the source of truth for liquidation and settlement; previews are display only.
- **Orders.** `orderType` is `"MARKET"` today. `"LIMIT"` is rejected until limit orders ship.
- **Options analytics.** Premium and Greeks come from `services/pricing` through the API and are never used for settlement.
- **Runtime.** Depends only on `viem`. No React or browser-only code. ESM and CJS builds. On Node versions before 22, pass `webSocket` (the `ws` package) to use `stream.subscribe`.

## Namespaces

`markets`, `perps`, `options`, `vault`, `erc20`, `portfolio`, `prices`, `oracle`, `funding`, `risk`, `fees`, `explorer`, `stream`.

European cash-settled options have no user "exercise" call. `options.settle()` settles every position in an expired series and the contract emits `OptionExercised` for each in-the-money position.

## Development

```sh
pnpm --filter @orionis/sdk typecheck
pnpm --filter @orionis/sdk test        # unit tests, plus an Anvil integration test if anvil + forge are installed
pnpm --filter @orionis/sdk build       # dist/ with ESM, CJS and .d.ts
```

ABIs live in `src/generated/abis.ts` and are generated from Foundry output. After any contract signature change:

```sh
cd packages/contracts && forge build
pnpm --filter @orionis/sdk generate:abis
```

The integration test (`src/integration.test.ts`) deploys the contracts to a local Anvil node and runs approve, deposit, open, close and withdraw through the SDK. Set `SKIP_ANVIL_TESTS=1` to skip it.
