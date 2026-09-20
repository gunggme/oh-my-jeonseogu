import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewer } from "../src/updater.js";

test("isNewer compares semver numerically", () => {
	assert.equal(isNewer("0.74.0", "0.73.1"), true);
	assert.equal(isNewer("0.73.2", "0.73.1"), true);
	assert.equal(isNewer("1.0.0", "0.73.1"), true);
	assert.equal(isNewer("0.73.1", "0.73.1"), false);
	assert.equal(isNewer("0.73.0", "0.73.1"), false);
	assert.equal(isNewer("0.9.9", "0.10.0"), false); // numeric, not lexical
	assert.equal(isNewer("0.10.0", "0.9.9"), true);
});
