import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPublished } from "../scripts/verify-published.mjs";

const expected = { name: "oh-my-jeonseogu", version: "0.2.2", integrity: "sha512-expected" };
const published = { name: expected.name, version: expected.version, dist: { integrity: expected.integrity } };
const ready = () => new Response(JSON.stringify(published));

test("accepted publishes can take several minutes to appear in the registry", async () => {
  let time = 0;
  let requests = 0;
  const result = await verifyPublished(expected, {
    now: () => time,
    sleep: async (ms: number) => { time += ms; },
    onRetry: () => {},
    fetchImpl: async () => ++requests < 25 ? new Response(null, { status: 404 }) : ready(),
  });
  assert.deepEqual(result, published);
  assert.equal(time, 240_000);
});

test("registry visibility retries stop at the deadline", async () => {
  let time = 0;
  await assert.rejects(verifyPublished(expected, {
    timeoutMs: 25_000,
    now: () => time,
    sleep: async (ms: number) => { time += ms; },
    onRetry: () => {},
    fetchImpl: async () => new Response(null, { status: 404 }),
  }), /HTTP 404/);
  assert.equal(time, 25_000);
});

test("a visible version with different bytes must fail verification", async () => {
  await assert.rejects(verifyPublished(expected, {
    fetchImpl: async () => new Response(JSON.stringify({ ...published, dist: { integrity: "sha512-wrong" } })),
  }), /differs from the release archive/);
});

test("authentication errors are not mistaken for delayed processing", async () => {
  let requests = 0;
  await assert.rejects(verifyPublished(expected, {
    fetchImpl: async () => { requests++; return new Response(null, { status: 403 }); },
  }), /HTTP 403/);
  assert.equal(requests, 1);
});
