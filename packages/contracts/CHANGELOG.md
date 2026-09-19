# Changelog

All notable changes to Orionis Markets smart contracts are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security — option premiums are now signed (redeploy required)

`OptionsEngine` previously took the premium from the caller. `openPosition` only checked it against a caller-supplied `maxPremium`, so a buyer could open any option for a premium of 0; `closePosition` only checked a caller-supplied lower bound `minPremium`, so a seller could claim any amount as the close premium and draw it from the shared collateral pool. Both are fixed:

- Every open and close now needs an EIP-712 `Quote` (`validUntil`, `nonce`, `signature`) signed by a holder of the new `QUOTER_ROLE` over that exact user, series, size and premium (`OpenQuote` / `CloseQuote`). The signature binds the caller and the engine address, expires, and can be used once.
- `OpenPositionParams.maxPremium` and the `minPremium` argument are gone: the signed premium is the price.
- New errors: `InvalidQuote`, `QuoteExpired`, `QuoteAlreadyUsed`. `openQuoteDigest` / `closeQuoteDigest` expose the digests for signers and tests.
- `OptionsEngine` now takes an `admin_` constructor argument (first) and is an `AccessControl` contract. `DeployAll.s.sol` grants `QUOTER_ROLE` to `QUOTER_ADDRESS` (default: the deployer, for local runs).
- Tests: `test/options/OptionQuotes.t.sol` covers a missing, forged, tampered, expired, replayed and borrowed quote, an inflated close premium, revoked quoters, and a fuzz over unsigned premiums.

Shipped in `[1.1.0-testnet]` below. The `[1.0.0-testnet]` contracts still have the old, exploitable `OptionsEngine` and are abandoned.

Trust model: the quoter key sets option prices, so it is a critical secret. Use a dedicated key (not the deployer), keep it only in `services/pricing`, and move the role behind a multisig or HSM before mainnet (PROJECT_BRIEF.md Section 37). Settlement does not depend on it: expiry payouts still come from the oracle's settlement price. Not yet enforced onchain, and worth adding before mainnet: a floor at intrinsic value for opens and a ceiling for closes, so a compromised quoter cannot sell deep in-the-money options for nothing or pay out more than they are worth.

### Known issue — `PerpsEngine.increasePosition` skips fee and leverage checks (found in manual testing of 1.1.0-testnet)

`openPosition` checks the leverage tier (`riskManager.checkLeverage`) and charges the taker fee; `reducePosition` and `closePosition` charge the taker fee. `increasePosition` does neither: it only checks position size and open interest. On testnet, increasing a $200 position by $50 emitted `PerpPositionUpdated` and no `ProtocolFeeCollected`. Consequences:

- Fee bypass: size added through `increasePosition` pays no taker fee.
- Leverage bypass: `addCollateral` may be 0, so a $100-margin position can be grown up to `maxPositionNotional` (about 5,000x at $500K), past the leverage tiers and the 10% initial margin.
- No Foundry test covers `increasePosition`.

Fix before mainnet (and before the audit): charge the taker fee on `addSize`, require the resulting leverage (`newSize / newCollateral`) to stay within `checkLeverage`, add unit and fuzz tests, and redeploy. Testnet only until then; the deployed `[1.1.0-testnet]` contracts have the flaw.

### Redeploy checklist

1. Generate a dedicated quoter key and set `QUOTER_PRIVATE_KEY` / `QUOTER_ADDRESS` in the root `.env`.
2. `forge script script/DeployAll.s.sol --rpc-url robinhood_testnet --broadcast` with `NETWORK_NAME=robinhood_testnet` (a dry run costs about 0.0005 ETH of gas).
3. `pnpm --filter @orionis/config sync:deployments`, clear any `NEXT_PUBLIC_*` address overrides in `.env`, and add the new addresses to this changelog.
4. Run `script/ConfigureMarkets.s.sol` to seed NVDA on the new registry, then `script/verify.sh`.
5. Reset or re-index the indexer database so rows from the old contracts do not mix with the new ones.

