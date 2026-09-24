# Runbook: pausing, incidents and rollback

This is the pause and rollback plan that the "Pre-mainnet checklist" in `DEVELOPMENT_STEPS.md` asks for. It
describes what the contracts can actually do today, checked against the code and against the rehearsal in
`SECURITY_REVIEW.md`. Fields marked **TBD** need a person or a decision from the team and are not filled in on
purpose: a name invented here would be worse than a blank.

## What can be paused, and by whom

| Lever | Call | Who | Effect | Does not stop |
|---|---|---|---|---|
| Stop new trading in every market | `MarketRegistry.pauseAll()` | `PAUSER_ROLE` | Every active market becomes inactive: new positions, increases, limit orders and new options revert with `MarketPaused` | Closing or reducing a position, liquidation, option settlement |
| Stop new trading in one market | `MarketRegistry.setActive(marketId, false)` | `PAUSER_ROLE` or `MARKET_ADMIN_ROLE` | Same, for one market | Same |
| Stop all price reads for one market | `OracleRouter.pauseMarket(marketId)` | `PAUSER_ROLE` or `ORACLE_ADMIN_ROLE` | Every read of that market's price reverts with `MarketOraclePaused`: no opens, no closes, **no liquidations**, no option settlement for it | Other markets |
| Turn a market back on | `MarketRegistry.setActive(marketId, true)` | `MARKET_ADMIN_ROLE` only | Trading resumes for that market | |
| Restore an oracle | `OracleRouter.unpauseMarket(marketId)` | `ORACLE_ADMIN_ROLE` only | Reads resume | |

- Pausing is deliberately fast and restoring is deliberately slow. The pauser cannot turn anything back on,
  change a price source or change any configuration, so a stolen pauser key can stop trading but not steal.
- Pausing the oracle also blocks liquidations for that market, so a long pause lets underwater positions build.
  Prefer `pauseAll` or `setActive(false)` when the price is trustworthy and only trading needs to stop.
- After a pause, restoring is one call per market by the admin (the timelock), so a full restart takes as many
  admin calls as there are markets.

## Pause speed once admin sits behind a timelock

The rehearsal on a fork showed that an admin call sent through a `TimelockController` executes only after its
delay. The pause therefore must not depend on the admin: the timelock grants `PAUSER_ROLE` to a fast key (an
on-call operator, a monitoring bot) on both `MarketRegistry` and `OracleRouter`, and that key pauses directly.
`HandOverAdmin.s.sol` moves the role from the deployer to the new admin along with the admin roles, so the
deployer keeps no pause power after the handover. Granting the pauser key is then a timelocked admin call: do it
before launch, not during an incident.

A vault or contract already deployed from older code has no pauser: the admin grants `PAUSER_ROLE` after the
upgrade, because it is only given automatically to a fresh deployment.

## Who does what (TBD)

| Role | Holder | How fast they must act |
|---|---|---|
| Pause a market | **TBD** | **TBD** |
| Rotate the quoter key | **TBD** | **TBD** |
| Rotate the keeper and liquidator keys | **TBD** | **TBD** |
| Decide to upgrade or roll back | **TBD** | **TBD** |
| Talk to users | **TBD** | **TBD** |

## Incidents

**Wrong or stale price.** The router already rejects a price older than the max age and two sources that disagree
by more than the max deviation. If the price is wrong but still fresh and in agreement, pause the market's oracle
(`pauseMarket`), then fix the source with `setPrimarySource` or `setFallbackSource`, then unpause.

**Quoter key compromised.** An attacker can sign option quotes until the role is revoked, but only with premiums
inside the on-chain bounds (not zero, not below the option's intrinsic value less 2%, not above the value of the
underlying). Call `pauseAll` first, which the pauser can do at once. Then revoke `QUOTER_ROLE` on `OptionsEngine`
and grant it to a new key: after the handover that is an admin call and waits for the timelock. Signed quotes
expire after 30 seconds, so nothing already signed stays valid for long.

