import { loadDotEnv } from "@alphamarkets/config";
loadDotEnv();
// The deployer key (the funder) lives with the contract scripts, not in the root .env.
loadDotEnv("../../packages/contracts/.env");

import { fileURLToPath } from "node:url";
import { chains, requireEnv, resolveAddresses, resolveChainId } from "@alphamarkets/config";
import { AlphaMarkets } from "@alphamarkets/sdk";
import { createPublicClient, createWalletClient, formatEther, http, isAddress, parseEther, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createBot, type Bot } from "./bot.js";
import { appendNudge } from "./control.js";
import { createPriceDriver } from "./driver.js";
import { describe, dollars, stamp, symbolOf, usd } from "./format.js";
import { ensureCollateral } from "./funds.js";
import { createLiquidator } from "./liquidator.js";
import { LIQUIDATOR, ROSTER, type MarketView } from "./personas.js";
import { createRng } from "./prng.js";
import { deriveAccount, loadSeed } from "./wallets.js";

const STATE_DIR = fileURLToPath(new URL("../../../.simulator", import.meta.url));
const SYMBOLS = (process.env.SIM_MARKETS ?? "NVDA,TSLA,AAPL,META,HOOD").split(",").map((s) => s.trim().toUpperCase());
const TICK_MS = Number(process.env.SIM_TICK_MS ?? 15_000);
/// Window of the "recent move" that trend and reverter bots react to.
const HISTORY_TICKS = 20;
const VOLATILITY = Number(process.env.SIM_VOLATILITY ?? 1);

const chainId = resolveChainId(process.env.CHAIN_ID);
const chain = chains[chainId];
const transport = http(requireEnv("RPC_URL"));
const addresses = resolveAddresses(chainId);
const publicClient = createPublicClient({ chain, transport }) as PublicClient;
const log = (message: string) => console.log(`${stamp()} ${message}`);

const walletFor = (account: PrivateKeyAccount) => createWalletClient({ account, chain, transport });
const sdkFor = (account: PrivateKeyAccount) => new AlphaMarkets({ chainId, transport, account, addresses });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function accounts() {
  const seed = loadSeed(STATE_DIR);
  return {
    traders: ROSTER.map((persona, index) => ({ persona, account: deriveAccount(seed, index) })),
    liquidator: deriveAccount(seed, LIQUIDATOR.index),
  };
}

function priceOwner(): PrivateKeyAccount {
  return privateKeyToAccount(requireEnv(process.env.SIM_PRICE_KEY ? "SIM_PRICE_KEY" : "KEEPER_PRIVATE_KEY") as Hex);
}

async function settlementToken() {
  const token = addresses.settlementToken as Address;
  const decimals = await sdkFor(priceOwner()).erc20.decimals(token);
  return { token, decimals };
}

