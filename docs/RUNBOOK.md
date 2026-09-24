# Runbook: pausing, incidents and rollback

This is the pause and rollback plan that the "Pre-mainnet checklist" in `DEVELOPMENT_STEPS.md` asks for. It
describes what the contracts can actually do today, checked against the code and against the rehearsal in
`SECURITY_REVIEW.md`. Fields marked **TBD** need a person or a decision from the team and are not filled in on
purpose: a name invented here would be worse than a blank.

## What can be paused, and by whom

| Lever | Call | Role | Effect | Does not stop |
|---|---|---|---|---|
| Stop new positions in one market | `MarketRegistry.setActive(marketId, false)` | `MARKET_ADMIN_ROLE` | New perp positions, position increases, limit orders and new option positions revert with `MarketPaused` | Closing or reducing a position, liquidation, option settlement |
| Stop all price reads for one market | `OracleRouter.pauseMarket(marketId)` | `ORACLE_ADMIN_ROLE` | Every read of that market's price reverts with `MarketOraclePaused`: no opens, no closes, **no liquidations**, no option settlement for it | Other markets |
| Restore | `setActive(marketId, true)` or `OracleRouter.unpauseMarket(marketId)` | same roles | Reads and trading resume | |

- There is **no protocol-wide pause**. To stop everything, each market has to be paused one by one.
- Pausing the oracle also blocks liquidations for that market, so a long pause lets underwater positions build.
  Prefer `setActive(false)` when the price is trustworthy and only the trading needs to stop.
- `OracleRouter.pauseMarket` and the oracle source setters share `ORACLE_ADMIN_ROLE`. A key that can pause the
  oracle can also swap its price source.

## The speed of a pause once admin sits behind a timelock

The rehearsal on a fork showed that an admin call sent through a `TimelockController` executes only after its
delay: an early execute reverts with `TimelockUnexpectedOperationState`. So after the handover, an emergency pause
takes at least the timelock delay to land. **This is an open risk (finding 2 in `SECURITY_REVIEW.md`).** Decide
before mainnet between:

1. A separate pauser role that a fast key holds and that can only pause (needs a contract change), or
2. A timelock delay short enough to accept for a pause.

Until one of these is done, do not describe the protocol as having an emergency stop.

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

**Quoter key compromised.** An attacker can sign option quotes with any premium until the role is revoked. Revoke
`QUOTER_ROLE` on `OptionsEngine` and grant it to a new key. After the handover this is an admin call and is
delayed by the timelock, so pause option trading first with `setActive(false)` on each market. Signed quotes
expire after 30 seconds, so nothing already signed stays valid for long.

**Maker key compromised (RFQ).** Same steps for `MAKER_ROLE` on `RFQManager`.

**Keeper or liquidator down.** Nothing in the protocol liquidates on its own. If no bot is running, positions stay
open past their maintenance margin. Restart the bot and check the API's price timestamp is fresh. On testnet the
keeper also refreshes the mock feeds, which go stale after 1 hour; that does not apply to real feeds.

**Indexer or API down.** The chain stays the source of truth: positions, balances and settlement are unaffected.
The web app shows stale or missing history and cannot fetch option quotes. Users can still close perps and
withdraw through any wallet.

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
RPC_URL=<mainnet rpc> MAX_POSITION=<whole tokens> MAX_OPEN_INTEREST=<whole tokens> MAX_LEVERAGE=<n> \
  ./script/check-launch-limits.sh <network>
```

It reads every active market's limits from `RiskManager` and exits with an error if any is above the values you
pass. **The numbers are a product decision and are TBD**; the script only enforces whatever you choose. Run it
again after every change to a risk parameter.

## Before launch

- [ ] Every **TBD** above is filled in.
- [ ] The pause-speed decision above is made and, if it needs a contract change, done.
- [ ] `check-launch-limits.sh` passes with the chosen limits.
- [ ] A pause and an unpause were rehearsed on the staging deployment by the people named above.
