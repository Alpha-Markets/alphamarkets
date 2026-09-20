import assert from "node:assert/strict";
import { test } from "node:test";
import { createCrossMargin } from "./crossmargin.js";
import { NotImplementedError } from "./errors.js";
import { addresses, addressesWithout, fakeClient, NVDA, USER } from "./testing.js";

const deployed = addresses;

test("health reads equity, requirement and the liquidation flag from the contract", async () => {
  const { client } = fakeClient({ accountHealth: [1_000n, 250n], isAccountLiquidatable: false, hasOpenCrossPosition: true, portfolioMargin: false });
  const health = await createCrossMargin(client, deployed).health(USER);
  assert.deepEqual(health, { equity: 1_000n, requirement: 250n, buffer: 750n, liquidatable: false, hasCrossPositions: true, portfolioMargin: false });

  const under = fakeClient({ accountHealth: [-50n, 250n], isAccountLiquidatable: true, hasOpenCrossPosition: true, portfolioMargin: true });
  const underwater = await createCrossMargin(under.client, deployed).health(USER);
  assert.equal(underwater.buffer, -300n);
  assert.equal(underwater.liquidatable, true);
});

test("without a CrossMarginManager the methods say so, and supported() is false", async () => {
  const crossMargin = createCrossMargin(fakeClient().client, addressesWithout("crossMargin", "insuranceFund"));
  assert.equal(crossMargin.supported(), false);
  await assert.rejects(crossMargin.health(USER), NotImplementedError);
  await assert.rejects(crossMargin.insuranceFundBalance(), NotImplementedError);
});

test("collateral lists each token until the array ends, with its haircut", async () => {
  const token = `0x${"7b".repeat(20)}` as const;
  let reads = 0;
  const fake = fakeClient({ collateralConfig: [true, 8_000, NVDA, 18] });
  const original = fake.client.readContract.bind(fake.client);
  (fake.client as unknown as { readContract: unknown }).readContract = async (params: { functionName: string }) => {
    if (params.functionName === "collateralTokens") {
      if (reads++ === 0) return token;
      throw new Error("out of range");
    }
    return original(params as never);
  };
  const assets = await createCrossMargin(fake.client, deployed).collateral();
  assert.deepEqual(assets, [{ token, enabled: true, factorBps: 8_000, priceMarketId: NVDA }]);
});

test("portfolio margin and option registration are sent to the manager", async () => {
  const { client, simulated } = fakeClient();
  const crossMargin = createCrossMargin(client, deployed);
  await crossMargin.setPortfolioMargin(true);
  await crossMargin.addPortfolioOption(9n);
  assert.deepEqual(simulated().map((s) => [s.functionName, s.args]), [["setPortfolioMargin", [true]], ["addPortfolioOption", [9n]]]);
});

test("the insurance fund balance is read for the settlement token by default", async () => {
  const { client, calls } = fakeClient({ balance: 123n });
  assert.equal(await createCrossMargin(client, deployed).insuranceFundBalance(), 123n);
  assert.deepEqual(calls[0]!.args, [addresses.settlementToken]);
});
