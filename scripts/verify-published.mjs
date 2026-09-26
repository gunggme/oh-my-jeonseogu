import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const archive = process.argv[2];
assert.ok(archive, "Usage: node scripts/verify-published.mjs <published.tgz>");
const integrity = "sha512-" + createHash("sha512").update(readFileSync(archive)).digest("base64");
const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${pkg.version}`;

for (let attempt = 0; ; attempt++) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (response.status === 404 && attempt < 5) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    continue;
  }
  assert.ok(response.ok, `Registry verification failed: HTTP ${response.status}`);
  const published = await response.json();
  assert.equal(published.name, pkg.name);
  assert.equal(published.version, pkg.version);
  assert.equal(published.dist?.integrity, integrity, "Registry tarball differs from the release archive");
  console.log(`Verified npm registry integrity: ${pkg.name}@${pkg.version}`);
  break;
}
