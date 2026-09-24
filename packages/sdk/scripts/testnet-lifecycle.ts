/// Full-lifecycle staging run against a live deployment, through the hosted API and pricing service and
/// the chain: what `testnet-smoke.ts` does not cover. It runs on its own market whose mock feed the
/// caller owns, so it can move the price without touching a market the site shows:
///
///   1. a perp opened and closed at a profit,
///   2. a perp pushed under its maintenance margin and liquidated,
///   3. a call bought on a signed quote, expired in the money and settled,
///   4. a put bought the same way, expired out of the money and settled for nothing.
///
///   PRIVATE_KEY=0x... RPC_URL=... API_URL=https://... MARKET=E2E \
///     pnpm --filter @alphamarkets/sdk lifecycle:testnet
///
/// The key must own the market's mock feed (the deployer does, for a market made by `AddMarket.s.sol`)
/// and needs gas only. The settlement token is a mock with a public `mint`. Prices are set to 100 at the
/// start, so the market must be one made for this test.
import assert from "node:assert/strict";
import { createWalletClient, http, parseAbi, parseUnits, publicActions, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveAddresses, resolveChainId } from "@alphamarkets/config";
import { OptionPositionStatus } from "@alphamarkets/types";
import { AlphaMarkets } from "../src/index.js";

const key = process.env.PRIVATE_KEY as Hex | undefined;
const rpcUrl = process.env.RPC_URL;
const apiUrl = process.env.API_URL;
const market = process.env.MARKET ?? "E2E";
if (!key || !rpcUrl || !apiUrl) throw new Error("Set PRIVATE_KEY, RPC_URL and API_URL.");

