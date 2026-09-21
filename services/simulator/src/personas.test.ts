import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, ROSTER, type DecisionContext, type MarketView, type Persona } from "./personas.js";
import { createRng } from "./prng.js";

const market = (symbol: string, returnPct = 0, maxLeverage = 10, maxNotional = 250_000): MarketView => ({ symbol, price: 100, returnPct, maxLeverage, maxNotional });
const base: DecisionContext = { now: 1_000_000, markets: [market("NVDA")], open: [], available: 50_000 };
const trader = (overrides: Partial<Persona> = {}): Persona => ({
  id: "t", symbols: ["NVDA"], collateral: [500, 1_000], leverage: [3], maxOpen: 1, holdMs: [60_000, 120_000], everyMs: [1_000, 2_000],
  side: { kind: "fixed", side: "LONG" }, txPerHour: 10, depositUsd: 10_000, ...overrides,
});

test("with nothing open it opens a position that respects the persona", () => {
  const action = decide(trader(), base, createRng(1));
  assert.equal(action.kind, "open");
  if (action.kind !== "open") return;
  assert.equal(action.symbol, "NVDA");
  assert.equal(action.side, "LONG");
  assert.equal(action.leverage, 3);
  assert.ok(action.collateral >= 500 && action.collateral <= 1_000);
  assert.equal(action.collateral % 50, 0);
});

test("it never asks for more leverage than the market allows", () => {
  const action = decide(trader({ leverage: [5, 10] }), { ...base, markets: [market("NVDA", 0, 3)] }, createRng(1));
  assert.equal(action.kind, "wait");
});

test("a position stays under the market's size cap", () => {
  const action = decide(trader({ collateral: [500, 60_000] }), { ...base, markets: [market("NVDA", 0, 10, 100_000)] }, createRng(1));
  assert.equal(action.kind, "open");
  if (action.kind === "open") assert.ok(action.collateral * action.leverage <= 0.6 * 100_000);
});

test("it skips a market whose cap is too small for any position it would open", () => {
  const action = decide(trader({ collateral: [50_000, 60_000] }), { ...base, markets: [market("NVDA", 0, 10, 100_000)] }, createRng(1));
  assert.equal(action.kind, "wait");
});

test("it does not open with more margin than the vault holds", () => {
  const action = decide(trader(), { ...base, available: 100 }, createRng(1));
  assert.equal(action.kind, "wait");
});

test("it waits while it holds its maximum number of positions", () => {
  const open = [{ id: 1n, symbol: "NVDA", side: "LONG" as const, pnlPct: 1, openedAt: base.now - 1_000 }];
  assert.equal(decide(trader(), { ...base, open }, createRng(1)).kind, "wait");
});

test("it takes profit and cuts loss at the persona's limits", () => {
  const p = trader({ takeProfitPct: 20, stopLossPct: 10 });
  const at = (pnlPct: number) => ({ ...base, open: [{ id: 7n, symbol: "NVDA", side: "LONG" as const, pnlPct, openedAt: base.now - 1_000 }] });
  assert.deepEqual(decide(p, at(25), createRng(1)), { kind: "close", id: 7n, reason: "take profit" });
  assert.deepEqual(decide(p, at(-12), createRng(1)), { kind: "close", id: 7n, reason: "stop loss" });
});

test("a persona without a stop rides a loss, and never closes before its minimum hold", () => {
  const p = trader({ takeProfitPct: 50 });
  const held = (age: number, pnlPct: number) => ({ ...base, open: [{ id: 7n, symbol: "NVDA", side: "LONG" as const, pnlPct, openedAt: base.now - age }] });
  assert.equal(decide(p, held(1_000, -80), createRng(1)).kind, "wait");
  assert.equal(decide(p, held(500_000, -80), createRng(1)).kind, "close"); // past the maximum hold
});

test("trend followers go with the move and reverters against it, and both wait for a move", () => {
  const up = { ...base, markets: [market("NVDA", 0.3)] };
  const flat = { ...base, markets: [market("NVDA", 0.01)] };
  const momentum = trader({ side: { kind: "momentum", minMovePct: 0.1 } });
  const contrarian = trader({ side: { kind: "contrarian", minMovePct: 0.1 } });
  const side = (p: Persona, ctx: DecisionContext) => {
    const action = decide(p, ctx, createRng(1));
    return action.kind === "open" ? action.side : action.kind;
  };
  assert.equal(side(momentum, up), "LONG");
  assert.equal(side(contrarian, up), "SHORT");
  assert.equal(side(momentum, flat), "wait");
  assert.equal(side(contrarian, flat), "wait");
});

test("the roster covers what a demo needs", () => {
  assert.equal(new Set(ROSTER.map((p) => p.id)).size, ROSTER.length);
  const degens = ROSTER.filter((p) => p.side.kind === "fixed");
  assert.deepEqual(degens.map((p) => p.side.kind === "fixed" && p.side.side).sort(), ["LONG", "SHORT"]);
  for (const degen of degens) {
    assert.equal(degen.stopLossPct, undefined, "a degen takes no stop, so a move against it liquidates it");
    assert.deepEqual(degen.leverage, [10]);
  }
  for (const persona of ROSTER) assert.ok(persona.collateral[0] <= persona.collateral[1] && persona.depositUsd >= persona.collateral[1] * 2);
});
