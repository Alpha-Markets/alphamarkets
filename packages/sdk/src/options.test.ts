import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { OptionType } from "@orionis/types";
import { NotImplementedError } from "./errors.js";
import { createOptions, premiumForOrder, type SignedQuote } from "./options.js";
import { activeMarket, addresses, fakeClient, NVDA, USER, WAD } from "./testing.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const SIGNATURE = `0x${"11".repeat(65)}` as const;

function mockQuote(premium: number, authorization?: Record<string, string>, extra: Record<string, unknown> = {}) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({
        premium,
        iv: 0.412,
        delta: 0.58,
        gamma: 0.031,
        theta: -0.14,
        vega: 0.22,
        breakEven: 194.82,
        spot: 184.42,
        ...extra,
        ...(authorization ? { authorization } : {}),
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  return requests;
}

const signed = (premium: bigint): SignedQuote => ({ premium, validUntil: 1_900_000_000n, nonce: 7n, signature: SIGNATURE });
const rawSigned = (premium: string) => ({ premium, validUntil: "1900000000", nonce: "7", signature: SIGNATURE });

function setup(apiUrl: string | null = "http://api.test") {
  const fake = fakeClient({ getContractSize: 100n * WAD, availableBalance: 10_000_000_000n });
  const options = createOptions({
    client: fake.client,
    addresses,
    decimals: async () => 6,
    markets: { list: async () => [activeMarket], get: async () => activeMarket, stats: async () => [] },
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
    strike: "190",
    expiry: "2026-09-25T00:00:00.000Z",
    type: "CALL",
    contracts: 10,
    user: USER,
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

test("premiumForOrder scales by contract size and count, then narrows to token decimals", () => {
  assert.equal(premiumForOrder(4.82, 100n * WAD, 10n, 6), 4_820_000_000n);
  assert.equal(premiumForOrder(4.82, WAD, 1n, 18), 4_820_000_000_000_000_000n);
  assert.equal(premiumForOrder(0, WAD, 10n, 6), 0n);
});

test("previewOpen returns the signed premium and quote when a user is given", async () => {
  mockQuote(4.82, rawSigned("4820000000"));
  const { options } = setup();
  const preview = await options.previewOpen({ ...callParams, user: USER });

  assert.equal(preview.premium, 4_820_000_000n);
  assert.deepEqual(preview.authorization, signed(4_820_000_000n));
});

test("without a user there is nothing to sign, so previews carry no authorization", async () => {
  const requests = mockQuote(4.82);
  const { options } = setup();
  const preview = await options.previewOpen(callParams);

  assert.equal(requests[0]!.body.user, undefined);
  assert.equal(preview.authorization, undefined);
  assert.equal(preview.premium, 4_820_000_000n); // computed for display only
});

test("openPosition submits the params plus the signed quote; the premium comes from the quote", async () => {
  const { options, simulated } = setup();
  await options.openPosition({ ...callParams, authorization: signed(4_820_000_000n), deadline: 2_000_000_000n });

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
      deadline: 2_000_000_000n,
    },
    { validUntil: 1_900_000_000n, nonce: 7n, signature: SIGNATURE },
  ]);
});

test("opening or closing without a signed quote fails before any RPC call", async () => {
  const { options, calls } = setup();
  await assert.rejects(
    options.openPosition({ ...callParams } as never),
    /signed quote is required/,
  );
  await assert.rejects(options.closePosition(1n, {} as never), /signed quote is required/);
  assert.equal(calls.length, 0);
});

test("closePosition submits the position, signed premium and quote", async () => {
  const { options, simulated } = setup();
  await options.closePosition(9n, { authorization: signed(1_000_000_000n), deadline: 2_000_000_000n });
  assert.deepEqual(simulated()[0]!.args, [
    9n,
    1_000_000_000n,
    2_000_000_000n,
    { validUntil: 1_900_000_000n, nonce: 7n, signature: SIGNATURE },
  ]);
});

test("quoteClose asks the API for a signed close price", async () => {
  const requests = mockQuote(3.1, rawSigned("310000000"));
  const { options } = setup();
  const closeQuote = await options.quoteClose(9n, USER);

  assert.equal(requests[0]!.url, "http://api.test/v1/options/quote/close");
  assert.deepEqual(requests[0]!.body, { positionId: "9", user: USER });
  assert.equal(closeQuote.premium, 310_000_000n);
  assert.deepEqual(closeQuote.authorization, signed(310_000_000n));
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
          : [{ seriesId: "0x01", expiry: "1790294400", strike: "190000000000000000000", optionType: 1 }],
      ),
    )) as typeof fetch;
  const { options } = setup();
  assert.deepEqual(await options.expiries("NVDA"), [1_790_294_400n]);
  assert.deepEqual(await options.chain("NVDA"), [
    { seriesId: "0x01", expiry: 1_790_294_400n, strike: 190n * WAD, optionType: OptionType.PUT },
  ]);
});

