import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function planRelease(pkg, registry) {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "Use a stable x.y.z version for the latest channel");
  if (registry?.versions?.[pkg.version]) return { version: pkg.version, publish: false };
  const latest = registry?.["dist-tags"]?.latest;
  if (latest) {
    assert.match(latest, /^\d+\.\d+\.\d+$/, "Unexpected registry latest version");
    const currentParts = pkg.version.split(".").map(Number);
    const latestParts = latest.split(".").map(Number);
    const difference = currentParts.map((value, index) => value - latestParts[index]).find((value) => value !== 0);
    assert.ok(difference > 0, `Version ${pkg.version} must be newer than npm latest ${latest}`);
  }
  return { version: pkg.version, publish: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.env.GITHUB_OUTPUT, "Run this script in GitHub Actions");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  // Only a real 404 means a first release. Authentication/network/server errors fail closed.
  if (!response.ok && response.status !== 404) throw new Error(`npm registry returned ${response.status}`);
  const plan = planRelease(pkg, response.status === 404 ? null : await response.json());
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${plan.version}\npublish=${plan.publish}\n`);
  console.log(plan.publish ? `New release: ${pkg.name}@${plan.version}` : `${pkg.name}@${plan.version} is already published; skipping.`);
}
