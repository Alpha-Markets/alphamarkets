# Pre-mainnet security review (2026-09-24)

This is a self-review of `packages/contracts` against Section 36 of `PROJECT_BRIEF.md` and the
"Pre-mainnet checklist" in `DEVELOPMENT_STEPS.md`. It is **not an independent audit**. The third-party audit
the checklist requires has not been done, and nothing here replaces it.

Every result below was produced by running the check, not by reading the code and assuming. Where a check could
not be run in full, the gap is stated.

## How it was checked

| Method | What it covers | Where |
|---|---|---|
| Unit, fuzz and integration tests | Contract logic, at 10,000 fuzz runs | `packages/contracts/test/` (244 tests, all pass) |
| Invariant tests | Open interest accounting, position shape, vault solvency | `test/invariant/PerpsInvariant.t.sol` (5 pass) |
| Fork tests on the live testnet deployment | Real deployed contracts and state, on a local fork | `test/fork/TestnetFork.t.sol` (16 pass) |
| Live testnet probes | Oracle safeguards on the real chain | Transactions listed below |
| Live lifecycle run | Perp profit, liquidation, option settlement through the hosted API | `packages/sdk/scripts/testnet-lifecycle.ts` |
| Upgrade and admin-handover rehearsal | The real `UpgradeAll` and `HandOverAdmin` scripts, on a fork with a timelock | Results below |
| Static analysis | Slither 0.11 on `src/` | Triage below |

Run the fork tests with `ROBINHOOD_TESTNET_RPC_URL` set: `forge test --match-path 'test/fork/*'`. They are skipped
without it, so CI does not run them.

## Section 36 safeguards

| Safeguard | Evidence | Result |
|---|---|---|
| Reentrancy protection | `nonReentrant` on vault, perps, liquidation and subaccount entry points. Slither reports only `reentrancy-events` (event ordering), no state reentrancy. | Pass |
| Access control | Fork tests: an outsider cannot pause the oracle, change a source, change the max price age, call `settlePnl`, or upgrade a contract. `script/check-admin-roles.sh` covers all 9 admin roles. | Pass |
| Pausable markets | Fork test: `MarketRegistry.setActive(false)` makes a new perp revert with `MarketPaused`. | Pass |
| Oracle freshness | Fork test and live probe: a price older than the max age reverts with `StaleOraclePrice`. | Pass |
| Oracle deviation | Fork test and live probe: two sources 20% apart, limit 5%, revert with `InvalidOraclePrice`. | Pass |
| Oracle fallback | Fork test and live probe: with the primary stale and the fallback fresh, the fallback price is returned. | Pass |
| Emergency oracle pause | Fork test and live probe: `pauseMarket` makes reads revert with `MarketOraclePaused`, `unpauseMarket` restores them. New unit tests: a `PAUSER_ROLE` key can pause but cannot unpause or change a source. | Pass |
| Precision-safe accounting | Fuzz tests on margin and option math, and 6-decimal token tests. Slither `divide-before-multiply` findings reviewed: each loses at most one unit of an 18-decimal figure. | Pass |
| Slippage checks | Fork test: a long with a limit price far below the market reverts. | Pass |
| Deadline checks | Fork test: an order with a past deadline reverts. | Pass |
| Position caps and open-interest caps | Invariant: recorded open interest always equals the summed size of open positions and stays under the cap. Fork test: a leverage tier that is not allowed reverts. | Pass |
| Withdrawal validation | Fork test: a withdrawal above the available balance reverts, and only the engine can move ledger balances. The cross-margin guard requires a buffer above the margin requirement. | Pass |
| Upgrade controls | Only `DEFAULT_ADMIN_ROLE` can upgrade. Implementations cannot be initialised directly. `check-storage-layout.py` passes for all 20 contracts. | Pass |
| Emergency controls | A separate `PAUSER_ROLE` can pause one market's oracle, stop one market, or stop every market at once (`MarketRegistry.pauseAll`); turning anything back on is admin only. Closing, liquidation and settlement keep working while paused (tests). | Pass in code, not deployed |

### Live oracle probe (Robinhood Chain testnet, 2026-09-24)

Run against the real `OracleRouter` and `PriceValidator` on an unregistered id (`PROBE`), so no market on the site
changed. The max price age was set to 30 seconds and the max deviation to 5% for that id only.

| Step | Expected | Observed |
|---|---|---|
| Fresh read | Price returned | `100e18` |
| Read after 40 s with no update | `StaleOraclePrice` | `execution reverted: StaleOraclePrice` |
| Fallback 20% from primary | `InvalidOraclePrice` | `execution reverted: InvalidOraclePrice` |
| Primary stale, fallback refreshed to 101 | Fallback price | `101e18` |
| `pauseMarket` (tx `0x3c10e85e…d4eec`) | `MarketOraclePaused` | `execution reverted: MarketOraclePaused(0x50524f4245…)` |
| `unpauseMarket` (tx `0xc2ea6091…1cbc3`) | Price returned | `101e18` |

### Live lifecycle run

