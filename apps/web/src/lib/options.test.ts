import assert from "node:assert/strict";
import { test } from "node:test";
import { stringToHex } from "viem";
import { OptionType } from "@alphamarkets/types";
import {
  expiryCode,
  expiryDates,
  fmtContracts,
  fmtQuoteDelta,
  fmtQuoteGamma,
  fmtQuoteIv,
  fmtQuotePremium,
  fmtQuoteTheta,
  fmtQuoteVega,
  ivSourceLabel,
  nearestStrikeIndex,
  optionCode,
  seriesKey,
  strikeLadder,
  strikeText,
} from "./options.js";

test("expiry codes match the brief's format", () => {
  assert.equal(expiryCode(BigInt(Date.UTC(2026, 8, 25) / 1000)), "25SEP26");
  assert.equal(expiryCode(BigInt(Date.UTC(2027, 0, 3) / 1000)), "03JAN27");
});

test("option codes are UNDERLYING-EXPIRY-STRIKE-TYPE", () => {
  const nvda = stringToHex("NVDA", { size: 32 });
  const expiry = BigInt(Date.UTC(2026, 8, 25) / 1000);
  assert.equal(optionCode(nvda, expiry, 190n * 10n ** 18n, OptionType.CALL), "NVDA-25SEP26-190-C");
  assert.equal(optionCode(stringToHex("TSLA", { size: 32 }), expiry, 350n * 10n ** 18n, OptionType.PUT), "TSLA-25SEP26-350-P");
  assert.equal(optionCode(nvda, expiry, 187_500_000_000_000_000_000n, OptionType.CALL), "NVDA-25SEP26-187.5-C");
});

test("strike ladder is symmetric around the nearest clean strike", () => {
  const strikes = strikeLadder(190n * 10n ** 18n, 500, 2);
  assert.deepEqual(strikes, [170n, 180n, 190n, 200n, 210n].map((n) => n * 10n ** 18n));
  assert.equal(nearestStrikeIndex(strikes, 193n * 10n ** 18n), 2);
});

test("strike ladder rounds the step to 1, 2 or 5 and keeps strikes positive", () => {
  // 5% of 43 = 2.15, nearest clean step is 2
  assert.deepEqual(strikeLadder(43n * 10n ** 18n, 500, 1), [42n, 44n, 46n].map((n) => n * 10n ** 18n));
  // a large step must not produce zero or negative strikes
  const strikes = strikeLadder(3n * 10n ** 18n, 5_000, 5);
  assert.ok(strikes.length > 0 && strikes.every((strike) => strike > 0n));
});

test("strike ladder is empty for unusable input", () => {
  assert.deepEqual(strikeLadder(0n, 500, 5), []);
  assert.deepEqual(strikeLadder(190n * 10n ** 18n, 0, 5), []);
  assert.deepEqual(strikeLadder(1n, 500, 5), []);
  assert.deepEqual(strikeLadder(190n * 10n ** 18n, 500, -1), []);
  assert.equal(nearestStrikeIndex([], 1n), -1);
});

test("expiry dates are future, sorted and merged with listed series", () => {
  const now = BigInt(Date.UTC(2026, 8, 19, 10) / 1000); // 19 SEP 2026 10:00 UTC
  const sevenDays = BigInt(Date.UTC(2026, 8, 26, 20) / 1000);
  const listedOnly = BigInt(Date.UTC(2026, 9, 2, 20) / 1000);
  const past = now - 3_600n;
  const result = expiryDates([7, 14], now, 20, [listedOnly, sevenDays, past]);
  assert.deepEqual(result, [sevenDays, listedOnly, BigInt(Date.UTC(2026, 9, 3, 20) / 1000)].sort((a, b) => Number(a - b)));
  assert.ok(result.every((expiry) => expiry > now));
  assert.equal(new Set(result).size, result.length);
});

test("an expiry earlier today is dropped", () => {
  const now = BigInt(Date.UTC(2026, 8, 19, 21) / 1000); // after the 20:00 UTC cut-off
  assert.deepEqual(expiryDates([0], now, 20), []);
});

test("strike text and quote formatting", () => {
  assert.equal(strikeText(187_500_000_000_000_000_000n), "187.5");
  assert.equal(fmtQuoteIv(0.5), "50.0%");
  assert.equal(fmtQuotePremium(4.2), "$4.20");
});

test("theta is shown per day and vega per volatility point", () => {
  assert.equal(fmtQuoteTheta(-36.5), "-0.100");
  assert.equal(fmtQuoteVega(22), "0.220");
  assert.equal(fmtQuoteGamma(0.03149), "0.0315");
});

test("the volatility source is named in plain words", () => {
  assert.equal(ivSourceLabel("realized"), "realized");
  assert.equal(ivSourceLabel("default"), "assumed");
  assert.equal(ivSourceLabel(undefined), "reference");
});

test("series keys and contract counts", () => {
  assert.equal(seriesKey(190n * 10n ** 18n, "PUT"), "190000000000000000000-PUT");
  assert.equal(fmtContracts(12_345n), "12,345");
  assert.equal(fmtContracts(undefined), "–");
});

test("a Greek that rounds to zero has no minus sign", () => {
  assert.equal(fmtQuoteDelta(-0.001), "0.00");
  assert.equal(fmtQuoteDelta(-0.004), "0.00");
  assert.equal(fmtQuoteDelta(-0.006), "-0.01");
  assert.equal(fmtQuoteTheta(-0.01), "0.000");
  assert.equal(fmtQuoteDelta(-0.48), "-0.48");
});