### Pending

- Explorer verification of the `[1.1.0-testnet]` contracts. `script/verify.sh` (now reads `deployments/<network>.json`, retries each contract, and takes `NVDA_TOKEN` / `NVDA_FEED` for the mock market contracts) failed on every request with `client error (Connect)`: `explorer.testnet.chain.robinhood.com` currently fails TLS certificate validation. Re-run it once Robinhood fixes the certificate; do not disable TLS checks.

- Root `.env`'s `NEXT_PUBLIC_RPC_URL` currently holds a personal Alchemy API key — replace with a public/rate-limited endpoint before this is ever exposed to a real frontend build, since `NEXT_PUBLIC_*` vars ship to the browser.

### Explorer verification of `[1.0.0-testnet]` — complete (all 18/18)

`script/verify.sh` hit Robinhood's Blockscout explorer serving an intermittently expired, and sometimes completely unrelated (`internetsehatku.com`), TLS certificate on `explorer.testnet.chain.robinhood.com` — Robinhood's own infra issue, not fixable from this repo. Failures were per-request bad luck, not permanent: repeated runs of `script/verify-retry.sh` eventually got every one of the 18 deployed contracts (all 15 core contracts, the settlement token, the NVDA mock underlying token, and the NVDA mock price feed) verified.

## [1.1.0-testnet] - 2026-09-19

Full redeploy to Robinhood Chain testnet (chain ID 46630) via `script/DeployAll.s.sol`, followed by `script/ConfigureMarkets.s.sol`. It replaces `[1.0.0-testnet]` and ships the signed-premium `OptionsEngine` (see Unreleased "Security"). Every contract was confirmed live with `cast code`, and `QUOTER_ROLE` on `OptionsEngine` was confirmed granted to the dedicated quoter `0xC9FA7B955B9FeffDFC3363e095447B99F8c2D31c` (not the deployer). The settlement token `0x70b0FDa35dEb7BA710C601Ed9c45b9F992027112` is unchanged.

| Contract | Address |
|---|---|
| MarketRegistry | `0x15F599aFBCE042922716ae2C169e5dB9Be6eA855` |
| CollateralManager | `0x3bd150A6c70aa668cB6052DD6c4cb44938B1557D` |
| OrionisVault | `0x5c809C4872c603fBF74f48Fdc8348EaDEC5dFF66` |
| FeeManager | `0x15C6b95c289bd093b05B7578257aDfE4CADe8EDF` |
| BuybackModule | `0x829447D77f25578706d7C84c2756bc793094fCda` |
| PriceValidator | `0xe4b6E3e7e92F4877F725283D5D3a719f99B0392B` |
| OracleRouter | `0xCB9AD3D302C49696FBc322742355a84f49D618cd` |
| RiskManager | `0x7cBE5EcFC9a57022e6Ee397627D6b4B354c9Eb2D` |
| OptionPositionManager | `0x0f612910002A6dc4A2087A2dD3f851d4D850C017` |
| OptionMarket | `0xcf418529fA0B64ce8359E1C3abb33c8c216C5954` |
| OptionsEngine | `0x8c7F0f7e196d9C841b3BE2CDf0Ad52D4F2a00cd5` |
| PerpPositionManager | `0xC3D98bACc4c6Ba46D16229fb8AD117e0dFC643d6` |
| FundingManager | `0x850F32d7c7F29F913C26556d46820f0D2108428d` |
| PerpsEngine | `0x901bA7223B4298ddB0CF4528200792d4F679580F` |
| LiquidationEngine | `0xd03C8E323c63B13213c78408D3f55c4A1b2e6C9B` |
| NVDA underlying token (mock) | `0x68bc85c9f800eA0776838079125b648b7f107b1A` |
| NVDA price feed (mock, seeded $190) | `0xF812D671dF93D97f11415D7A91472F98eBd4E31E` |

