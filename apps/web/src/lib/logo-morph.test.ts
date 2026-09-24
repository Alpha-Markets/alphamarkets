import assert from "node:assert/strict";
import { test } from "node:test";
import art from "./logo-paths.json" with { type: "json" };
import { MORPH_STATES, allStatePaths, maxTravel, statePaths, type LogoArt } from "./logo-morph.js";

const logo = art as unknown as LogoArt;
const commands = (d: string) => d.replace(/-?\d+\.?\d*/g, "#").replace(/#[ ,]?/g, "#");

test("every state has the same path structure as the logo, layer by layer", () => {
  const states = allStatePaths(logo);
  assert.equal(states.length, MORPH_STATES.length);
  for (const paths of states) {
    assert.equal(paths.length, logo.layers.length);
    paths.forEach((d, layer) => {
      assert.equal(commands(d), commands(states[0]![layer]!), `layer ${layer} differs in structure`);
    });
  }
});

test("the first state is the logo as supplied and the others move it", () => {
  const [rest, ...others] = allStatePaths(logo);
  for (const paths of others) assert.notDeepEqual(paths, rest);
  assert.equal(MORPH_STATES[0]!.fields.length, 0);
});

test("states stay recognisably the logo: no outline point moves more than 8% of the width", () => {
  for (const state of MORPH_STATES) {
    assert.ok(maxTravel(logo, state) < 0.08, `${state.name} moves ${(maxTravel(logo, state) * 100).toFixed(1)}%`);
  }
});

test("a state keeps the mark centred", () => {
  const centre = (d: string) => {
    const nums = (d.match(/-?\d+\.?\d*/g) ?? []).map(Number);
    let x = 0;
    let y = 0;
    for (let i = 0; i < nums.length; i += 2) {
      x += nums[i]!;
      y += nums[i + 1]!;
    }
    return [x / (nums.length / 2), y / (nums.length / 2)] as const;
  };
  const [rx, ry] = centre(statePaths(logo, MORPH_STATES[0]!)[0]!);
  for (const state of MORPH_STATES.slice(1)) {
    const [x, y] = centre(statePaths(logo, state)[0]!);
    assert.ok(Math.abs(x - rx) / logo.width < 0.02, `${state.name} drifts in x`);
    assert.ok(Math.abs(y - ry) / logo.height < 0.02, `${state.name} drifts in y`);
  }
});

test("states are deterministic", () => {
  assert.deepEqual(allStatePaths(logo), allStatePaths(logo));
});
