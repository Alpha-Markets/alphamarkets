/// Trades against a live deployment through the public API and the chain, the way the web app does:
/// mint test collateral, deposit, open and close a perp, buy and sell back an option on a signed
/// quote, withdraw. It proves that the deployed contracts accept what the SDK and pricing service
/// sign (the EIP-712 domain in particular), which no unit test can.
///
///   PRIVATE_KEY=0x... RPC_URL=... API_URL=https://... pnpm --filter @alphamarkets/sdk smoke:testnet
///
/// The key needs gas only. The settlement token on testnet is a mock with a public `mint`, so this
/// script mints its own collateral; it will not work against a real stablecoin.
import assert from "node:assert/strict";
import { createWalletClient, http, parseAbi, parseUnits, publicActions, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveAddresses, resolveChainId } from "@alphamarkets/config";
import { OptionPositionStatus } from "@alphamarkets/types";
import { AlphaMarkets } from "../src/index.js";

const key = process.env.PRIVATE_KEY as Hex | undefined;
const rpcUrl = process.env.RPC_URL;
const apiUrl = process.env.API_URL;
if (!key || !rpcUrl || !apiUrl) throw new Error("Set PRIVATE_KEY, RPC_URL and API_URL.");

const chainId = resolveChainId(process.env.CHAIN_ID);
const addresses = resolveAddresses(chainId);
const account = privateKeyToAccount(key);
const alphaMarkets = new AlphaMarkets({ chainId, transport: http(rpcUrl), account, addresses, apiUrl });
const wallet = createWalletClient({ account, transport: http(rpcUrl) }).extend(publicActions);

const step = (message: string) => console.log(`- ${message}`);
const token = addresses.settlementToken as Address;

const decimals = await wallet.readContract({ address: token, abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals" });
step(`settlement token ${token} (${decimals} decimals), account ${account.address}`);

const mint = await wallet.writeContract({
  address: token,
  abi: parseAbi(["function mint(address to, uint256 amount)"]),
  chain: null,
  functionName: "mint",
  args: [account.address, parseUnits("10000", decimals)],
});
await wallet.waitForTransactionReceipt({ hash: mint });
step("minted 10,000 test collateral");

await alphaMarkets.erc20.approve(token, addresses.vault, "10000", { wait: true });
await alphaMarkets.vault.deposit(token, "5000", { wait: true });
const deposited = (await alphaMarkets.vault.balances(account.address, token)).available;
assert.ok(deposited >= parseUnits("5000", decimals), "the deposit did not reach the vault");
step("deposited 5,000");

const { positionId } = await alphaMarkets.perps.openPosition({ market: "NVDA", side: "LONG", collateral: "1000", leverage: 5, tx: { wait: true } });
const perp = await alphaMarkets.portfolio.getPerpPosition(positionId);
assert.equal(perp.open, true);
step(`opened perp #${positionId} at ${perp.entryPrice}`);
await alphaMarkets.perps.closePosition(positionId, { tx: { wait: true } });
assert.equal((await alphaMarkets.portfolio.getPerpPosition(positionId)).open, false);
step(`closed perp #${positionId}`);

// A quote is signed for one user and one order; ask the pricing service for it and submit it as is.
const expiries = await alphaMarkets.options.expiries("NVDA");
assert.ok(expiries.length > 0, "the API lists no option expiry");
const series = { underlying: "NVDA", type: "CALL", strike: "190", expiry: expiries[0]!, contracts: 1 } as const;
const preview = await alphaMarkets.options.previewOpen({ ...series, user: account.address });
assert.ok(preview.authorization, "the pricing service returned no signed quote (is QUOTER_PRIVATE_KEY set?)");
assert.deepEqual(preview.violations, []);
const opened = await alphaMarkets.options.openPosition({ ...series, authorization: preview.authorization, tx: { wait: true } });
step(`bought option #${opened.positionId} for premium ${preview.premium} (signed quote accepted on chain)`);

const closeQuote = await alphaMarkets.options.quoteClose(opened.positionId, account.address);
await alphaMarkets.options.closePosition(opened.positionId, { authorization: closeQuote.authorization, tx: { wait: true } });
assert.equal((await alphaMarkets.portfolio.getOptionPosition(opened.positionId)).status, OptionPositionStatus.CLOSED);
step(`sold option #${opened.positionId} back for ${closeQuote.premium}`);

await alphaMarkets.vault.withdraw(token, "1000", { wait: true });
step("withdrew 1,000");
console.log("smoke test passed");
