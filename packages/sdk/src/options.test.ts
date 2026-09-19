import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { OptionType } from "@orionis/types";
import { NotImplementedError } from "./errors.js";
import { createOptions } from "./options.js";
import { activeMarket, addresses, fakeClient, NVDA, USER, WAD } from "./testing.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockQuote(premium: number) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({ premium, iv: 0.412, delta: 0.58, gamma: 0.031, theta: -0.14, vega: 0.22, breakEven: 194.82, spot: 184.42 }),
      { status: 200 },
    );
  }) as typeof fetch;
  return requests;
}

function setup(apiUrl: string | null = "http://api.test") {
  const fake = fakeClient({ getContractSize: 100n * WAD, availableBalance: 10_000_000_000n });
  const options = createOptions({
    client: fake.client,
    addresses,
    decimals: async () => 6,
    markets: { list: async () => [activeMarket], get: async () => activeMarket },
    fees: {
      get: async () => ({ makerFee: 0n, takerFee: 0n, optionOpenFee: 100n, optionCloseFee: 0n, settlementFee: 0n, liquidationFee: 0n }),
    },
    apiUrl: apiUrl ?? undefined,
  });
  return { options, ...fake };
}

const callParams = { underlying: "NVDA", type: "CALL", strike: "190", expiry: "2026-09-25", contracts: 10 } as const;

test("previewOpen matches the brief's ticket: 10 contracts at $4.82 costs $4,820", async () => {
  const requests = mockQuote(4.82);
  const { options } = setup();
  const preview = await options.previewOpen({ ...callParams, user: USER });

  assert.equal(requests[0]!.url, "http://api.test/v1/options/quote");
  assert.deepEqual(requests[0]!.body, {
    underlying: "NVDA",
    strike: 190,
    expiry: "2026-09-25T00:00:00.000Z",
    type: "CALL",
    contracts: 10,
  });
  assert.equal(preview.premium, 4_820_000_000n);
  assert.equal(preview.fee, 48_200_000n);
  assert.equal(preview.totalRequired, 4_868_200_000n);
  assert.equal(preview.maxLoss, 4_868_200_000n);
  assert.equal(preview.breakEven, 194_820_000_000_000_000_000n);
  assert.equal(preview.maxProfit, null);
  assert.equal(preview.sufficientCollateral, true);
  assert.deepEqual(preview.violations, []);
});

test("a put breaks even below strike and has a bounded max profit", async () => {
  mockQuote(4.82);
  const { options } = setup();
  const preview = await options.previewOpen({ ...callParams, type: "PUT" });

  assert.equal(preview.breakEven, 185_180_000_000_000_000_000n);
  // (190 - 4.82) * 100 shares * 10 contracts = 185,180
  assert.equal(preview.maxProfit, 185_180_000_000n);
});

test("quote-dependent methods require apiUrl", async () => {
  const { options } = setup(null);
  await assert.rejects(options.quote(callParams), NotImplementedError);
  await assert.rejects(options.previewOpen(callParams), NotImplementedError);
  await assert.rejects(options.expiries("NVDA"), NotImplementedError);
});

test("openPosition submits the struct with default premium slippage", async () => {
  const { options, simulated } = setup();
  await options.openPosition({ ...callParams, premium: "4820", deadline: 2_000_000_000n });

  const [call] = simulated();
  assert.equal(call!.functionName, "openPosition");
  assert.deepEqual(call!.args, [
    {
      marketId: NVDA,
      optionType: OptionType.CALL,
      strike: 190n * WAD,
      expiry: 1_790_294_400n,
      contracts: 10n,
      premium: 4_820_000_000n,
      maxPremium: 4_868_200_000n, // +1%
      deadline: 2_000_000_000n,
    },
  ]);
});

test("closePosition bounds the received premium from below", async () => {
  const { options, simulated } = setup();
  await options.closePosition(9n, { premium: "1000", deadline: 2_000_000_000n });
  assert.deepEqual(simulated()[0]!.args, [9n, 1_000_000_000n, 990_000_000n, 2_000_000_000n]);
});

test("settle maps to settleExpired with a fixed-point strike", async () => {
  const { options, simulated } = setup();
  await options.settle("NVDA", "2026-09-25", "190", "PUT");
  assert.equal(simulated()[0]!.functionName, "settleExpired");
  assert.deepEqual(simulated()[0]!.args, [NVDA, 1_790_294_400n, 190n * WAD, OptionType.PUT]);
});

test("chain and expiries parse the API rows", async () => {
  globalThis.fetch = (async (url: string) =>
    new Response(
      JSON.stringify(
        url.includes("expiries")
          ? ["1790294400"]
          : [{ series_id: "0x01", expiry: "1790294400", strike: "190000000000000000000", option_type: 1 }],
      ),
    )) as typeof fetch;
  const { options } = setup();
  assert.deepEqual(await options.expiries("NVDA"), [1_790_294_400n]);
  assert.deepEqual(await options.chain("NVDA"), [
    { seriesId: "0x01", expiry: 1_790_294_400n, strike: 190n * WAD, optionType: OptionType.PUT },
  ]);
});
