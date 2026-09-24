# Mainnet deployment: verified facts, decisions and the exact steps

Status on 2026-09-25: everything below that can be prepared without your keys and decisions is prepared and was
**rehearsed end to end on a local fork of real Robinhood Chain mainnet state**, with a throwaway deployer, the real
USDG token and the real Chainlink feeds. **Nothing has been deployed to mainnet.** The steps that need you are
listed in "What only you can supply". The audit is still open and this document does not replace it.

## Verified facts

Checked on chain on 2026-09-24 and 2026-09-25 with read-only calls, not only read from documentation.

| Item | Value | Source |
|---|---|---|
| Chain ID | 4663 (mainnet launched 2026-07-01, Arbitrum-based L2, ETH gas) | [Robinhood support](https://robinhood.com/us/en/support/articles/robinhood-chain-mainnet/); the RPC returns 4663 |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` | Same |
| Explorer | `https://robinhoodchain.blockscout.com` (Blockscout) | Same |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` (code present) | Checked on chain |
| Settlement token | USDG (Paxos) `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, **6 decimals**, symbol `USDG` | [Contracts page](https://docs.robinhood.com/chain/contracts/); checked on chain |
| Stock token factory | `0x4783C67b63dE2B358Ac5951a7D41F47A38F3C046`, tokens found through its `Deployed` event | [Envio guide](https://docs.envio.dev/blog/index-robinhood-chain-data) |
| Price feeds | Chainlink Data Feeds, `AggregatorV3Interface` (`latestRoundData()`), **8 decimals**, updated 24/5 | [Robinhood oracle docs](https://docs.robinhood.com/chain/oracles-and-price-feeds/) |

### Markets checked on chain

Token symbol and 18 decimals confirmed on each token; feed description, 8 decimals and a positive fresh answer
confirmed on each feed. The list came from a third-party GitHub issue and **that source was wrong about the feed
decimals (it said 18, the chain says 8)**, so re-check every address against Chainlink's own
[Robinhood feeds page](https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood) before use.

| Market | Stock token | Chainlink feed | Price seen (USD) |
|---|---|---|---|
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` | 224.41 |
| TSLA | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` | `0x4A1166a659A55625345e9515b32adECea5547C38` | 382.46 |
| AAPL | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` | `0x6B22A786bAa607d76728168703a39Ea9C99f2cD0` | 338.10 |
| META | `0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35` | `0x7C38C00C30BEe9378381E7B6135d7283356D71b1` | 769.90 |
| AMZN | `0x12f190a9F9d7D37a250758b26824B97CE941bF54` | `0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C` | 248.78 |
| MSFT | `0xe93237C50D904957Cf27E7B1133b510C669c2e74` | `0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E` | 495.51 |
| GOOGL | `0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3` | `0xF6f373a037c30F0e5010d854385cA89185AE638b` | 341.92 |
| COIN | `0x6330D8C3178a418788dF01a47479c0ce7CCF450b` | `0xA3a468A452940B7D6b69991207B508c609a98Ef2` | 198.61 |
| AMD | `0x86923f96303D656E4aa86D9d42D1e57ad2023fdC` | `0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72` | 623.55 |
| PLTR | `0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A` | `0x820ABedFF239034956B7A9d2F0a331f9F075eB4c` | 193.56 |

A feed reports the token's value as the underlying price times a multiplier from the token contract, so it is the
price of the token, which is what this protocol lists.

## Decisions that change how mainnet behaves

1. **Feed freshness (`MAX_PRICE_AGE`).** The router rejects a price older than this per market. At the time of
   checking, the feeds were between 3 minutes and about 2 hours old (MSFT was 7,157 seconds). The limit must be
   longer than each feed's heartbeat, which is on Chainlink's page and was not readable through the tools used here:
   read it and set the limit from it. A long limit means liquidations may use an old price; a short one halts the
   market whenever a feed is quiet.
2. **Weekends.** Stock feeds update 24/5. When a feed stops, reads revert once its age passes `MAX_PRICE_AGE`: the
   market halts, and nothing can open, close or liquidate. An option that expires while a feed is stale settles at
   the first valid price after expiry, which can be the next session's open. Decide the policy: pause the markets
   over the weekend, and offer only weekday expiries. The app's expiry settings (`NEXT_PUBLIC_OPTION_EXPIRY_*`)
   choose the expiry time.
3. **Corporate actions.** Chainlink's catalog notes the token contract can pause its oracle around corporate actions
   (a multiplier change). A market whose token or feed is paused must be paused here too: the pauser role does that.
4. **The pool, net limits and caps, and the fees.** `AddMainnetMarket.s.sol` has no default for any of them.

## What only you can supply

| Item | Why |
|---|---|
| A **funded mainnet deployer key** (ETH for gas) and the ETH | Only you hold keys. Cost: the gas price was 0.0418 gwei at the last check, so `DeployAll` (about 55 million gas) costs a small fraction of an ETH plus the chain's data fee. |
| The multisig address, the timelock delay, and the **fast pauser address** | The admin and the emergency pause |
| The quoter, maker and keeper addresses | Separate keys, see `docs/MAINNET_READINESS.md` |
| The numbers: pool reserve, net and position and open-interest caps, leverage, maintenance margin, all six fees, `MAX_PRICE_AGE` | Product decisions |
| The audit, or your written decision to launch without it | It is the largest risk |

## The steps (rehearsed on a mainnet fork)

Run from `packages/contracts` with the deployer key in `PRIVATE_KEY` and the mainnet RPC. Nothing in it is
irreversible until step 2, which spends gas.

1. **Load the environment.**
   ```
   export NETWORK_NAME=robinhood_mainnet
   export RPC=https://rpc.mainnet.chain.robinhood.com        # or a private provider URL
   export COLLATERAL_TOKEN=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
   export QUOTER_ADDRESS=<quoter> MAKER_ADDRESS=<maker>
   ```
2. **Deploy the 20 contracts.** Writes `deployments/robinhood_mainnet.json` and the implementations file.
   ```
   forge script script/DeployAll.s.sol --rpc-url $RPC --broadcast --slow
   ```
3. **List each market** (one command per market; every number is required, none has a default). The script refuses if
   the token's symbol is not `SYMBOL`, the token is not 18 decimals, the feed has no positive price, or the price is
   older than `MAX_PRICE_AGE`.
   ```
   SYMBOL=NVDA TOKEN=<stock token> FEED=<chainlink feed> MAX_PRICE_AGE=<seconds> MAX_LEVERAGE=<n> \
   MAINTENANCE_MARGIN_BPS=<bps> MAX_POSITION=<usdg> OPEN_INTEREST_CAP=<usdg> MAX_NET_OPEN_INTEREST=<usdg> \
   MAKER_FEE_BPS=<bps> TAKER_FEE_BPS=<bps> OPTION_OPEN_FEE_BPS=<bps> OPTION_CLOSE_FEE_BPS=<bps> \
   SETTLEMENT_FEE_BPS=<bps> LIQUIDATION_FEE_BPS=<bps> \
   forge script script/AddMainnetMarket.s.sol --rpc-url $RPC --broadcast --slow
   ```
4. **Fund the pool** (the deployer must hold the USDG): `AMOUNT=<usdg> forge script script/FundPool.s.sol --rpc-url $RPC --broadcast`.
5. **Run the launch check.** It must pass before anything else:
   ```
   RPC_URL=$RPC MAX_POSITION=<n> MAX_OPEN_INTEREST=<n> MAX_LEVERAGE=<n> MAX_NET_OPEN_INTEREST=<n> \
   ./script/check-launch-limits.sh robinhood_mainnet
   ```
6. **Make one small real trade yourself** (deposit, open, close) and confirm the fee and the balance.
7. **Deploy the timelock** with the multisig as proposer and executor, then **hand over**: run
   `NEW_ADMIN=<timelock> forge script script/HandOverAdmin.s.sol --rpc-url $RPC --broadcast --slow`, prove the
   timelock can act (a scheduled call executes only after the delay), then run it again with `RENOUNCE=true`.
8. **Grant the fast pauser** through the timelock (`grantRole(PAUSER_ROLE, <pauser>)` on `MarketRegistry` and
   `OracleRouter`), and have the pauser run `pauseAll` once to prove it works, then restore each market through the
   timelock.
9. **Verify the contracts** on the explorer: `VERIFY_RPC_URL=$RPC EXPLORER_VERIFY_URL=https://robinhoodchain.blockscout.com/api ./script/verify-full.sh`,
   and verify each `ChainlinkFeedAdapter` and the timelock with `forge verify-contract`.
10. **Add mainnet to `packages/config`** (chain 4663 and the deployment addresses) and build the web app for it on
    your domain, then run the services against the mainnet database.

## Rehearsal results (local fork of mainnet, 2026-09-25)

| Step | Result |
|---|---|
| `DeployAll` with the real USDG | Succeeded |
| `AddMainnetMarket` for NVDA, TSLA, AAPL and AMZN with the real feeds | Succeeded; each printed the feed description and price |
| Router read of NVDA through the adapter | 224.408817810000000000 in 18 decimals from an 8-decimal feed |
| `FundPool` 60,000 USDG, then the launch check | Passed: pool 60,000 covers 40,000 |
| A trader deposited 1,000 USDG, opened and closed an NVDA long | Both succeeded; fees 2 USDG on 1,000 of size at 10 bps each way |
| Timelock deploy and `HandOverAdmin`, both steps | 36 roles moved; the deployer held admin on 0 of 20 contracts |
| Grant the pauser through the timelock | An early execute reverted; after the delay it succeeded |
| `pauseAll` by the pauser | All markets stopped at once; the pauser could not turn one back on, and neither could the old deployer |

Not covered by the rehearsal: options against the real feed (the bounds are tested at 6 decimals in
`PremiumBoundsSixDecimals.t.sol`), the pricing service, the keeper and liquidation bot, and any real audit.
