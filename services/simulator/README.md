# @alphamarkets/simulator

Makes the testnet look like a live market for a recorded demo. It runs three things from one process:

- **A price driver.** The testnet prices come from mock feeds, and nothing moves them. The driver moves the five markets like a calm market (small random steps, a pull back to the starting price, and a shared move across the tech stocks) by calling `setPrice` on each feed.
- **Ten bot traders**, each a wallet with its own personality, trading through the same SDK the web app uses: two whales (big, slow, low leverage), three scalpers (small, fast), two trend followers, one contrarian, and two 10x "degens" (one long, one short) that never take a stop.
- **A liquidator bot.** `LiquidationEngine.liquidate` is open to anyone and pays the caller 5% of the position's margin. The keeper does not call it, so without this bot nothing on testnet is ever liquidated.

Everything is on chain. The indexer, API and web app see the bots' trades exactly as they see anyone's, so the Activity, Markets, Portfolio and chart pages fill up for real. Nothing is written to the database by hand.

**Say so in the video.** This is a testnet with mock prices and simulated traders. Present the activity as simulated, in the video or its description. Presenting it as real users or real volume would mislead viewers.

## Set up (once)

1. The price driver signs with the feed owner's key. Have `KEEPER_PRIVATE_KEY` in the root `.env` (the keeper wallet owns the mock feeds). To use another key, set `SIM_PRICE_KEY`.
2. The wallet that pays for the bots' gas is the deployer: `PRIVATE_KEY` in `packages/contracts/.env`. To use another wallet, set `SIM_FUNDER_PRIVATE_KEY`.
3. Send gas and collateral to the bots:

   ```bash
   pnpm --filter @alphamarkets/simulator bootstrap 4
   ```

   The number is the hours of running to pay for (default 4). It prints what each wallet needs and stops with a clear message if the funder has too little ETH; get more from the testnet faucet, or pass fewer hours. It is safe to repeat: it only tops up what is short. It also mints test collateral (the testnet token has a public `mint`) and deposits it in each bot's vault balance.

The bot wallets come from a random seed the first run saves in `.simulator/seed.txt` (gitignored). Keep that file if you want the same wallets next time.

## Run

```bash
pnpm --filter @alphamarkets/simulator start
```

Stop it with Ctrl+C. It logs every trade, every price step and every liquidation. Bots keep their positions open while it is stopped; they pick up again on the next start.

**A chart needs history.** Candles come from the price ticks the indexer records once a minute, and the chain has no backfill, so a chart of a market that has only just started looks empty. Two ways to fill it:

- **Wait.** Start the simulator 15 to 20 minutes before you record, or longer for a fuller chart.
- **Draw the history** with `backfill`, below, to have candles at once.

## Get a liquidation on camera

The market is calm, so a liquidation needs a push. The two degens hold 10x positions, which the market's 5% maintenance margin liquidates after roughly a 5% move against them. With the simulator running, from another terminal:

```bash
pnpm --filter @alphamarkets/simulator nudge NVDA -6      # down 6%: the long degen is liquidated
pnpm --filter @alphamarkets/simulator nudge AAPL 6       # up 6%: the short degen is liquidated
```

The move takes 90 seconds by default. Give the seconds as a third number to change it (`nudge NVDA -6 30`); a nudge never moves more than 1% a step, so a big one may take longer than asked. The liquidator then liquidates the position and the degen opens a new one a moment later. The price then drifts back toward its starting level over roughly an hour; nudge the other way to bring it back sooner.

A nudge is written to `.simulator/nudges.jsonl` and read by the running process, because the price driver owns the feed owner's transaction nonce.

To also liquidate positions of your own wallet (a position you open by hand while recording), set `SIM_LIQUIDATE_WALLETS` to a comma-separated list of addresses before `start`.

## Have candles at once (`backfill`)

```bash
pnpm --filter @alphamarkets/simulator backfill 72 replace   # redraw the last 72 hours, up to now
pnpm --filter @alphamarkets/simulator backfill 72           # draw 72 hours before the first recorded price
pnpm --filter @alphamarkets/simulator backfill undo         # take it out again
```

`backfill` draws simulated prices (one a minute per market, in moods that change every hour or two) and writes them to the indexer's `price_ticks` table. That table is a display cache for charts and the 24 hour change: it never feeds settlement or liquidation, which read the oracle on chain. It takes 1 to 168 hours (the indexer keeps 8 days of ticks by default, `PRICE_TICK_RETENTION_DAYS`). Volume on those candles is 0, because no trades happened.

- **Plain `backfill`** draws the hours before the first price the indexer recorded, and the drawn prices end at that price, so they join it without a jump. Use it for a market that has just been listed.
- **`backfill 72 replace`** redraws the whole window up to now, ending at each market's latest price, and deletes what the indexer recorded in that window. Use it when the recorded prices are a flat line (nothing moved the mock price), so the last hours have candles with bodies and wicks. `undo` removes the drawn rows but does not bring back the recorded ones it replaced.
- **It costs no gas and no RPC calls.** It only writes to the database (about 4,300 rows a market for 72 hours). Only `start` sends transactions.
- **Which candles look right.** The indexer records one price a minute, so 1m candles are flat lines. Use 15m, 1h or 1d in the terminal. 72 hours gives 72 candles on 1h and 3 on 1d; use 168 for a fuller 1d chart.

