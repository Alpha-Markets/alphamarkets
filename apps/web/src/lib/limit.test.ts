import assert from "node:assert/strict";
import { test } from "node:test";
import { limitDirectionNote, limitExpirySeconds, parseLimitPrice } from "./limit.js";

const WAD = 10n ** 18n;

test("limit prices are exact positive decimals", () => {
  assert.equal(parseLimitPrice("187.5"), "187.5");
  assert.equal(parseLimitPrice(" 190 "), "190");
  for (const bad of ["", "0", "0.0", "-1", "1e3", "abc", "1.2.3", "1,000", "0.0000000000000000001"]) {
    assert.equal(parseLimitPrice(bad), undefined, bad);
  }
});

test("a trigger already on the fill side of the mark is called out", () => {
  const mark = 190n * WAD;
  // A long fills at or below the trigger: a trigger of 195 is reached at a 190 mark.
  assert.match(limitDirectionNote(true, "195", mark) ?? "", /already reached/);
  assert.equal(limitDirectionNote(true, "180", mark), null);
  // A short fills at or above the trigger.
  assert.match(limitDirectionNote(false, "185", mark) ?? "", /already reached/);
  assert.equal(limitDirectionNote(false, "200", mark), null);
  assert.equal(limitDirectionNote(true, undefined, mark), null);
  assert.match(limitDirectionNote(true, "190", mark) ?? "", /already reached/, "equal counts as reached");
});

test("expiry choices map to seconds", () => {
  assert.equal(limitExpirySeconds("1h"), 3_600);
  assert.equal(limitExpirySeconds("7d"), 604_800);
});
