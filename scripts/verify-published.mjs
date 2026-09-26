import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function verifyPublished(expected, {
  fetchImpl = fetch,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  now = Date.now,
  timeoutMs = 10 * 60_000,
  pollIntervalMs = 10_000,
  onRetry = console.log,
} = {}) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(expected.name)}/${expected.version}`;
  const deadline = now() + timeoutMs;
  for (;;) {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    // npm can accept a publish before the version is visible in its registry.
    if (response.status === 404 && now() < deadline) {
      onRetry(`npm is still processing ${expected.name}@${expected.version}; waiting for registry visibility.`);
      await sleep(Math.min(pollIntervalMs, deadline - now()));
      continue;
    }
    assert.ok(response.ok, `Registry verification failed: HTTP ${response.status}`);
    const published = await response.json();
    assert.equal(published.name, expected.name);
    assert.equal(published.version, expected.version);
    assert.equal(published.dist?.integrity, expected.integrity, "Registry tarball differs from the release archive");
    return published;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const archive = process.argv[2];
  assert.ok(archive, "Usage: node scripts/verify-published.mjs <published.tgz>");
  const integrity = "sha512-" + createHash("sha512").update(readFileSync(archive)).digest("base64");
  await verifyPublished({ name: pkg.name, version: pkg.version, integrity });
  console.log(`Verified npm registry integrity: ${pkg.name}@${pkg.version}`);
}