The NVDA market was seeded with the same risk and placeholder fee configuration as `[1.0.1-testnet]`. The mock price feed only holds its seeded price until the oracle's staleness window passes; a stale feed makes `getIndexPrice` revert with `StaleOraclePrice()`, so refresh it before testing.

## [1.0.1-testnet] - 2026-09-18

`script/ConfigureMarkets.s.sol` run for real against `[1.0.0-testnet]` below — seeded the NVDA market. Confirmed live via `cast code` on the underlying token before recording.

| Item | Address |
|---|---|
| NVDA underlying token (mock) | `0xCb73eA96c319846E4d15B2920c0FD2223D5796Ee` |
| NVDA price feed (mock, seeded $190) | `0xE7970f8eCD2917813E6B242d8f5796A6c0049e13` |

Wired: `OracleRouter.setPrimarySource(NVDA, ...)`, `MarketRegistry.addMarket` (10x max leverage, options+perps enabled, $5M OI cap), `RiskManager.setRiskConfig` (leverage tiers 1/2/3/5/10x, 10%/5% initial/maintenance margin, $500K max position — PROJECT_BRIEF.md Section 13/19 NVDA example), `FeeManager.setFeeConfig` (placeholder fees, see `ConfigureMarkets.s.sol` comments — confirm real numbers with product).

## [1.0.0-testnet] - 2026-09-18

