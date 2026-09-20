import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyTypedData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { NotImplementedError } from "./errors.js";
import { createRfq, RFQ_DOMAIN_NAME, rfqQuoteTypedData } from "./rfq.js";
import { addresses, addressesWithout, fakeClient, NVDA, USER, WAD } from "./testing.js";

const deployed = addresses;
const RFQ = addresses.rfqManager!;
const quote = { user: USER, market: "NVDA", side: "SHORT" as const, collateral: 1_000_000_000n, leverage: 5, price: 190n * WAD, validUntil: 1_900_000_000n, nonce: 7n };

test("the typed data binds the chain, the manager and every field of the quote", async () => {
  const data = createRfq(fakeClient().client, deployed, 46630).typedData(quote);
  assert.equal(data.domain.name, RFQ_DOMAIN_NAME);
  assert.equal(data.domain.chainId, 46630);
  assert.equal(data.domain.verifyingContract, RFQ);
  assert.equal(data.message.marketId, NVDA);
  assert.equal(data.message.isLong, false);
  assert.equal(data.message.leverage, 5n);
  assert.deepEqual(data.types.RFQQuote.map((field) => field.name), ["user", "marketId", "isLong", "collateral", "leverage", "price", "validUntil", "nonce"]);
});

test("a maker's signature verifies for exactly that quote and no other", async () => {
  const maker = privateKeyToAccount(generatePrivateKey());
  const rfq = createRfq(fakeClient().client, deployed, 46630);
  const signature = await maker.signTypedData(rfq.typedData(quote));
  assert.equal(await verifyTypedData({ address: maker.address, signature, ...rfq.typedData(quote) }), true);
  assert.equal(await verifyTypedData({ address: maker.address, signature, ...rfq.typedData({ ...quote, price: 189n * WAD }) }), false);
  assert.equal(await verifyTypedData({ address: maker.address, signature, ...rfqQuoteTypedData({ chainId: 1, rfqManager: RFQ, user: USER, marketId: NVDA, isLong: false, collateral: quote.collateral, leverage: 5n, price: quote.price, validUntil: quote.validUntil, nonce: 7n }) }), false, "another chain does not verify");
});

test("execute sends the quote and its signature to the manager and returns the position id", async () => {
  const { client, simulated } = fakeClient();
  const { positionId } = await createRfq(client, deployed, 46630).execute({ ...quote, signature: `0x${"22".repeat(65)}` });
  assert.equal(positionId, 42n);
  const [args, signature] = simulated()[0]!.args as [Record<string, unknown>, string];
  assert.equal(args.price, 190n * WAD);
  assert.equal(args.isLong, false);
  assert.equal(signature, `0x${"22".repeat(65)}`);
});

test("parameters reads the band and the block limits; without a manager everything says so", async () => {
  const { client } = fakeClient({ maxDeviationBps: 100n, blockMinNotional: 5n, blockMaxNotional: 9n });
  assert.deepEqual(await createRfq(client, deployed, 46630).parameters(), { maxDeviationBps: 100n, blockMinNotional: 5n, blockMaxNotional: 9n });

  const bare = createRfq(fakeClient().client, addressesWithout("rfqManager"), 46630);
  assert.equal(bare.supported(), false);
  await assert.rejects(bare.parameters(), NotImplementedError);
  assert.throws(() => bare.typedData(quote), NotImplementedError);
});
