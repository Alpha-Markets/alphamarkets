import assert from "node:assert/strict";
import { test } from "node:test";
import { BaseError, encodeErrorResult, UserRejectedRequestError } from "viem";
import { allErrorsAbi } from "./abis.js";
import {
  InsufficientMarginError,
  mapError,
  MarketPausedError,
  AlphaMarketsContractError,
  SlippageExceededError,
  StaleOraclePriceError,
  UserRejectedError,
} from "./errors.js";

function revertWith(errorName: string, args?: readonly unknown[]) {
  const data = encodeErrorResult({ abi: allErrorsAbi, errorName, args } as Parameters<typeof encodeErrorResult>[0]);
  return new BaseError("call failed", { cause: Object.assign(new Error("execution reverted"), { data }) });
}

test("Section 36 custom errors map to typed classes", () => {
  assert.ok(mapError(revertWith("StaleOraclePrice")) instanceof StaleOraclePriceError);
  assert.ok(mapError(revertWith("InsufficientMargin")) instanceof InsufficientMarginError);
});

test("decoded args are exposed", () => {
  const mapped = mapError(revertWith("SlippageExceeded", [100n, 105n]));
  assert.ok(mapped instanceof SlippageExceededError);
  assert.equal(mapped.errorName, "SlippageExceeded");
  assert.deepEqual(mapped.args, [100n, 105n]);
});

test("an unmapped but decodable error becomes a generic AlphaMarketsContractError", () => {
  const mapped = mapError(revertWith("ZeroAddress"));
  assert.ok(mapped instanceof AlphaMarketsContractError);
  assert.equal(mapped.constructor, AlphaMarketsContractError);
});

test("MarketPaused carries the market id", () => {
  const marketId = `0x${"11".repeat(32)}` as const;
  const mapped = mapError(revertWith("MarketPaused", [marketId]));
  assert.ok(mapped instanceof MarketPausedError);
  assert.deepEqual(mapped.args, [marketId]);
});

test("wallet rejection becomes UserRejectedError", () => {
  const rejection = new BaseError("rejected", { cause: new UserRejectedRequestError(new Error("no")) });
  assert.ok(mapError(rejection) instanceof UserRejectedError);
});

test("unrecognised errors pass through unchanged", () => {
  const plain = new Error("boom");
  assert.equal(mapError(plain), plain);
  const unknownRevert = new BaseError("x", { cause: Object.assign(new Error("y"), { data: "0xdeadbeef" }) });
  assert.equal(mapError(unknownRevert), unknownRevert);
});