Deployed to Robinhood Chain testnet (chain ID 46630) via `script/DeployAll.s.sol`, routed through an Alchemy RPC endpoint (Robinhood's own default RPC had an expired TLS certificate at deploy time). All roles wired automatically by the script.

**Note on verification history:** a first `DeployAll.s.sol --broadcast` attempt looked successful in its trace output but never actually broadcast anything — its simulation reverted at the final `vm.writeJson` step (the `deployments/` folder didn't exist yet), and `forge script` only sends real transactions once the *entire* simulation completes without reverting. This was caught by checking `cast code` on the resulting `oracleRouter` address, which returned `0x` (empty). After creating the `deployments/` folder, the script was re-run and every address below was confirmed live via `cast code` before being recorded here.

| Contract | Address |
|---|---|
| MarketRegistry | `0x027D56C99D9E486F8911F0bd58EE508a817E9c0e` |
| CollateralManager | `0x760E82300F3E2095Ae2E04318a0ef03cb693d52c` |
| OrionisVault | `0x9F05fd9F0fE15fEbBd6EDcd7D63f4D0bCe7d3c1b` |
| FeeManager | `0xa8fF53Fb41Bbf90B79f8c45B1576BB6F93Dc45c3` |
| BuybackModule | `0x9Ae0Ebf31ee39F74bB412f80c4F7dcA953abBCFf` |
| PriceValidator | `0x413f505814A0175bb7551EFb966c0580345EbF9F` |
| OracleRouter | `0x1203d1d05ae5DA1DE18752680B525F7CB0b5aFb0` |
| RiskManager | `0x2aFdFE61A5222609865Ca46BFAC90c0a35Bf5870` |
| OptionPositionManager | `0x566A18Be08fB6Df937F461741985503cE3f8486F` |
| OptionMarket | `0x5341E0C1bb61D4f776B99afE332912A4502112b4` |
| OptionsEngine | `0x1cC0612e39c1977daA7CFA4F031807b66D26a632` |
| PerpPositionManager | `0x1d8A3f6b8E720dE6cF7Bf8cDa8A7aEc32fb9Cac6` |
| FundingManager | `0xF7E00Bbe120a88137536C69e3ad01aC96807B51C` |
| PerpsEngine | `0x563b532ee62FbC2C8344626934959B132Bf95786` |
| LiquidationEngine | `0x13ed3961E2C518a5db9dFc29e895CAbAe6DE09A4` |
| Settlement token (mock USDC) | `0x70b0FDa35dEb7BA710C601Ed9c45b9F992027112` |

Full record: `packages/contracts/deployments/robinhood_testnet.json`.

### Added

- Foundry project scaffold (`forge init`), `forge-std` and `@openzeppelin/contracts@v5.1.0` dependencies, `foundry.toml` (solc 0.8.26, optimizer 200 runs, fuzz profiles), `remappings.txt`, domain `src/`/`test/` layout (`core/`, `oracle/`, `risk/`, `options/`, `perps/`, `interfaces/`).
- Interfaces: `IOracle`, `IMarketRegistry`, `IOrionisVault`, `IOptionsEngine`, `IPerpsEngine`, plus `IRiskManager`/`IFeeManager`/`IPriceFeed` (necessary additions beyond PROJECT_BRIEF.md Section 6's literal list, so engines depend on interfaces rather than concrete contracts), and shared `DataTypes.sol`/`Errors.sol`.
- `MarketRegistry` — single source of truth for market config, per-market pause.
- Oracle layer: `PriceValidator` (staleness/deviation checks), `OracleRouter` (routes to primary/fallback `IPriceFeed`, normalizes to 18 decimals, records immutable settlement prices), `MockPriceFeed` (testnet/local stub).
- `CollateralManager`, `OrionisVault` (deposits/withdrawals/locked margin/PnL settlement/funding transfers/fee transfers), `FeeManager` (per-market fee config + buyback routing), `BuybackModule` (fee-routing stub; real swap deferred to Phase 2/3).
- `MarginEngine` (pure isolated-margin math library) and `RiskManager` (per-market leverage tiers, position/OI caps).
- Options: `OptionPositionManager`, `OptionMarket` (series identifier + OI), `OptionSettlement` (pure intrinsic-value/payout math), `OptionsEngine` (open/close/settleExpired; users only buy, the Vault's shared pool is the implicit writer).
- Perps: `PerpPositionManager`, `FundingManager`, `PerpsEngine` (open/increase/reduce/close), `LiquidationEngine` (deterministic `isLiquidatable`/`liquidate`, keeper-incentivized, fee+reward capped to the owner's actual available balance so liquidation itself can never revert on a deeply underwater position).
- Security pass: `ReentrancyGuard` on every fund-moving entrypoint, `AccessControl` roles throughout, slippage (`SlippageExceeded`) and deadline (`DeadlineExpired`) checks on every price-sensitive engine action including `increasePosition`, custom errors per PROJECT_BRIEF.md Section 36 plus documented necessary additions (`PositionNotLiquidatable`, `DeadlineExpired`, `SlippageExceeded`, `UnsupportedToken`).
- Full event catalogue per PROJECT_BRIEF.md Section 35 plus documented additions (`OracleSourceUpdated`, `OracleMarketPaused`, `RiskConfigUpdated`).
- Foundry test suite: 58 tests across unit, fuzz (`MarginEngine`, `OptionSettlement`, `FundingManager` zero-sum), and integration (options open→close/settle, perps open→close/liquidate) — all passing.
- `script/DeployAll.s.sol` — deploys the full stack, wires every role, writes `deployments/<network>.json`.
- `script/ConfigureMarkets.s.sol` — seeds one market (NVDA) on an already-deployed stack: mock underlying token + price feed, `MarketRegistry.addMarket`, `RiskManager.setRiskConfig` (numbers match PROJECT_BRIEF.md Section 13/19's NVDA example), `FeeManager.setFeeConfig` (placeholder fees, not specified in the brief), `OracleRouter.setPrimarySource`.
- `.github/workflows/contracts.yml` — CI job: `forge fmt --check`, `forge build`, `forge test`, `forge coverage`.

### Known limitations (tracked for Phase 2+)

- `OracleRouter.getMarkPrice` == `getIndexPrice` (no independent onchain mark price source), so perp funding never accrues in practice until a real mark-price mechanism is built.
- Options are buy-only; the Vault's shared collateral pool implicitly writes every option (no explicit seller/writer role or per-writer margin).
- Non-upgradeable; no protocol-wide pause switch (per-market pause only) — both explicit MVP decisions, not oversights.
