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
import type { ContractAddresses } from "@orionis/config";
import { Orionis } from "./client.js";
import { InvalidQuoteError, OrionisContractError, QuoteAlreadyUsedError, UserRejectedError } from "./errors.js";
import { closeQuoteTypedData, openQuoteTypedData } from "./quotes.js";
import { OptionPositionStatus, OptionType } from "@orionis/types";
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
  let orionis: Orionis;
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

    orionis = new Orionis({ chainId: 46_630, transport: http(rpcUrl), account, addresses });
  });

  after(() => {
    anvil?.kill();
    rmSync(resolve(contractsDir, `deployments/${NETWORK}.json`), { force: true });
  });

  test("reads markets and prices from the deployed registry and oracle", async () => {
    const markets = await orionis.markets.list();
    assert.equal(markets.length, 1);
    assert.equal((await orionis.perps.list()).length, 1);

    const prices = await orionis.prices.get("NVDA-PERP");
    assert.equal(prices.index.price, 190n * 10n ** 18n);
  });

  test("approve -> deposit -> open -> close, with lifecycle events and typed errors", async () => {
    const token = addresses.settlementToken;
    await orionis.erc20.approve(token, addresses.vault, "10000", { wait: true });
    await orionis.vault.deposit(token, "5000", { wait: true });
    assert.equal((await orionis.vault.balances(account.address, token)).available, 5_000_000_000n);

    const preview = await orionis.perps.previewOpen({
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
    const { hash } = await orionis.perps.openPosition({
      market: "NVDA-PERP",
      side: "LONG",
      collateral: "1000",
      leverage: 5,
      tx: { wait: true, onStatus: (event) => events.push(event.status) },
    });
    assert.deepEqual(events, ["preparing", "awaiting_wallet", "submitted", "confirming", "confirmed"]);
    assert.match(hash, /^0x[0-9a-f]{64}$/);

    const { perps, options } = await orionis.portfolio.positions(account.address);
    assert.equal(options.length, 0);
    assert.equal(perps.length, 1);
    const position = perps[0]!;
    assert.equal(position.open, true);
    assert.equal(position.isLong, true);
    assert.equal(position.collateral, 1_000_000_000n);
    assert.equal(position.entryPrice, preview.entryPrice);

    // The previewed liquidation price is the same number MarginEngine's library produces.
    assert.ok(preview.liquidationPrice < position.entryPrice);

    const afterOpen = await orionis.vault.balances(account.address, token);
    assert.equal(afterOpen.lockedMargin, 1_000_000_000n);
    assert.equal(afterOpen.available, 5_000_000_000n - 1_000_000_000n - preview.fee);

    const summary = await orionis.portfolio.summary(account.address);
    assert.equal(summary.unrealizedPerpPnl, 0n);

    await orionis.perps.closePosition(position.positionId, { tx: { wait: true } });
    const closed = await orionis.portfolio.getPerpPosition(position.positionId);
    assert.equal(closed.open, false);
    assert.equal((await orionis.vault.balances(account.address, token)).lockedMargin, 0n);

    await orionis.vault.withdraw(token, "1000", { wait: true });
  });

  test("a revert surfaces as a typed error and is reported via onStatus", async () => {
    const events: TxEvent[] = [];
    await assert.rejects(
      orionis.perps.openPosition({
        market: "NVDA-PERP",
        side: "LONG",
        collateral: "999999",
        leverage: 5,
        tx: { onStatus: (event) => events.push(event) },
      }),
      (error: unknown) => error instanceof OrionisContractError && !(error instanceof UserRejectedError),
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
      orionis.options.openPosition({
        ...params,
        authorization: { premium: 0n, validUntil, nonce: 1n, signature: signedFor50 },
      }),
      InvalidQuoteError,
    );

    // The honest path: the signed premium is what is charged.
    const before = (await orionis.vault.balances(account.address, token)).available;
    const authorization = { premium, validUntil, nonce: 1n, signature: signedFor50 };
    await orionis.options.openPosition({ ...params, authorization, tx: { wait: true } });
    const afterOpen = (await orionis.vault.balances(account.address, token)).available;
    assert.equal(before - afterOpen, premium + (premium * 20n) / 10_000n); // premium + 0.20% open fee

    // The same quote cannot be used twice.
    await assert.rejects(orionis.options.openPosition({ ...params, authorization }), QuoteAlreadyUsedError);

    // Closing: a caller cannot claim more than the quoter signed.
    const { options: optionPositions } = await orionis.portfolio.positions(account.address);
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
      orionis.options.closePosition(position.positionId, {
        authorization: { premium: 50_000_000_000n, validUntil, nonce: 2n, signature: closeSignature },
      }),
      InvalidQuoteError,
    );
    await orionis.options.closePosition(position.positionId, {
      authorization: { premium: closePremium, validUntil, nonce: 2n, signature: closeSignature },
      tx: { wait: true },
    });

    const closed = await orionis.portfolio.getOptionPosition(position.positionId);
    assert.equal(closed.status, OptionPositionStatus.CLOSED);
    const afterClose = (await orionis.vault.balances(account.address, token)).available;
    assert.equal(afterClose - afterOpen, closePremium - (closePremium * 20n) / 10_000n); // premium less 0.20% close fee
  });
});
