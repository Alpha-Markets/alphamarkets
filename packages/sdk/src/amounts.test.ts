import assert from "node:assert/strict";
import { test } from "node:test";
import { convertDecimals, fromBaseUnits, toBaseUnits } from "./amounts.js";

test("decimal strings scale by decimals; bigint passes through unchanged", () => {
  assert.equal(toBaseUnits("1000.5", 6), 1_000_500_000n);
  assert.equal(toBaseUnits("190", 18), 190n * 10n ** 18n);
  assert.equal(toBaseUnits(123n, 6), 123n);
});

test("rejects JS numbers and malformed strings", () => {
  assert.throws(() => toBaseUnits(0.1 as unknown as string, 6), /bigint or decimal string/);
  assert.throws(() => toBaseUnits("1e6", 6), /Invalid decimal amount/);
  assert.throws(() => toBaseUnits("-5", 6), /Invalid decimal amount/);
  assert.throws(() => toBaseUnits("", 6), /Invalid decimal amount/);
});

test("fromBaseUnits round-trips", () => {
  assert.equal(fromBaseUnits(toBaseUnits("12.345678", 6), 6), "12.345678");
});

test("convertDecimals widens exactly and narrows toward zero", () => {
  assert.equal(convertDecimals(1_500_000n, 6, 18), 1_500_000n * 10n ** 12n);
  assert.equal(convertDecimals(1_999_999_999_999n, 18, 6), 1n);
  assert.equal(convertDecimals(5n, 6, 6), 5n);
});
