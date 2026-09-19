import assert from "node:assert/strict";
import { test } from "node:test";
import { stringToHex } from "viem";
import { OptionType } from "@orionis/types";
import { expiryCode, optionCode } from "./options.js";

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