/// Sends gas to every wallet and puts collateral in every trader's vault balance. Safe to repeat: it
/// only tops up what is short.
async function bootstrap(hours: number) {
  const funderKey = process.env.SIM_FUNDER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!funderKey) throw new Error("Set SIM_FUNDER_PRIVATE_KEY (or PRIVATE_KEY): the wallet that pays for the bots' gas.");
  const funder = privateKeyToAccount(funderKey as Hex);
  const { traders, liquidator } = accounts();
  const owner = priceOwner();

  const gasPrice = await publicClient.getGasPrice();
  const perTrade = gasPrice * 600_000n;
  const perPush = gasPrice * 80_000n;
  const gasFor = (txPerHour: number, cost: bigint) => (BigInt(Math.ceil(txPerHour * hours)) * cost * 3n) / 2n;
  const floor = parseEther("0.0003");
  const pushesPerHour = SYMBOLS.length * (3_600_000 / TICK_MS);

  const plan = [
    ...traders.map(({ persona, account }) => ({ name: persona.id, address: account.address, target: gasFor(persona.txPerHour, perTrade) })),
    { name: LIQUIDATOR.id, address: liquidator.address, target: gasFor(LIQUIDATOR.txPerHour, perTrade) },
    { name: "price driver (keeper wallet)", address: owner.address, target: gasFor(pushesPerHour, perPush) },
  ].map((row) => ({ ...row, target: row.target < floor ? floor : row.target }));

  const rows = await Promise.all(plan.map(async (row) => ({ ...row, balance: await publicClient.getBalance({ address: row.address }) })));
  const missing = rows.map((row) => ({ ...row, top: row.target > row.balance ? row.target - row.balance : 0n }));
  const total = missing.reduce((sum, row) => sum + row.top, 0n);
  const reserve = parseEther("0.001");
  const funderBalance = await publicClient.getBalance({ address: funder.address });

  console.log(`Plan for ${hours} hours of running (gas price ${formatEther(gasPrice * 1_000_000_000n)} ETH per billion gas):`);
  for (const row of missing) console.log(`  ${row.name.padEnd(30)} ${row.address}  has ${formatEther(row.balance)}  needs +${formatEther(row.top)} ETH`);
  console.log(`Total to send: ${formatEther(total)} ETH. The funder ${funder.address} has ${formatEther(funderBalance)} ETH.`);
  if (funderBalance < total + reserve) {
    console.error(`Not enough ETH: send at least ${formatEther(total + reserve - funderBalance)} more to ${funder.address}, or run with fewer hours (bootstrap 2).`);
    process.exit(1);
  }

  const funderClient = walletFor(funder);
  for (const row of missing) {
    if (row.top === 0n) continue;
    const hash = await funderClient.sendTransaction({ to: row.address, value: row.top });
    await publicClient.waitForTransactionReceipt({ hash });
    log(`sent ${formatEther(row.top)} ETH to ${row.name}`);
  }

  const { token, decimals } = await settlementToken();
  await Promise.all(
    traders.map(async ({ persona, account }) => {
      const added = await ensureCollateral({ alphaMarkets: sdkFor(account), publicClient, walletClient: walletFor(account), token, decimals, targetUsd: persona.depositUsd, belowUsd: persona.depositUsd * 0.9 });
      if (added > 0) log(`${persona.id}: deposited ${usd(added)} of test collateral`);
    }),
  );
  console.log("Bootstrap done. Start the simulation with: pnpm --filter @alphamarkets/simulator start");
}

