import assert from "node:assert/strict";
import { test } from "node:test";
import { pyramidGeometry, stackLayers } from "./stack.js";

const context = { chainName: "Test Chain", chainId: 7, explorerUrl: "https://explorer.example", vaultUrl: "https://explorer.example/address/0x1" };

test("the stack has five layers, each with copy", () => {
  const layers = stackLayers(context);
  assert.equal(layers.length, 5);
  for (const layer of layers) {
    assert.ok(layer.name && layer.role && layer.tech.length > 0);
  }
});

test("the chain layer takes its name and ID from the context", () => {
  const chain = stackLayers(context).at(-1)!;
  assert.deepEqual(chain.tech.slice(0, 2), ["Test Chain", "Chain ID 7"]);
});

test("links to the explorer appear only when one is configured", () => {
  const without = stackLayers({ chainName: "Test Chain", chainId: 7 });
  assert.equal(without.find((layer) => layer.name === "Smart contracts")!.link, undefined);
  assert.equal(without.at(-1)!.link, undefined);
  assert.equal(stackLayers(context).find((layer) => layer.name === "Smart contracts")!.link?.href, context.vaultUrl);
});

test("the pyramid fills its box, apex at a point and base at full width", () => {
  const layers = pyramidGeometry(5, 300, 240);
  assert.equal(layers.length, 5);
  assert.equal(layers[0]!.face.top, 0);
  assert.equal(layers[0]!.ledge, undefined);
  assert.equal(layers[0]!.face.y0, 0);
  assert.ok(Math.abs(layers.at(-1)!.face.bottom - 300) < 1e-9);
  assert.ok(Math.abs(layers.at(-1)!.face.y1 - 240) < 1e-9);
});

test("every slice starts where the one above ends, and each ledge juts past the layer above", () => {
  const layers = pyramidGeometry(5, 300, 240);
  for (let index = 1; index < layers.length; index++) {
    const above = layers[index - 1]!.face;
    const { ledge, face } = layers[index]!;
    assert.ok(ledge);
    assert.ok(Math.abs(ledge.y0 - above.y1) < 1e-9, "ledge starts under the face above");
    assert.ok(Math.abs(ledge.top - above.bottom) < 1e-9, "ledge starts as wide as the face above");
    assert.ok(Math.abs(face.y0 - ledge.y1) < 1e-9, "face starts under its ledge");
    assert.ok(Math.abs(face.top - ledge.bottom) < 1e-9, "face starts as wide as its ledge");
    assert.ok(ledge.bottom > ledge.top, "the ledge widens");
  }
});
