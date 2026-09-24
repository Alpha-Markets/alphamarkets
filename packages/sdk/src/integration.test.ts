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

// Deployed (runtime) bytecode of the canonical Multicall3 contract (0xcA11bde...CA11), read via
// `eth_getCode` against the real Robinhood testnet, where it's already deployed. Etched into the
// local anvil node below since this anvil build doesn't predeploy it.
const MULTICALL3_BYTECODE =
  "0x6080604052600436106100f35760003560e01c80634d2301cc1161008a578063a8b0574e11610059578063a8b0574e1461025a578063bce38bd714610275578063c3077fa914610288578063ee82ac5e1461029b57600080fd5b80634d2301cc146101ec57806372425d9d1461022157806382ad56cb1461023457806386d516e81461024757600080fd5b80633408e470116100c65780633408e47014610191578063399542e9146101a45780633e64a696146101c657806342cbb15c146101d957600080fd5b80630f28c97d146100f8578063174dea711461011a578063252dba421461013a57806327e86d6e1461015b575b600080fd5b34801561010457600080fd5b50425b6040519081526020015b60405180910390f35b61012d610128366004610a85565b6102ba565b6040516101119190610bbe565b61014d610148366004610a85565b6104ef565b604051610111929190610bd8565b34801561016757600080fd5b50437fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0140610107565b34801561019d57600080fd5b5046610107565b6101b76101b2366004610c60565b610690565b60405161011193929190610cba565b3480156101d257600080fd5b5048610107565b3480156101e557600080fd5b5043610107565b3480156101f857600080fd5b50610107610207366004610ce2565b73ffffffffffffffffffffffffffffffffffffffff163190565b34801561022d57600080fd5b5044610107565b61012d610242366004610a85565b6106ab565b34801561025357600080fd5b5045610107565b34801561026657600080fd5b50604051418152602001610111565b61012d610283366004610c60565b61085a565b6101b7610296366004610a85565b610a1a565b3480156102a757600080fd5b506101076102b6366004610d18565b4090565b60606000828067ffffffffffffffff8111156102d8576102d8610d31565b60405190808252806020026020018201604052801561031e57816020015b6040805180820190915260008152606060208201528152602001906001900390816102f65790505b5092503660005b8281101561047757600085828151811061034157610341610d60565b6020026020010151905087878381811061035d5761035d610d60565b905060200281019061036f9190610d8f565b6040810135958601959093506103886020850185610ce2565b73ffffffffffffffffffffffffffffffffffffffff16816103ac6060870187610dcd565b6040516103ba929190610e32565b60006040518083038185875af1925050503d80600081146103f7576040519150601f19603f3d011682016040523d82523d6000602084013e6103fc565b606091505b50602080850191909152901515808452908501351761046d577f08c379a000000000000000000000000000000000000000000000000000000000600052602060045260176024527f4d756c746963616c6c333a2063616c6c206661696c656400000000000000000060445260846000fd5b5050600101610325565b508234146104e6576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601a60248201527f4d756c746963616c6c333a2076616c7565206d69736d6174636800000000000060448201526064015b60405180910390fd5b50505092915050565b436060828067ffffffffffffffff81111561050c5761050c610d31565b60405190808252806020026020018201604052801561053f57816020015b606081526020019060019003908161052a5790505b5091503660005b8281101561068657600087878381811061056257610562610d60565b90506020028101906105749190610e42565b92506105836020840184610ce2565b73ffffffffffffffffffffffffffffffffffffffff166105a66020850185610dcd565b6040516105b4929190610e32565b6000604051808303816000865af19150503d80600081146105f1576040519150601f19603f3d011682016040523d82523d6000602084013e6105f6565b606091505b5086848151811061060957610609610d60565b602090810291909101015290508061067d576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601760248201527f4d756c746963616c6c333a2063616c6c206661696c656400000000000000000060448201526064016104dd565b50600101610546565b5050509250929050565b43804060606106a086868661085a565b905093509350939050565b6060818067ffffffffffffffff8111156106c7576106c7610d31565b60405190808252806020026020018201604052801561070d57816020015b6040805180820190915260008152606060208201528152602001906001900390816106e55790505b5091503660005b828110156104e657600084828151811061073057610730610d60565b6020026020010151905086868381811061074c5761074c610d60565b905060200281019061075e9190610e76565b925061076d6020840184610ce2565b73ffffffffffffffffffffffffffffffffffffffff166107906040850185610dcd565b60405161079e929190610e32565b6000604051808303816000865af19150503d80600081146107db576040519150601f19603f3d011682016040523d82523d6000602084013e6107e0565b606091505b506020808401919091529015158083529084013517610851577f08c379a000000000000000000000000000000000000000000000000000000000600052602060045260176024527f4d756c746963616c6c333a2063616c6c206661696c656400000000000000000060445260646000fd5b50600101610714565b6060818067ffffffffffffffff81111561087657610876610d31565b6040519080825280602002602001820160405280156108bc57816020015b6040805180820190915260008152606060208201528152602001906001900390816108945790505b5091503660005b82811015610a105760008482815181106108df576108df610d60565b602002602001015190508686838181106108fb576108fb610d60565b905060200281019061090d9190610e42565b925061091c6020840184610ce2565b73ffffffffffffffffffffffffffffffffffffffff1661093f6020850185610dcd565b60405161094d929190610e32565b6000604051808303816000865af19150503d806000811461098a576040519150601f19603f3d011682016040523d82523d6000602084013e61098f565b606091505b506020830152151581528715610a07578051610a07576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601760248201527f4d756c746963616c6c333a2063616c6c206661696c656400000000000000000060448201526064016104dd565b506001016108c3565b5050509392505050565b6000806060610a2b60018686610690565b919790965090945092505050565b60008083601f840112610a4b57600080fd5b50813567ffffffffffffffff811115610a6357600080fd5b6020830191508360208260051b8501011115610a7e57600080fd5b9250929050565b60008060208385031215610a9857600080fd5b823567ffffffffffffffff811115610aaf57600080fd5b610abb85828601610a39565b90969095509350505050565b6000815180845260005b81811015610aed57602081850181015186830182015201610ad1565b81811115610aff576000602083870101525b50601f017fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0169290920160200192915050565b600082825180855260208086019550808260051b84010181860160005b84811015610bb1578583037fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe001895281518051151584528401516040858501819052610b9d81860183610ac7565b9a86019a9450505090830190600101610b4f565b5090979650505050505050565b602081526000610bd16020830184610b32565b9392505050565b600060408201848352602060408185015281855180845260608601915060608160051b870101935082870160005b82811015610c52577fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa0888703018452610c40868351610ac7565b95509284019290840190600101610c06565b509398975050505050505050565b600080600060408486031215610c7557600080fd5b83358015158114610c8557600080fd5b9250602084013567ffffffffffffffff811115610ca157600080fd5b610cad86828701610a39565b9497909650939450505050565b838152826020820152606060408201526000610cd96060830184610b32565b95945050505050565b600060208284031215610cf457600080fd5b813573ffffffffffffffffffffffffffffffffffffffff81168114610bd157600080fd5b600060208284031215610d2a57600080fd5b5035919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052603260045260246000fd5b600082357fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff81833603018112610dc357600080fd5b9190910192915050565b60008083357fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe1843603018112610e0257600080fd5b83018035915067ffffffffffffffff821115610e1d57600080fd5b602001915036819003821315610a7e57600080fd5b8183823760009101908152919050565b600082357fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc1833603018112610dc357600080fd5b600082357fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa1833603018112610dc357600080fdfea2646970667358221220bb2b5c71a328032f97c676ae39a1ec2148d3e5d6f73d95e9b17910152d61f16264736f6c634300080c0033";

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

    // This anvil build doesn't predeploy Multicall3 the way the real Robinhood testnet does
    // (confirmed via `eth_getCode` against production) — etch it at the same canonical address
    // so `client.multicall` (markets.list, prices.get, funding.get, risk.openInterest) works
    // here exactly as it does against the real chain.
    await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "anvil_setCode",
        params: ["0xcA11bde05977b3631167028862bE2a173976CA11", MULTICALL3_BYTECODE],
      }),
    });

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
      args: [account.address, 200_000n * 10n ** 6n],
    });
    await deployer.waitForTransactionReceipt({ hash: mint });

    // The vault pays a trader's profit from a pool of capital it holds beyond what it owes users, and
    // refuses a payout larger than that pool. Seed one, as a launch would, so profits in these tests
    // can be paid while the losing side is still unrealized.
    const poolAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)", "function fundPool(address token, uint256 amount)"]);
    const approve = await deployer.writeContract({ address: collateral as `0x${string}`, abi: poolAbi, chain: null, functionName: "approve", args: [addresses.vault, 100_000n * 10n ** 6n] });
    await deployer.waitForTransactionReceipt({ hash: approve });
    const fund = await deployer.writeContract({ address: addresses.vault, abi: poolAbi, chain: null, functionName: "fundPool", args: [collateral as `0x${string}`, 100_000n * 10n ** 6n] });
    await deployer.waitForTransactionReceipt({ hash: fund });

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
