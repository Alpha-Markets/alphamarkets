import assert from "node:assert/strict";
import { test } from "node:test";
import { OptionType } from "@alphamarkets/types";
import { verdictOf } from "./options.js";

const strike = 100n * 10n ** 18n;

test("a call is in the money above the strike, a put below it", () => {
  assert.equal(verdictOf({ optionType: OptionType.CALL, strike }, strike + 1n), "ITM");
  assert.equal(verdictOf({ optionType: OptionType.CALL, strike }, strike - 1n), "OTM");
  assert.equal(verdictOf({ optionType: OptionType.PUT, strike }, strike - 1n), "ITM");
  assert.equal(verdictOf({ optionType: OptionType.PUT, strike }, strike + 1n), "OTM");
});

test("exactly at the strike pays nothing, and no price gives no verdict", () => {
  assert.equal(verdictOf({ optionType: OptionType.CALL, strike }, strike), "OTM");
  assert.equal(verdictOf({ optionType: OptionType.PUT, strike }, strike), "OTM");
  assert.equal(verdictOf({ optionType: OptionType.CALL, strike }, undefined), "UNKNOWN");
});
