import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { DEFAULT_CORS_ORIGINS, parseOrigins, registerCors } from "./cors.js";

async function app(origins?: string) {
  const instance = Fastify();
  registerCors(instance, origins);
  instance.get("/v1/markets", async () => []);
  return instance;
}

test("parses a comma list, trims and drops trailing slashes", () => {
  assert.deepEqual(parseOrigins(" https://a.example/ , https://b.example "), ["https://a.example", "https://b.example"]);
  assert.deepEqual(parseOrigins(undefined), [DEFAULT_CORS_ORIGINS]);
});

test("an allowed origin gets the CORS header", async () => {
  const server = await app("https://app.example");
  const response = await server.inject({ url: "/v1/markets", headers: { origin: "https://app.example" } });
  assert.equal(response.headers["access-control-allow-origin"], "https://app.example");
});

test("an unlisted origin gets no CORS header, so the browser blocks the read", async () => {
  const server = await app("https://app.example");
  const response = await server.inject({ url: "/v1/markets", headers: { origin: "https://evil.example" } });
  assert.equal(response.headers["access-control-allow-origin"], undefined);
});

test("preflight for a JSON POST succeeds for an allowed origin", async () => {
  const server = await app("https://app.example");
  const response = await server.inject({
    method: "OPTIONS",
    url: "/v1/options/quote",
    headers: {
      origin: "https://app.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  assert.equal(response.statusCode, 204);
  assert.match(String(response.headers["access-control-allow-methods"]), /POST/);
});