async function start() {
  const { traders, liquidator: liquidatorAccount } = accounts();
  const owner = priceOwner();
  const rng = createRng(Number(process.env.SIM_SEED_NUMBER ?? Date.now() % 2 ** 32));
  const { token, decimals } = await settlementToken();

  const reader = sdkFor(owner);
  const registry = await reader.markets.list();
  const marketIds = SYMBOLS.flatMap((symbol) => {
    const market = registry.find((m) => m.active && m.perpsEnabled && symbolOf(m.marketId) === symbol);
    return market ? [{ symbol, marketId: market.marketId }] : [];
  });
  if (marketIds.length === 0) throw new Error(`None of ${SYMBOLS.join(", ")} is an active perps market.`);

  const risk = new Map<string, { maxLeverage: number; maxNotional: number }>();
  for (const { symbol } of marketIds) {
    const info = await reader.perps.get(symbol);
    risk.set(symbol, { maxLeverage: Number(info.risk.maxLeverage), maxNotional: dollars(info.risk.maxPositionNotional, decimals) });
  }

  const driver = await createPriceDriver({ publicClient, walletClient: walletFor(owner), router: addresses.oracleRouter, marketIds, stateDir: STATE_DIR, rng, volatility: VOLATILITY, log });

  const history = new Map<string, number[]>();
  const record = () => {
    for (const m of driver.markets()) {
      const list = history.get(m.symbol) ?? [];
      list.push(m.price);
      if (list.length > HISTORY_TICKS) list.shift();
      history.set(m.symbol, list);
    }
  };
  record();
  const marketViews = (): MarketView[] =>
    driver.markets().map((m) => {
      const list = history.get(m.symbol) ?? [m.price];
      const first = list[0] ?? m.price;
      const limits = risk.get(m.symbol)!;
      return { symbol: m.symbol, price: m.price, returnPct: first === 0 ? 0 : ((m.price - first) / first) * 100, ...limits };
    });

  const bots: Bot[] = traders.map(({ persona, account }) =>
    createBot({ persona, alphaMarkets: sdkFor(account), publicClient, walletClient: walletFor(account), token, decimals, rng, markets: marketViews, log }),
  );
  const extra = (process.env.SIM_LIQUIDATE_WALLETS ?? "").split(",").map((s) => s.trim()).filter((s): s is Address => isAddress(s));
  const liquidator = createLiquidator({
    alphaMarkets: sdkFor(liquidatorAccount),
    publicClient,
    walletClient: walletFor(liquidatorAccount),
    engine: addresses.liquidationEngine,
    watch: () => [...bots.map((b) => b.address), ...extra],
    log,
  });

  let running = true;
  const stop = () => {
    if (running) log("stopping…");
    running = false;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  /// One loop per component, so a slow transaction in one never holds up another.
  const every = async (ms: number, startDelay: number, job: (now: number) => Promise<unknown>) => {
    await sleep(startDelay);
    while (running) {
      const began = Date.now();
      try {
        await job(began);
      } catch (error) {
        log(`error: ${describe(error)}`);
      }
      await sleep(Math.max(1_000, ms - (Date.now() - began)));
    }
  };

  log(`simulator: ${marketIds.map((m) => m.symbol).join(", ")}; ${bots.length} traders, 1 liquidator; prices every ${TICK_MS / 1000}s. Ctrl+C to stop.`);
  await Promise.all([
    every(TICK_MS, 0, async () => {
      await driver.tick();
      record();
    }),
    every(10_000, 3_000, () => liquidator.tick()),
    ...bots.map((bot, index) => every(3_000, 5_000 + index * 1_500, (now) => bot.tick(now))),
  ]);
}

async function status() {
  const { traders, liquidator } = accounts();
  const owner = priceOwner();
  const { token, decimals } = await settlementToken();
  const reader = sdkFor(owner);
  console.log("wallet".padEnd(14), "address".padEnd(44), "ETH".padEnd(12), "vault".padEnd(12), "open");
  for (const { name, account } of [...traders.map((t) => ({ name: t.persona.id, account: t.account })), { name: "liquidator", account: liquidator }]) {
    const [eth, vault, positions] = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      reader.vault.availableBalance(account.address, token),
      reader.portfolio.positions(account.address),
    ]);
    console.log(name.padEnd(14), account.address.padEnd(44), Number(formatEther(eth)).toFixed(5).padEnd(12), usd(dollars(vault, decimals)).padEnd(12), positions.perps.filter((p) => p.open).length);
  }
  console.log(`price driver ${owner.address} has ${formatEther(await publicClient.getBalance({ address: owner.address }))} ETH`);
  for (const symbol of SYMBOLS) {
    const price = await reader.oracle.getMarkPrice(symbol).catch(() => undefined);
    if (price) console.log(`  ${symbol} ${(Number(price.price / 10n ** 14n) / 10_000).toFixed(2)}`);
  }
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "bootstrap") await bootstrap(Number(args[0] ?? 4));
  else if (command === "start") await start();
  else if (command === "status") await status();
  else if (command === "nudge") {
    const [symbol, pct, steps] = args;
    if (!symbol || pct === undefined || !Number.isFinite(Number(pct))) throw new Error("Usage: nudge <SYMBOL> <percent> [steps], e.g. nudge NVDA -6");
    appendNudge(STATE_DIR, { symbol: symbol.toUpperCase(), pct: Number(pct), steps: Number(steps ?? 6) });
    console.log(`Asked the running simulator to move ${symbol.toUpperCase()} by ${pct}%. It plays out over the next ticks.`);
  } else {
    console.log("Commands: bootstrap [hours] | start | status | nudge <SYMBOL> <percent> [steps]");
    process.exit(command ? 1 : 0);
  }
} catch (error) {
  console.error(describe(error));
  process.exit(1);
}