`testnet-lifecycle.ts` on a dedicated market (`E2E`, now inactive), through the hosted API and pricing service:
a perp closed at a profit (+490 on 1,000 margin at 5x and +10%), a 10x perp liquidated at −9.5% (tx
`0x14817b1e…c330be2`), a call that expired in the money and paid out 19.98 after the settlement fee, and a put
that expired out of the money and paid nothing. `testnet-smoke.ts` on NVDA (perp open and close, option bought on
a signed quote) also passed.

### Upgrade and admin handover rehearsal (local fork, live chain untouched)

1. `UpgradeAll.s.sol` on a fork of the testnet: the vault implementation changed, every proxy address stayed the
   same, and stored risk configuration was identical afterwards.
2. A `TimelockController` (1 hour delay) was deployed on the fork. `HandOverAdmin.s.sol` granted it 34 roles.
   A scheduled admin call reverted when executed before the delay (`TimelockUnexpectedOperationState`) and
   succeeded after it.
3. `HandOverAdmin.s.sol` with `RENOUNCE=true` revoked the deployer: it held `DEFAULT_ADMIN_ROLE` on 0 of 20
   contracts afterwards, and both `setActive` and `upgradeToAndCall` from the deployer reverted with
   `AccessControlUnauthorizedAccount`. The timelock then upgraded the vault through its own delay.
4. The live testnet was checked afterwards: the vault implementation was unchanged and the deployer still held
   admin there.

## Static analysis (Slither, `src/` only)

31 findings at Medium or above (2 High, 29 Medium); all reviewed, none is an exploitable defect.

| Finding | Count | Verdict |
|---|---|---|
| `arbitrary-send-erc20` in `Subaccount.deposit` | 1 (High) | False positive: `onlyOwner`, and it pulls from the caller's own approved balance. |
| `uninitialized-state` for `CrossMarginManager._portfolioOptions` | 1 (High) | False positive: a mapping of arrays that is only ever pushed to. |
| `unused-return` | 21 | Intended: the price timestamp is validated inside the oracle router, and the ECDSA error code is checked. |
| `divide-before-multiply` | 5 | Benign: at most one unit of an 18-decimal value lost. |
| `uninitialized-local` | 3 | Intended zero defaults. |
| Low and informational | 79 + 7 | `calls-loop` in cross margin is bounded by `MAX_CROSS_POSITIONS` (10). Timestamp comparisons are by design. |

`aderyn` and Mythril were not run. `aderyn` is not installed, and Mythril was not attempted.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | **The vault had no solvency guard.** `settlePnl` credited a winner without moving tokens and never checked that losers cover it, so a one-sided win left the vault owing more than it held (the invariant test failed with the ledger about 23.7 tokens above the tokens held). | **Fixed in code, not deployed, not audited.** The vault now counts `totalLiabilities` and refuses a profit credit the pool cannot pay (`InsufficientPoolReserves`). A funded pool (`fundPool`) backs payouts, and `RiskManager.maxNetOpenInterest` caps the long/short imbalance the pool is counterparty to. The solvency invariant now passes over 51,200 random calls with a deliberately small pool. See "Vault solvency fix" below. |
| 2 | Medium | **Emergency pause was slow once admin sits behind a timelock, and shared a role with the oracle setters.** | **Fixed in code, not deployed, not audited.** `PAUSER_ROLE` on `MarketRegistry` and `OracleRouter` can pause and cannot unpause, change a source or change configuration; `pauseAll` is the protocol-wide stop. Pausing is fast, restoring is timelocked, on purpose. `HandOverAdmin` moves the pauser role with the admin roles, so the deployer keeps no pause power; the timelock then grants it to a fast key. 12 tests in `Pauser.t.sol` and a handover test. |
| 3 | Medium | **A compromised quoter key could set any premium.** | **Reduced in code, not deployed, not audited.** `OptionsEngine` now rejects, at open, a premium of zero, below the option's intrinsic value at the current price (less 2%), or above the value of the underlying, and rejects a close premium above that value. This bounds what a stolen key can sign; it does not remove the risk, because a key can still sign premiums inside the bounds. The key still belongs behind a multisig or HSM, and rotating it after the handover still waits for the timelock (pause first, see the runbook). 10 tests in `PremiumBounds.t.sol`. |
| 4 | Medium | **`OptionsEngine.settleExpired` looped over every position in a series.** | **Fixed in code, not deployed, not audited.** It now settles at most 50 positions per call and remembers its place (`settleCursor`), `settleExpiredBatch` lets the caller choose the size, and `settlePosition(positionId)` lets any holder settle their own position at once, so no series can block settlement. One 50-position batch measured 3.4 million gas. 9 tests in `BatchSettlement.t.sol`. |
| 5 | Low | Funding is inert: mark and index price are the same, so the rate is always 0. Documented as a known limit. | Open, known |
| 6 | Low | **Pricing service told a position's real owner "position belongs to a different address"** for a few seconds after purchase, because the RPC node it reads had not seen the position yet. Found by the live smoke test (2 of 2 runs failed at "sell back"). | **Fixed** in this change: the service retries, and answers `404 not found yet` instead of a false `403`. |
| 7 | Info | The testnet feeds are test contracts and the settlement token has a public `mint`. | Open until real feeds and a real token exist |

