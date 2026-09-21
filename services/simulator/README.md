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

**Start it two to three hours before you record.** Candles and the price history come from indexed price ticks, and the chain has no backfill, so a chart that has only just started looks empty.

## Get a liquidation on camera

The market is calm, so a liquidation needs a push. The two degens hold 10x positions, which the market's 5% maintenance margin liquidates after roughly a 5% move against them. With the simulator running, from another terminal:

```bash
pnpm --filter @alphamarkets/simulator nudge NVDA -6      # down 6%: the long degen is liquidated
pnpm --filter @alphamarkets/simulator nudge AAPL 6       # up 6%: the short degen is liquidated
```

The move plays out over several price steps (a nudge never moves more than 1% a step), so allow one to two minutes. The liquidator then liquidates the position and the degen opens a new one a moment later. The price then drifts back toward its starting level over roughly an hour; nudge the other way to bring it back sooner.

A nudge is written to `.simulator/nudges.jsonl` and read by the running process, because the price driver owns the feed owner's transaction nonce.

To also liquidate positions of your own wallet (a position you open by hand while recording), set `SIM_LIQUIDATE_WALLETS` to a comma-separated list of addresses before `start`.

## Other commands

```bash
pnpm --filter @alphamarkets/simulator status   # each wallet's gas, vault balance and open positions, and the current prices
```

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `SIM_MARKETS` | `NVDA,TSLA,AAPL,META,HOOD` | Markets to move and trade |
| `SIM_TICK_MS` | `15000` | Time between price steps |
| `SIM_VOLATILITY` | `1` | Multiplies the size of the random moves (2 gives livelier charts) |
| `SIM_LIQUIDATE_WALLETS` | none | Extra wallets the liquidator watches |
| `SIM_SEED_NUMBER` | random | Fixes the random choices, for a repeatable run |
| `SIM_PRICE_KEY` | `KEEPER_PRIVATE_KEY` | Key that owns the mock feeds |
| `SIM_FUNDER_PRIVATE_KEY` | `PRIVATE_KEY` | Wallet that pays for the bots' gas |

## Things to know

- **The hosted keeper.** The keeper (on Railway) shares the price driver's key. It only sends a transaction when a feed is about to go stale or an order can fill, and the driver keeps the feeds fresh, so the two rarely meet. If a transaction fails for a nonce clash, the driver logs it and pushes the price again next step.
- **When the simulator stops,** the prices stop moving. The keeper keeps them fresh, so the market stays usable; it just goes flat.
- **Funding is inert.** The mark price equals the index price on testnet, so funding rates are always 0. Do not feature funding in the video.
- **Gas is tiny** (a trade costs about 0.00001 ETH at the testnet's gas price), but each bot wallet needs some. `status` shows the balances.
- **Position size limits** come from each market's risk settings, and a bot keeps well under them.
