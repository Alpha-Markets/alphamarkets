/// End-to-end SDK check against a real chain: deploys the Foundry contracts to a local Anvil node
/// and runs deposit -> open perp -> close through the SDK (DEVELOPMENT_STEPS.md Phase 3).
/// Skipped automatically when `anvil`/`forge` are not installed or `packages/contracts` has not
/// been built (`forge build`), so it never blocks a machine without the Foundry toolchain.
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { createWalletClient, http, parseAbi, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ContractAddresses } from "@alphamarkets/config";
import { AlphaMarkets } from "./client.js";
import {
  InvalidQuoteError,
  InvalidTriggerPriceError,
  LimitPriceNotReachedError,
  AlphaMarketsContractError,
  PositionLimitExceededError,
  QuoteAlreadyUsedError,
  TriggerPriceNotReachedError,
  UserRejectedError,
} from "./errors.js";
import { oracleRouterAbi } from "./abis.js";
import { closeQuoteTypedData, openQuoteTypedData } from "./quotes.js";
import { rfqQuoteTypedData } from "./rfq.js";
import { OptionPositionStatus, OptionType } from "@alphamarkets/types";
import { resolveMarketId } from "./utils.js";
import type { TxEvent } from "./transactions.js";

const contractsDir = resolve(import.meta.dirname, "../../contracts");
const NETWORK = "sdk_integration";
// Anvil's well-known first dev account — public test key, never used outside a local node.
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

function has(command: string): boolean {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const skipReason =
  process.env.SKIP_ANVIL_TESTS
    ? "SKIP_ANVIL_TESTS set"
    : !has("anvil") || !has("forge")
      ? "anvil/forge not installed"
      : !existsSync(resolve(contractsDir, "out/PerpsEngine.sol"))
        ? "packages/contracts not built (run `forge build`)"
        : undefined;

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolvePort(port));
    });
    server.on("error", reject);
  });
}