## Vault solvency fix (finding 1)

What changed in `packages/contracts`:

- `AlphaMarketsVault` keeps `totalLiabilities[token]`, the sum of every ledger balance, updated on every
  deposit, withdrawal, fee and PnL change. `poolBalance(token)` is the tokens held beyond that.
- `settlePnl` with a positive amount (a payout) reverts with `InsufficientPoolReserves(needed, available)` when
  it would leave the vault owing more than it holds. A loss realized by a trader adds to the pool. A fee leaves
  both sides equally.
- `fundPool(token, amount)` adds capital to the pool, credited to no account. Anyone can call it. There is
  deliberately no admin function to take pool funds out: they leave only as payouts to traders. A recovery path
  for seed capital would need its own design and audit.
- `RiskManager.maxNetOpenInterest(marketId)` (admin-set, 0 = no limit) bounds the difference between long and
  short open interest, which is what the pool is counterparty to. An order on the smaller side is never refused
  for adding imbalance.
- `bootstrapLiabilities(token)` exists only for a vault upgraded from the old code: its counter starts at 0 while
  users hold balances, so every withdrawal would underflow. It sets the counter to every token the vault holds,
  which counts the pool as empty (the safe side). It works once per token. A fresh deployment never needs it.
- Both new state variables are appended, so `check-storage-layout.py` still passes for all 20 contracts.

How it was checked:

| Check | Result |
|---|---|
| 244 existing tests, with the test base seeded with a pool | All pass |
| `VaultSolvency.t.sol` (10 tests) | A profit within the pool is paid; a profit beyond it reverts with the exact figures and leaves the position open; a losing side refills the pool so the winner can then be paid; the counter equals the ledger; `fundPool` credits no account; `bootstrapLiabilities` fixes an upgraded vault and works only once |
| `NetOpenInterest.t.sol` (6 tests, one fuzz at 1,024 runs) | The gap never exceeds the limit; the smaller side is always allowed; 0 means no limit; only the risk admin can set it |
| Invariants, 256 runs, depth 200, small pool (51,200 calls) | Vault tokens cover the ledger, the counter matches the ledger, open interest matches open positions and stays under the cap: all pass |
| SDK integration test on a local Anvil deployment | 10 of 10 pass. It first failed, correctly, when an option was sold back for more than it cost with no pool; it now seeds one |
| Upgrade rehearsal on a fork of the live testnet | After `UpgradeAll` the counter is 0 and a withdrawal reverts; `bootstrapLiabilities` sets it to the tokens held; the withdrawal then succeeds; a second bootstrap reverts with `AlreadyTracked` |
| Launch gate on that fork (`check-launch-limits.sh`) | With net limits of 50,000 on 20 markets and a 100,000 pool it fails ("pool 100,000 is below 500,000"); after funding 600,000 it passes |

Trade-off to know: when the pool cannot pay a winner, the winner's close reverts and the position stays open
until losing positions settle or the pool is funded. That is the intended safe behavior, and it must be stated
to users. The net open-interest limit and the pool size decide how often it can happen.

Still open for this finding: it is not deployed anywhere, the launch reserve size and the net limits are product
decisions, and the change needs the independent audit like everything else.

## Pause, premium and settlement fixes (findings 2 to 4)

| Check | Result |
|---|---|
| Existing 244 tests plus the vault and net-limit tests | All pass unchanged with the new bounds |
| `Pauser.t.sol` (12) | A pauser pauses an oracle or a market but cannot unpause, change a source, or change or add a market; only a pauser can `pauseAll`; a paused market still lets users close and be liquidated; the admin holds the role from deploy |
| `AdminHandover.t.sol` | The handover moves the pauser role to the timelock and leaves the deployer none |
| `PremiumBounds.t.sol` (10, one fuzz at 1,024 runs) | Free, below-intrinsic and above-underlying premiums are refused for both calls and puts; within-tolerance drift is accepted; a stale oracle blocks opening; the fuzz accepts exactly the premiums inside the bounds |
| `BatchSettlement.t.sol` (9) | 120 positions settle over three calls; a holder settles their own position first and is not paid twice; batching pays the same as one call; a finished series does nothing on a repeat call; open interest is released |
| Storage layout | `OptionsEngine.settleCursor` is appended; all 20 contracts keep their layout |
| SDK and web | `options.settlePosition`, the new error classes and the web Settle button typecheck; the button now settles the holder's own position |

The price bounds make opening an option depend on a fresh oracle price, which it did not before.

## Still not done

- Independent audit.
- Fork tests against **mainnet**: they need the mainnet RPC URL and real feed addresses.
- Invariant tests for options and liquidation (only perps are covered).
- Staging soak of 1 to 2 weeks.
- Multisig and timelock chosen and deployed.