test("an older pricing service without bid and ask still previews: both default to the mark", async () => {
  mockQuote(4.82);
  const { options } = setup();
  const quote = await options.quote(callParams);
  assert.equal(quote.bid, 4.82);
  assert.equal(quote.ask, 4.82);
});

test("break-even and max profit follow the ask the buyer pays, not the mark", async () => {
  mockQuote(4.82, undefined, { bid: 4.72, ask: 4.92 });
  const { options } = setup();
  const preview = await options.previewOpen(callParams);
  assert.equal(preview.breakEven, 194_920_000_000_000_000_000n);
  assert.equal(preview.premium, 4_920_000_000n, "unsigned display total is the ask");

  const put = await options.previewOpen({ ...callParams, type: "PUT" });
  assert.equal(put.breakEven, 185_080_000_000_000_000_000n);
});

test("options.stats parses contracts and series from the indexer", async () => {
  let requested = "";
  globalThis.fetch = (async (url: string) => {
    requested = url;
    return new Response(
      JSON.stringify([
        { expiry: "1790000000", strike: "190000000000000000000", optionType: 1, openInterest: "12", volume24h: "30.0000" },
      ]),
    );
  }) as unknown as typeof fetch;
  const { options } = setup();
  const [row] = await options.stats("NVDA", 1_790_000_000n);
  assert.equal(requested, "http://api.test/v1/options/NVDA/stats?expiry=1790000000");
  assert.deepEqual(row, { expiry: 1_790_000_000n, strike: 190n * WAD, type: "PUT", openInterest: 12n, volume24h: 30n });
});

test("the risk checks see the option notional in settlement-token units, as OptionsEngine passes it", async () => {
  mockQuote(4.82);
  const { options, calls } = setup(); // 6-decimal token, contract size 100 units
  await options.previewOpen(callParams);

  // 10 contracts x 100 units x $190 = $190,000, in 6-decimal base units (not 18).
  const size = calls.find((call) => call.functionName === "checkPositionSize");
  assert.equal(size?.args?.[1], 190_000_000_000n);
});

test("surface asks the API for the model's grid and passes strikes and expiries on the query", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ spot: 190, ivSource: "default", baseVolatility: 0.5, shape: { skewSlope: 0, smileCurve: 0, termSlope: 0 }, strikes: [180, 200], expiries: [] }), { status: 200 });
  }) as typeof fetch;
  const { options } = setup();

  const plain = await options.surface("NVDA");
  assert.equal(plain.ivSource, "default");
  assert.equal(urls[0], "http://api.test/v1/options/NVDA/surface");

  await options.surface("NVDA", { strikes: [180, 200.5], expiries: [1_800_000_000n, "2027-01-01"] });
  assert.equal(urls[1], `http://api.test/v1/options/NVDA/surface?expiries=1800000000%2C${Date.parse("2027-01-01") / 1000}&strikes=180%2C200.5`);
});

test("surface needs apiUrl and reports a failed request", async () => {
  await assert.rejects(setup(null).options.surface("NVDA"), NotImplementedError);
  globalThis.fetch = (async () => new Response("{}", { status: 504 })) as typeof fetch;
  await assert.rejects(setup().options.surface("NVDA"), /returned 504/);
});