const chainId = resolveChainId(process.env.CHAIN_ID);
const addresses = resolveAddresses(chainId);
const account = privateKeyToAccount(key);
const alphaMarkets = new AlphaMarkets({ chainId, transport: http(rpcUrl), account, addresses, apiUrl });
const wallet = createWalletClient({ account, transport: http(rpcUrl) }).extend(publicActions);
const step = (message: string) => console.log(`- ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const token = addresses.settlementToken as Address;
const marketId = stringToHex(market, { size: 32 });

const decimals = await wallet.readContract({ address: token, abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals" });
const units = (whole: string) => parseUnits(whole, decimals);
const available = async () => (await alphaMarkets.vault.balances(account.address, token)).available;

const feed = (await wallet.readContract({
  address: addresses.oracleRouter as Address,
  abi: parseAbi(["function primarySource(bytes32) view returns (address)"]),
  functionName: "primarySource",
  args: [marketId],
})) as Address;
const feedOwner = await wallet.readContract({ address: feed, abi: parseAbi(["function owner() view returns (address)"]), functionName: "owner" });
assert.equal(feedOwner.toLowerCase(), account.address.toLowerCase(), `the key must own the ${market} mock feed (owner is ${feedOwner})`);
step(`market ${market}, feed ${feed}, account ${account.address}, token has ${decimals} decimals`);

async function setPrice(dollars: string) {
  const hash = await wallet.writeContract({
    address: feed,
    abi: parseAbi(["function setPrice(uint256)"]),
    chain: null,
    functionName: "setPrice",
    args: [parseUnits(dollars, 18)],
  });
  await wallet.waitForTransactionReceipt({ hash });
}

// Collateral.
const mint = await wallet.writeContract({ address: token, abi: parseAbi(["function mint(address to, uint256 amount)"]), chain: null, functionName: "mint", args: [account.address, units("50000")] });
await wallet.waitForTransactionReceipt({ hash: mint });
await alphaMarkets.erc20.approve(token, addresses.vault, "50000", { wait: true });
await alphaMarkets.vault.deposit(token, "20000", { wait: true });
await setPrice("100");
step("minted and deposited 20,000; feed price set to 100");

// 1. Perp opened and closed at a profit.
const before = await available();
const profitable = await alphaMarkets.perps.openPosition({ market, side: "LONG", collateral: "1000", leverage: 5, tx: { wait: true } });
await setPrice("110");
await alphaMarkets.perps.closePosition(profitable.positionId, { tx: { wait: true } });
const afterProfit = await available();
assert.equal((await alphaMarkets.portfolio.getPerpPosition(profitable.positionId)).open, false);
assert.ok(afterProfit > before, `a +10% move on a 5x long should net a profit (before ${before}, after ${afterProfit})`);
step(`1. perp #${profitable.positionId} closed at a profit: balance ${before} -> ${afterProfit}`);

// 2. Perp liquidated.
await setPrice("100");
const doomed = await alphaMarkets.perps.openPosition({ market, side: "LONG", collateral: "1000", leverage: 10, tx: { wait: true } });
const liquidationEngine = addresses.liquidationEngine as Address;
const liquidationAbi = parseAbi(["function isLiquidatable(uint256) view returns (bool)", "function liquidate(uint256)"]);
assert.equal(await wallet.readContract({ address: liquidationEngine, abi: liquidationAbi, functionName: "isLiquidatable", args: [doomed.positionId] }), false, "a fresh position must not be liquidatable");
await setPrice("90.5"); // -9.5% on a 10x long: equity 5% of the size, under a 5% maintenance margin
assert.equal(await wallet.readContract({ address: liquidationEngine, abi: liquidationAbi, functionName: "isLiquidatable", args: [doomed.positionId] }), true, "the position should now be liquidatable");
const liquidate = await wallet.writeContract({ address: liquidationEngine, abi: liquidationAbi, chain: null, functionName: "liquidate", args: [doomed.positionId] });
await wallet.waitForTransactionReceipt({ hash: liquidate });
assert.equal((await alphaMarkets.portfolio.getPerpPosition(doomed.positionId)).open, false);
step(`2. perp #${doomed.positionId} liquidated at 90.5 (tx ${liquidate})`);

// 3 and 4. Options that expire in and out of the money, settled by anyone.
async function optionRun(type: "CALL" | "PUT", strike: string, finalPrice: string) {
  await setPrice("100");
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 150);
  const series = { underlying: market, type, strike, expiry, contracts: 1 } as const;
  const preview = await alphaMarkets.options.previewOpen({ ...series, user: account.address });
  assert.ok(preview.authorization, "the pricing service returned no signed quote");
  assert.deepEqual(preview.violations, []);
  const opened = await alphaMarkets.options.openPosition({ ...series, authorization: preview.authorization, tx: { wait: true } });
  const afterBuy = await available();
  step(`   bought ${type} #${opened.positionId} strike ${strike} for ${preview.premium}, expires in ~150s`);
  const wait = Number(expiry) * 1000 - Date.now() + 5_000;
  if (wait > 0) await sleep(wait);
  await setPrice(finalPrice); // a fresh price at or after expiry becomes the settlement price
  await alphaMarkets.options.settle(market, expiry, strike, type, { wait: true });
  const position = await alphaMarkets.portfolio.getOptionPosition(opened.positionId);
  assert.equal(position.status, OptionPositionStatus.SETTLED);
  return { positionId: opened.positionId, afterBuy, afterSettle: await available() };
}

const call = await optionRun("CALL", "100", "120");
assert.ok(call.afterSettle > call.afterBuy, `an in-the-money call should pay out (${call.afterBuy} -> ${call.afterSettle})`);
step(`3. call #${call.positionId} expired in the money and paid out: ${call.afterBuy} -> ${call.afterSettle}`);

const put = await optionRun("PUT", "100", "120");
assert.equal(put.afterSettle, put.afterBuy, "an out-of-the-money put should pay nothing");
step(`4. put #${put.positionId} expired out of the money and paid nothing`);

await setPrice("100");
await alphaMarkets.vault.withdraw(token, "5000", { wait: true });
step("withdrew 5,000");
console.log("lifecycle test passed");