**These candles are simulated, not recorded. Say so wherever you show them.**

It needs a database connection: set `SIM_DATABASE_URL` to the public database URL, or the standard `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` variables, and have `psql` installed. Run it once, then start the simulator: the live prices continue from where the drawn history ends.

## A price line every second

```bash
SIM_TICK_MS=1000 SIM_VOLATILITY=3 pnpm --filter @alphamarkets/simulator start
```

The market moves the same amount per minute whatever the step, so a one second step gives smoother, finer moves, not wilder ones. Use `SIM_VOLATILITY` for that. What a fast step costs:

- **Gas.** Each changed price is a transaction, up to five a second. That is roughly 0.005 ETH for 20 minutes at the testnet's gas price, so use it for the recording and not overnight. `bootstrap` sizes the price wallet's gas from `SIM_TICK_MS`: run it with the same setting (`SIM_TICK_MS=1000 pnpm --filter @alphamarkets/simulator bootstrap 1`).
- **RPC load.** Sending a transaction costs an RPC provider far more than a read, and five a second is more than a free plan allows. Below 5000 ms the simulator warns at start. On a free key use 5000 or more; for one second, use a paid key in `SIM_RPC_URL`.
- **What the chart shows.** The indexer still records one price a minute, so candles are the same as at a 15 second step. The one second moves show in the live price, not in the candles.
- Prices that did not change by a cent are not sent, so the real number of transactions is lower.

## Other commands

```bash
pnpm --filter @alphamarkets/simulator status   # each wallet's gas, vault balance and open positions, and the current prices
```

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `SIM_MARKETS` | all 20 testnet markets (`NVDA,TSLA,...,SHOP`) | Markets to move and trade |
| `SIM_RPC_URL` | `RPC_URL` | RPC endpoint for the simulator only. Give it its own key, so it does not use up the rate limit the hosted services share |
| `SIM_TICK_MS` | `15000` | Time between price steps, at least 500. `1000` gives a price line every second (see below) |
| `SIM_VOLATILITY` | `1` | Multiplies the size of the random moves (2 to 3 gives livelier charts) |
| `SIM_DATABASE_URL` | none | Database URL for `backfill` (or use the `PG*` variables) |
| `SIM_LIQUIDATE_WALLETS` | none | Extra wallets the liquidator watches |
| `SIM_SEED_NUMBER` | random | Fixes the random choices, for a repeatable run |
| `SIM_PRICE_KEY` | `KEEPER_PRIVATE_KEY` | Key that owns the mock feeds |
| `SIM_FUNDER_PRIVATE_KEY` | `PRIVATE_KEY` | Wallet that pays for the bots' gas |
| `SIM_RPC_PER_SECOND` | `15` | RPC reads a second the simulator may start (a transaction counts as 5); `0` for no limit |

## `HTTP request failed`

The RPC provider is refusing calls, almost always with HTTP 429: too many requests for the plan (a free Alchemy key allows only a few hundred compute units a second, and a transaction costs the most). Symptoms: many `could not trade`, `could not push` and `could not read` lines at once. It is not a bug in the contracts or the chain.

What uses the budget, and what to do:

- **A short price step.** Every changed price is a transaction. Use the default `SIM_TICK_MS=15000`, or at least 5000.
- **Other users of the same key.** The hosted indexer, API, pricing service and keeper use the same `RPC_URL`, and so does a second simulator or the test scripts. Set `SIM_RPC_URL` to a key of its own. Run one simulator only: two on the same wallets collide.
- **A VPN or a slow connection** can add timeouts. Try without the VPN for the run itself.
- The simulator already tries a rate-limited call again up to six times with a growing delay, and the liquidator checks only the positions the bots know about (one read each) instead of reading every wallet's portfolio each round.
- **Bursts.** The simulator spaces its RPC calls out to 15 reads a second, and a transaction counts as five reads, so five price transactions at once no longer hit the plan's per-second limit together. Change the rate with `SIM_RPC_PER_SECOND` (`0` turns it off, for a paid key). A price step of one second needs a higher rate or none, or the steps queue up.
- **Bots read only open positions.** A bot used to read every position its wallet ever had, closed ones too, so its calls grew with each trade. It now reads a closed position once and never again.

To see it yourself, ask the RPC directly (do not paste the URL anywhere public):

```bash
curl -s -w "\nhttp %{http_code}\n" -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' "$RPC_URL"
```

`http 429` means throttled; `http 200` with a block number means the endpoint is fine at that moment.

## Things to know

- **The hosted keeper.** The keeper (on Railway) shares the price driver's key. It only sends a transaction when a feed is about to go stale or an order can fill, and the driver keeps the feeds fresh, so the two rarely meet. If a transaction fails for a nonce clash, the driver logs it and pushes the price again next step.
- **When the simulator stops,** the prices stop moving. The keeper keeps them fresh, so the market stays usable; it just goes flat.
- **Funding is inert.** The mark price equals the index price on testnet, so funding rates are always 0. Do not feature funding in the video.
- **Gas is tiny** (a trade costs about 0.00001 ETH at the testnet's gas price), but each bot wallet needs some. `status` shows the balances.
- **Position size limits** come from each market's risk settings, and a bot keeps well under them.