describe("SDK against a local Anvil deployment", { skip: skipReason, timeout: 180_000 }, () => {
  let anvil: ChildProcess;
  let alphaMarkets: AlphaMarkets;
  let addresses: ContractAddresses;
  let rpcUrl: string;
  const account = privateKeyToAccount(ANVIL_KEY);

  before(async () => {
    const port = await freePort();
    rpcUrl = `http://127.0.0.1:${port}`;
    // Chain id must match the SDK's supported chain (Robinhood testnet, 46630).
    anvil = spawn("anvil", ["--port", String(port), "--chain-id", "46630", "--silent"], { stdio: "ignore" });

    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const forgeEnv = { ...process.env, PRIVATE_KEY: ANVIL_KEY, NETWORK_NAME: NETWORK };
    const collateralOutput = execFileSync(
      "forge",
      [
        "create", "test/mocks/MockERC20.sol:MockERC20",
        "--rpc-url", rpcUrl, "--private-key", ANVIL_KEY, "--broadcast",
        "--constructor-args", "Test USD", "tUSD", "6",
      ],
      { cwd: contractsDir, env: forgeEnv, encoding: "utf8" },
    );
    const collateral = /Deployed to: (0x[0-9a-fA-F]{40})/.exec(collateralOutput)?.[1];
    assert.ok(collateral, `could not parse collateral address from forge output:\n${collateralOutput}`);

    for (const script of ["DeployAll", "ConfigureMarkets"]) {
      execFileSync("forge", ["script", `script/${script}.s.sol`, "--rpc-url", rpcUrl, "--broadcast"], {
        cwd: contractsDir,
        env: { ...forgeEnv, COLLATERAL_TOKEN: collateral },
        stdio: "ignore",
      });
    }

    addresses = JSON.parse(readFileSync(resolve(contractsDir, `deployments/${NETWORK}.json`), "utf8"));

    // Fund the test account with settlement collateral.
    const deployer = createWalletClient({ account, transport: http(rpcUrl) }).extend(publicActions);
    const mint = await deployer.writeContract({
      address: collateral as `0x${string}`,
      abi: parseAbi(["function mint(address to, uint256 amount)"]),
      chain: null,
      functionName: "mint",
      args: [account.address, 100_000n * 10n ** 6n],
    });
    await deployer.waitForTransactionReceipt({ hash: mint });

    alphaMarkets = new AlphaMarkets({ chainId: 46_630, transport: http(rpcUrl), account, addresses });
  });

  after(() => {
    anvil?.kill();
    rmSync(resolve(contractsDir, `deployments/${NETWORK}.json`), { force: true });
    rmSync(resolve(contractsDir, `deployments/${NETWORK}.implementations.json`), { force: true });
  });

  test("reads markets and prices from the deployed registry and oracle", async () => {
    const markets = await alphaMarkets.markets.list();
    assert.equal(markets.length, 1);
    assert.equal((await alphaMarkets.perps.list()).length, 1);

    const prices = await alphaMarkets.prices.get("NVDA-PERP");
    assert.equal(prices.index.price, 190n * 10n ** 18n);
  });

  test("approve -> deposit -> open -> close, with lifecycle events and typed errors", async () => {
    const token = addresses.settlementToken;
    await alphaMarkets.erc20.approve(token, addresses.vault, "10000", { wait: true });
    await alphaMarkets.vault.deposit(token, "5000", { wait: true });
    assert.equal((await alphaMarkets.vault.balances(account.address, token)).available, 5_000_000_000n);

    const preview = await alphaMarkets.perps.previewOpen({
      market: "NVDA-PERP",
      side: "LONG",
      collateral: "1000",
      leverage: 5,
      user: account.address,
    });
    assert.equal(preview.sufficientCollateral, true);
    assert.deepEqual(preview.violations, []);
    assert.equal(preview.notional, 5_000_000_000n);

    const events: TxEvent["status"][] = [];
    const { hash } = await alphaMarkets.perps.openPosition({
      market: "NVDA-PERP",
      side: "LONG",
      collateral: "1000",
      leverage: 5,
      tx: { wait: true, onStatus: (event) => events.push(event.status) },
    });
    assert.deepEqual(events, ["preparing", "awaiting_wallet", "submitted", "confirming", "confirmed"]);
    assert.match(hash, /^0x[0-9a-f]{64}$/);

    const { perps, options } = await alphaMarkets.portfolio.positions(account.address);
    assert.equal(options.length, 0);
    assert.equal(perps.length, 1);
    const position = perps[0]!;
    assert.equal(position.open, true);
    assert.equal(position.isLong, true);
    assert.equal(position.collateral, 1_000_000_000n);
    assert.equal(position.entryPrice, preview.entryPrice);

    // The previewed liquidation price is the same number MarginEngine's library produces.
    assert.ok(preview.liquidationPrice < position.entryPrice);

    const afterOpen = await alphaMarkets.vault.balances(account.address, token);
    assert.equal(afterOpen.lockedMargin, 1_000_000_000n);
    assert.equal(afterOpen.available, 5_000_000_000n - 1_000_000_000n - preview.fee);

    const summary = await alphaMarkets.portfolio.summary(account.address);
    assert.equal(summary.unrealizedPerpPnl, 0n);

    await alphaMarkets.perps.closePosition(position.positionId, { tx: { wait: true } });
    const closed = await alphaMarkets.portfolio.getPerpPosition(position.positionId);
    assert.equal(closed.open, false);
    assert.equal((await alphaMarkets.vault.balances(account.address, token)).lockedMargin, 0n);

    await alphaMarkets.vault.withdraw(token, "1000", { wait: true });
  });

  test("a revert surfaces as a typed error and is reported via onStatus", async () => {
    const events: TxEvent[] = [];
    await assert.rejects(
      alphaMarkets.perps.openPosition({
        market: "NVDA-PERP",
        side: "LONG",
        collateral: "999999",
        leverage: 5,
        tx: { onStatus: (event) => events.push(event) },
      }),
      (error: unknown) => error instanceof AlphaMarketsContractError && !(error instanceof UserRejectedError),
    );
    assert.equal(events.at(-1)?.status, "failed");
  });

  test("option premiums are only honoured when the quoter signed them", async () => {
    const token = addresses.settlementToken;
    const strike = 190n * 10n ** 18n;
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600);
    const premium = 50_000_000n; // $50 for the whole order, 6-decimal token
    const validUntil = BigInt(Math.floor(Date.now() / 1000) + 300);
    const base = {
      chainId: 46_630,
      optionsEngine: addresses.optionsEngine,
      user: account.address,
      marketId: resolveMarketId("NVDA"),
      optionType: OptionType.CALL,
      strike,
      expiry,
      contracts: 10n,
    };
    // The deploy script grants QUOTER_ROLE to the deployer by default, so this account stands in
    // for services/pricing; the typed-data shape is the same one that service signs.
    const sign = (input: Parameters<typeof openQuoteTypedData>[0]) => account.signTypedData(openQuoteTypedData(input));
    const params = { underlying: "NVDA", type: "CALL", strike, expiry, contracts: 10n } as const;

    // Try to buy the option for free: sign for $50, submit for $0.
    const signedFor50 = await sign({ ...base, premium, validUntil, nonce: 1n });
    await assert.rejects(
      alphaMarkets.options.openPosition({
        ...params,
        authorization: { premium: 0n, validUntil, nonce: 1n, signature: signedFor50 },
      }),
      InvalidQuoteError,
    );

    // The honest path: the signed premium is what is charged.
    const before = (await alphaMarkets.vault.balances(account.address, token)).available;
    const authorization = { premium, validUntil, nonce: 1n, signature: signedFor50 };
    await alphaMarkets.options.openPosition({ ...params, authorization, tx: { wait: true } });
    const afterOpen = (await alphaMarkets.vault.balances(account.address, token)).available;
    assert.equal(before - afterOpen, premium + (premium * 20n) / 10_000n); // premium + 0.20% open fee

    // The same quote cannot be used twice.
    await assert.rejects(alphaMarkets.options.openPosition({ ...params, authorization }), QuoteAlreadyUsedError);

    // Closing: a caller cannot claim more than the quoter signed.
    const { options: optionPositions } = await alphaMarkets.portfolio.positions(account.address);
    const position = optionPositions.find((p) => p.status === OptionPositionStatus.OPEN)!;
    const closePremium = 60_000_000n;
    const closeSignature = await account.signTypedData(
      closeQuoteTypedData({
        chainId: 46_630,
        optionsEngine: addresses.optionsEngine,
        user: account.address,
        positionId: position.positionId,
        premium: closePremium,
        validUntil,
        nonce: 2n,
      }),
    );
    await assert.rejects(
      alphaMarkets.options.closePosition(position.positionId, {
        authorization: { premium: 50_000_000_000n, validUntil, nonce: 2n, signature: closeSignature },
      }),
      InvalidQuoteError,
    );
    await alphaMarkets.options.closePosition(position.positionId, {
      authorization: { premium: closePremium, validUntil, nonce: 2n, signature: closeSignature },
      tx: { wait: true },
    });

    const closed = await alphaMarkets.portfolio.getOptionPosition(position.positionId);
    assert.equal(closed.status, OptionPositionStatus.CLOSED);
    const afterClose = (await alphaMarkets.vault.balances(account.address, token)).available;
    assert.equal(afterClose - afterOpen, closePremium - (closePremium * 20n) / 10_000n); // premium less 0.20% close fee
  });

  test("increasing a position charges the taker fee and cannot exceed the leverage ceiling", async () => {
    const token = addresses.settlementToken;
    await alphaMarkets.vault.deposit(token, "5000", { wait: true });
    const { positionId } = await alphaMarkets.perps.openPosition({ market: "NVDA", side: "LONG", collateral: "500", leverage: 5, tx: { wait: true } });

    // 5x on $500 is $2,500; adding $4,000 of size with no margin would be 13x.
    await assert.rejects(alphaMarkets.perps.increasePosition(positionId, { addSize: "4000" }), PositionLimitExceededError);

    const before = (await alphaMarkets.vault.balances(account.address, token)).available;
    await alphaMarkets.perps.increasePosition(positionId, { addCollateral: "500", addSize: "2500", tx: { wait: true } });
    const spent = before - (await alphaMarkets.vault.balances(account.address, token)).available;
    const fee = (await alphaMarkets.fees.get("NVDA")).takerFee;
    assert.equal(spent, 500_000_000n + (2_500_000_000n * fee) / 10_000n);

    const grown = await alphaMarkets.portfolio.getPerpPosition(positionId);
    assert.equal(grown.size, 5_000_000_000n);
    assert.equal(grown.collateral, 1_000_000_000n);
    await alphaMarkets.perps.closePosition(positionId, { tx: { wait: true } });
  });

  test("a limit order rests until the mark reaches its trigger, then anyone can fill it", async () => {
    const token = addresses.settlementToken;
    const publicClient = createWalletClient({ account, transport: http(rpcUrl) }).extend(publicActions);
    const feed = await publicClient.readContract({ address: addresses.oracleRouter, abi: oracleRouterAbi, functionName: "primarySource", args: [resolveMarketId("NVDA")] });
    const setFeedPrice = async (price: string) => {
      const hash = await publicClient.writeContract({
        address: feed,
        abi: parseAbi(["function setPrice(uint256 price)"]),
        chain: null,
        functionName: "setPrice",
        args: [BigInt(price) * 10n ** 18n],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    };

    const preview = await alphaMarkets.perps.previewOpen({ market: "NVDA", side: "LONG", collateral: "1000", leverage: 5, orderType: "LIMIT", limitPrice: "180", user: account.address });
    assert.equal(preview.entryPrice, 180n * 10n ** 18n);

    const before = (await alphaMarkets.vault.balances(account.address, token)).available;
    const { orderId } = await alphaMarkets.perps.placeLimitOrder({ market: "NVDA", side: "LONG", collateral: "1000", leverage: 5, limitPrice: "180", tx: { wait: true } });
    assert.equal((await alphaMarkets.vault.balances(account.address, token)).available, before, "a resting order reserves nothing");

    const [resting] = (await alphaMarkets.portfolio.orders(account.address)).filter((order) => order.status === "OPEN");
    assert.equal(resting?.id, orderId);
    assert.equal(resting?.triggerPrice, 180n * 10n ** 18n);

    // The mark is 190: the trigger is not reached.
    await assert.rejects(alphaMarkets.perps.executeLimitOrder(orderId), LimitPriceNotReachedError);

    await setFeedPrice("179");
    const { positionId } = await alphaMarkets.perps.executeLimitOrder(orderId, { wait: true });
    const position = await alphaMarkets.portfolio.getPerpPosition(positionId);
    assert.equal(position.owner, account.address);
    assert.equal(position.entryPrice, 179n * 10n ** 18n);
    assert.equal((await alphaMarkets.perps.getOrder(orderId)).status, "EXECUTED");

    // A cancelled order cannot fill.
    const second = await alphaMarkets.perps.placeLimitOrder({ market: "NVDA", side: "LONG", collateral: "100", leverage: 2, limitPrice: "179", tx: { wait: true } });
    await alphaMarkets.perps.cancelLimitOrder(second.orderId, { wait: true });
    await assert.rejects(alphaMarkets.perps.executeLimitOrder(second.orderId), AlphaMarketsContractError);

    await alphaMarkets.perps.closePosition(positionId, { tx: { wait: true } });
    await setFeedPrice("190");
  });

  test("a stop-loss rests until the mark falls to its trigger, then anyone can close the position", async () => {
    const publicClient = createWalletClient({ account, transport: http(rpcUrl) }).extend(publicActions);
    const feed = await publicClient.readContract({ address: addresses.oracleRouter, abi: oracleRouterAbi, functionName: "primarySource", args: [resolveMarketId("NVDA")] });
    const setFeedPrice = async (price: string) => {
      const hash = await publicClient.writeContract({
        address: feed,
        abi: parseAbi(["function setPrice(uint256 price)"]),
        chain: null,
        functionName: "setPrice",
        args: [BigInt(price) * 10n ** 18n],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    };

    // The vault still holds the earlier tests' deposits, which is plenty for 500 of margin.
    const { positionId } = await alphaMarkets.perps.openPosition({ market: "NVDA", side: "LONG", collateral: "500", leverage: 5, tx: { wait: true } });

    // A long's stop-loss must sit below the mark (190), its take-profit above.
    await assert.rejects(alphaMarkets.perps.placeTriggerOrder({ positionId, kind: "STOP_LOSS", triggerPrice: "195" }), InvalidTriggerPriceError);
    await assert.rejects(alphaMarkets.perps.placeTriggerOrder({ positionId, kind: "TAKE_PROFIT", triggerPrice: "185" }), InvalidTriggerPriceError);

    const stop = await alphaMarkets.perps.placeTriggerOrder({ positionId, kind: "STOP_LOSS", triggerPrice: "180", tx: { wait: true } });
    const profit = await alphaMarkets.perps.placeTriggerOrder({ positionId, kind: "TAKE_PROFIT", triggerPrice: "200", tx: { wait: true } });

    const resting = (await alphaMarkets.portfolio.triggerOrders(account.address)).filter((order) => order.status === "OPEN");
    assert.deepEqual(resting.map((order) => [order.id, order.kind, order.positionId]), [
      [stop.orderId, "STOP_LOSS", positionId],
      [profit.orderId, "TAKE_PROFIT", positionId],
    ]);

    // The mark is 190: neither trigger is reached.
    await assert.rejects(alphaMarkets.perps.executeTriggerOrder(stop.orderId), TriggerPriceNotReachedError);

    await setFeedPrice("179");
    await assert.rejects(alphaMarkets.perps.executeTriggerOrder(profit.orderId), TriggerPriceNotReachedError);
    await alphaMarkets.perps.executeTriggerOrder(stop.orderId, { wait: true });

    const closed = await alphaMarkets.portfolio.getPerpPosition(positionId);
    assert.equal(closed.open, false);
    assert.ok(closed.realizedPnl < 0n, "the stop-loss closed at a loss");
    assert.equal((await alphaMarkets.perps.getTriggerOrder(stop.orderId)).status, "EXECUTED");

    // The take-profit is left on a closed position and cannot fire; its owner cancels it.
    await setFeedPrice("205");
    await assert.rejects(alphaMarkets.perps.executeTriggerOrder(profit.orderId), AlphaMarketsContractError);
    await alphaMarkets.perps.cancelTriggerOrder(profit.orderId, { wait: true });
    assert.equal((await alphaMarkets.perps.getTriggerOrder(profit.orderId)).status, "CANCELLED");
    await setFeedPrice("190");
  });

  test("a cross-margin position is backed by the account, and its health comes from the contract", async () => {
    assert.ok(alphaMarkets.crossMargin.supported());
    const before = await alphaMarkets.crossMargin.health(account.address);
    assert.equal(before.hasCrossPositions, false);
    assert.equal(before.liquidatable, false);

    const { positionId } = await alphaMarkets.perps.openPosition({ market: "NVDA", side: "LONG", collateral: "500", leverage: 5, marginMode: "CROSS", tx: { wait: true } });
    const health = await alphaMarkets.crossMargin.health(account.address);
    assert.equal(health.hasCrossPositions, true);
    assert.equal(health.liquidatable, false);
    // 5x on $500 is $2,500 of notional, and the maintenance requirement is 5% of it (RiskManager's default).
    assert.equal(health.requirement, 125_000_000n);
    assert.ok(health.buffer > 0n);
    assert.deepEqual(await alphaMarkets.crossMargin.positions(account.address), [positionId]);
    assert.equal(await alphaMarkets.crossMargin.worstPosition(account.address), positionId);

    await alphaMarkets.perps.closePosition(positionId, { tx: { wait: true } });
    assert.equal((await alphaMarkets.crossMargin.health(account.address)).hasCrossPositions, false);
  });

  test("a market maker's signed price opens a position at exactly that price", async () => {
    assert.ok(alphaMarkets.rfq.supported());
    const params = await alphaMarkets.rfq.parameters();
    assert.equal(params.maxDeviationBps, 100n);

    const now = BigInt(Math.floor(Date.now() / 1000));
    const quote = { user: account.address, market: "NVDA", side: "LONG" as const, collateral: 500_000_000n, leverage: 5, price: 190_500_000_000_000_000_000n, validUntil: now + 120n, nonce: 1n };
    // The deployer holds the maker role on a local deployment (`MAKER_ADDRESS` defaults to it).
    const signature = await account.signTypedData(alphaMarkets.rfq.typedData(quote));

    const { positionId } = await alphaMarkets.rfq.execute({ ...quote, signature }, { wait: true });
    const position = await alphaMarkets.portfolio.getPerpPosition(positionId);
    assert.equal(position.entryPrice, 190_500_000_000_000_000_000n);
    assert.equal(position.owner, account.address);

    // A quote is single use, and one far from the mark is refused.
    await assert.rejects(alphaMarkets.rfq.execute({ ...quote, signature }), AlphaMarketsContractError);
    const far = { ...quote, price: 250n * 10n ** 18n, nonce: 2n };
    await assert.rejects(alphaMarkets.rfq.execute({ ...far, signature: await account.signTypedData(alphaMarkets.rfq.typedData(far)) }), AlphaMarketsContractError);

    await alphaMarkets.perps.closePosition(positionId, { tx: { wait: true } });
  });

  test("a subaccount trades with its own balance, and a failed leg undoes the whole package", async () => {
    assert.ok(alphaMarkets.subaccounts.supported());
    const predicted = await alphaMarkets.subaccounts.computeAddress(account.address, 1n);
    const { address: sub } = await alphaMarkets.subaccounts.create(1n, { wait: true });
    assert.equal(sub, predicted);
    assert.deepEqual((await alphaMarkets.subaccounts.list(account.address)).map((s) => [s.address, s.index]), [[sub, 1n]]);

    await alphaMarkets.subaccounts.deposit(sub, "1000", { tx: { wait: true } });
    assert.equal((await alphaMarkets.subaccounts.balances(sub)).available, 1_000_000_000n);

    // Trade as the subaccount: the engine sees it, not the wallet, as the trader.
    const open = await alphaMarkets.trading.prepareOpenPerp({ market: "NVDA", side: "LONG", collateral: "400", leverage: 5 });
    await alphaMarkets.subaccounts.execute(sub, open, { wait: true });
    const held = (await alphaMarkets.portfolio.positions(sub)).perps.filter((position) => position.open);
    assert.equal(held.length, 1);
    assert.equal(held[0]!.owner, sub);
    assert.equal((await alphaMarkets.subaccounts.balances(sub)).lockedMargin, 400_000_000n);

    // An all-or-nothing package: the second call fails (4x is not a tier), so the first is undone.
    const good = await alphaMarkets.trading.prepareOpenPerp({ market: "NVDA", side: "SHORT", collateral: "100", leverage: 2 });
    const bad = await alphaMarkets.trading.prepareOpenPerp({ market: "NVDA", side: "SHORT", collateral: "100", leverage: 4 });
    await assert.rejects(alphaMarkets.subaccounts.multicall(sub, [good, bad]));
    assert.equal((await alphaMarkets.portfolio.positions(sub)).perps.filter((position) => position.open).length, 1);

    const close = await alphaMarkets.trading.prepareClosePerp(held[0]!.positionId, { market: "NVDA", side: "LONG" });
    await alphaMarkets.subaccounts.execute(sub, close, { wait: true });
    const free = (await alphaMarkets.subaccounts.balances(sub)).available;
    await alphaMarkets.subaccounts.withdraw(sub, (Number(free) / 1e6).toFixed(6), { tx: { wait: true } });
    assert.equal((await alphaMarkets.subaccounts.balances(sub)).available, 0n);
  });
});