**Maker key compromised (RFQ).** Same steps for `MAKER_ROLE` on `RFQManager`.

**Keeper or liquidator down.** Nothing in the protocol liquidates on its own. If no bot is running, positions stay
open past their maintenance margin. Restart the bot and check the API's price timestamp is fresh. On testnet the
keeper also refreshes the mock feeds, which go stale after 1 hour; that does not apply to real feeds.

**Option settlement backlog.** A series settles 50 positions per `settleExpired` call. A holder never waits: they
call `settlePosition(positionId)` (the web app's Settle button does). A keeper can finish a series with repeated
`settleExpired` calls or `settleExpiredBatch` with a larger size; `settleCursor(seriesId)` against
`seriesPositionCount(seriesId)` shows the progress.

**Indexer or API down.** The chain stays the source of truth: positions, balances and settlement are unaffected.
The web app shows stale or missing history and cannot fetch option quotes. Users can still close perps and
withdraw through any wallet.

**The pool cannot pay a winner.** A profitable close reverts with `InsufficientPoolReserves` and the position
stays open. It clears when losing positions settle or the pool is funded. To fund it, run `AMOUNT=<whole tokens>
forge script script/FundPool.s.sol --rpc-url <rpc> --broadcast`. If this happens often, lower the market's
`maxNetOpenInterest` (`script/SetNetOpenInterest.s.sol`) or fund a larger pool. There is no way to take funds back out
of the pool, so size a top-up deliberately.

**Bad debt.** A liquidation that leaves a shortfall covers it from the insurance fund and emits `BadDebt` for the
rest. Alert on every `BadDebt` event, and check the insurance fund balance before raising caps.

## Rolling back a contract upgrade

Every protocol contract is a UUPS proxy, and the proxy address never changes. The previous implementation address
for each contract is recorded in `packages/contracts/deployments/<network>.implementations.json` before an upgrade.

1. Confirm the old layout is still valid: `python3 script/check-storage-layout.py`.
2. From the admin (the timelock after the handover), call `upgradeToAndCall(previousImplementation, 0x)` on the
   proxy.
3. Verify: `cast implementation <proxy>` returns the previous address, and read a few stored values to confirm the
   state is intact.

A rollback is only safe if the new implementation did not add or reorder storage. If it did, do not roll back;
pause the market and ship a fix forward.

## Launch limits (canary)

Open interest and position caps must be conservative at launch and raised only once mainnet is stable. After the
markets are configured and before the site opens, run:

```bash
cd packages/contracts
RPC_URL=<mainnet rpc> MAX_POSITION=<whole tokens> MAX_OPEN_INTEREST=<whole tokens> \
  MAX_NET_OPEN_INTEREST=<whole tokens> MAX_LEVERAGE=<n> [MAX_MOVE_BPS=5000] \
  ./script/check-launch-limits.sh <network>
```

It reads every active market's limits from `RiskManager` and exits with an error if any is above the values you
pass, if a market has no net open interest limit, or if the vault's pool is smaller than the sum of the net limits
times `MAX_MOVE_BPS` (default 50%, an assumed worst one-sided price move). **The numbers are a product decision and
are TBD**; the script only enforces whatever you choose. Run it again after every change to a risk parameter or
to the pool.

Order for a fresh mainnet deployment: `DeployAll`, add the markets, `SetNetOpenInterest`, `FundPool`, then
`check-launch-limits.sh`. Upgrading an existing vault that already holds user balances is different: run
`vault.bootstrapLiabilities(token)` in the same transaction batch as the upgrade, or every withdrawal reverts.

## Before launch

- [ ] Every **TBD** above is filled in.
- [ ] A fast pauser key is chosen, granted `PAUSER_ROLE` on `MarketRegistry` and `OracleRouter`, and a pause was rehearsed with it.
- [ ] `check-launch-limits.sh` passes with the chosen limits.
- [ ] A pause and an unpause were rehearsed on the staging deployment by the people named above.
