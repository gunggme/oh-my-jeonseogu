import assert from "node:assert/strict";
import { test } from "node:test";
import { planRelease } from "../.github/scripts/release-plan.mjs";

test("first release and newer stable versions are publishable", () => {
  assert.deepEqual(planRelease({ version: "0.2.0" }, null), { version: "0.2.0", publish: true });
  assert.equal(planRelease({ version: "0.10.0" }, { "dist-tags": { latest: "0.9.0" } }).publish, true);
});

test("reruns skip immutable published versions", () => {
  assert.equal(planRelease({ version: "0.2.0" }, { versions: { "0.2.0": {} } }).publish, false);
});

test("latest cannot regress and prereleases cannot enter the stable channel", () => {
  assert.throws(() => planRelease({ version: "0.2.0" }, { "dist-tags": { latest: "0.10.0" } }));
  assert.throws(() => planRelease({ version: "0.3.0-beta.1" }, null));
});
