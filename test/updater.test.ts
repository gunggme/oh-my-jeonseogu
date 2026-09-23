import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { checkForUpdates, isNewer } from "../src/updater.js";

function isolatedCache(t: TestContext): string {
	const dir = mkdtempSync(join(tmpdir(), "jeonseogu-update-test-"));
	const envKey = process.platform === "win32" ? "LOCALAPPDATA" : "XDG_CACHE_HOME";
	const previous = process.env[envKey];
	process.env[envKey] = dir;
	t.after(() => {
		if (previous === undefined) delete process.env[envKey];
		else process.env[envKey] = previous;
		rmSync(dir, { recursive: true, force: true });
	});
	mkdirSync(join(dir, "oh-my-jeonseogu"));
	return join(dir, "oh-my-jeonseogu", "update.json");
}

test("isNewer compares semver numerically", () => {
	assert.equal(isNewer("0.74.0", "0.73.1"), true);
	assert.equal(isNewer("0.73.2", "0.73.1"), true);
	assert.equal(isNewer("1.0.0", "0.73.1"), true);
	assert.equal(isNewer("0.73.1", "0.73.1"), false);
	assert.equal(isNewer("0.73.0", "0.73.1"), false);
	assert.equal(isNewer("0.9.9", "0.10.0"), false); // numeric, not lexical
	assert.equal(isNewer("0.10.0", "0.9.9"), true);
});

test("refreshes legacy pi cache from the maintained package and reuses the new cache", async (t) => {
	const cache = isolatedCache(t);
	const checkedAt = Date.now();
	writeFileSync(cache, JSON.stringify({ checkedAt, selfLatest: "0.2.0", piLatest: "0.73.1" }));
	const fetchMock = t.mock.method(globalThis, "fetch", async (url: string) => {
		assert.equal(url, "https://registry.npmjs.org/%40earendil-works%2Fpi-coding-agent/latest");
		return Response.json({ version: "0.87.1" });
	});

	const info = await checkForUpdates("0.2.0", "0.73.1");
	assert.deepEqual(info, {
		self: { current: "0.2.0", latest: "0.2.0" },
		pi: { current: "0.73.1", latest: "0.87.1" },
	});
	assert.deepEqual(JSON.parse(readFileSync(cache, "utf8")), {
		checkedAt, selfLatest: "0.2.0", piPackage: "@earendil-works/pi-coding-agent", piLatest: "0.87.1",
	});
	assert.equal(await checkForUpdates("0.2.0", "0.87.1"), null);
	assert.equal(fetchMock.mock.callCount(), 1);
});

test("refreshes an expired cache and detects pi minor-version updates", async (t) => {
	const cache = isolatedCache(t);
	writeFileSync(cache, JSON.stringify({
		checkedAt: Date.now() - 25 * 60 * 60 * 1000,
		selfLatest: "0.2.0", piPackage: "@earendil-works/pi-coding-agent", piLatest: "0.87.1",
	}));
	const fetchMock = t.mock.method(globalThis, "fetch", async (url: string) => {
		const pkg = decodeURIComponent(new URL(url).pathname.slice(1, -"/latest".length));
		assert.ok(["oh-my-jeonseogu", "@earendil-works/pi-coding-agent"].includes(pkg));
		return Response.json({ version: pkg === "oh-my-jeonseogu" ? "0.2.0" : "0.88.0" });
	});

	assert.deepEqual(await checkForUpdates("0.2.0", "0.87.1"), {
		self: { current: "0.2.0", latest: "0.2.0" },
		pi: { current: "0.87.1", latest: "0.88.0" },
	});
	assert.equal(fetchMock.mock.callCount(), 2);
});

test("registry failures do not prevent startup or preserve legacy pi data as current", async (t) => {
	const cache = isolatedCache(t);
	writeFileSync(cache, JSON.stringify({ checkedAt: Date.now(), selfLatest: "0.2.0", piLatest: "0.73.1" }));
	const fetchMock = t.mock.method(globalThis, "fetch", async () => {
		throw new Error("offline");
	});

	assert.equal(await checkForUpdates("0.2.0", "0.87.1"), null);
	assert.equal(JSON.parse(readFileSync(cache, "utf8")).piLatest, undefined);
	assert.equal(await checkForUpdates("0.2.0", "0.87.1"), null);
	assert.equal(fetchMock.mock.callCount(), 2);
});
