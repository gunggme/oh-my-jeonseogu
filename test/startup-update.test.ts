import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { chooseUpdate, runStartupUpdate, shouldPromptForUpdate, type UpdateChoice } from "../src/startup-update.js";
import type { UpdateInfo } from "../src/updater.js";

const info: UpdateInfo = {
	self: { current: "0.2.3", latest: "0.2.4" },
	pi: { current: "0.87.1", latest: "0.88.0" },
};

function actions(choice: UpdateChoice = "skip") {
	const calls: string[] = [];
	return {
		calls,
		check: async (): Promise<UpdateInfo | null> => { calls.push("check"); return info; },
		choose: async (): Promise<UpdateChoice> => { calls.push("choose"); return choice; },
		install: async (): Promise<boolean> => { calls.push("install"); return true; },
		dismiss: (): boolean => { calls.push("dismiss"); return true; },
		write: (message: string): void => { calls.push(message); },
	};
}

test("updates are offered only before interactive conversations", () => {
	for (const args of [[], ["--model", "gpt-5.5"], ["--mode", "text"], ["-c"], ["--", "안녕"]]) {
		assert.equal(shouldPromptForUpdate(args, true, true), true, JSON.stringify(args));
		assert.equal(shouldPromptForUpdate(args, false, true), false);
		assert.equal(shouldPromptForUpdate(args, true, false), false);
	}
	for (const args of [
		["--print"], ["-p", "안녕"], ["--mode", "json"], ["--mode", "rpc"], ["--offline"],
		["--help"], ["-h"], ["--version"], ["-v"], ["--list-models"], ["--list-models", "gpt"],
		["--export", "session.jsonl"], ["--mode", "invalid"],
		...["auth", "config", "install", "remove", "update", "list"].map((command) => [command]),
	]) assert.equal(shouldPromptForUpdate(args, true, true), false, JSON.stringify(args));
});

test("no update and failed discovery never ask or install", async () => {
	for (const check of [async () => null, async () => { throw new Error("offline"); }]) {
		const a = actions();
		a.check = check;
		assert.equal(await runStartupUpdate("0.2.3", "0.87.1", a), "continue");
		assert.deepEqual(a.calls, []);
	}
});

test("pi's offline environment setting also suppresses update checks", () => {
	const previous = process.env.PI_OFFLINE;
	try {
		for (const value of ["1", "true", "YES"]) {
			process.env.PI_OFFLINE = value;
			assert.equal(shouldPromptForUpdate([], true, true), false);
		}
		process.env.PI_OFFLINE = "0";
		assert.equal(shouldPromptForUpdate([], true, true), true);
	} finally {
		if (previous === undefined) delete process.env.PI_OFFLINE;
		else process.env.PI_OFFLINE = previous;
	}
});

test("skip continues without installing or persisting a dismissal", async () => {
	const a = actions("skip");
	assert.equal(await runStartupUpdate("0.2.3", "0.87.1", a), "continue");
	assert.deepEqual(a.calls, ["check", "choose"]);
});

test("dismiss persists only after explicit selection and continues", async () => {
	const a = actions("dismiss");
	assert.equal(await runStartupUpdate("0.2.3", "0.87.1", a), "continue");
	assert.deepEqual(a.calls, ["check", "choose", "dismiss"]);
	const failedSave = actions("dismiss");
	failedSave.dismiss = () => false;
	assert.equal(await runStartupUpdate("0.2.3", "0.87.1", failedSave), "continue");
	assert.match(failedSave.calls.at(-1)!, /저장하지 못했습니다/);
	assert.ok(!failedSave.calls.includes("install"));
});

test("explicit update installs once and exits with a restart instruction", async () => {
	const a = actions("update");
	assert.equal(await runStartupUpdate("0.2.3", "0.87.1", a), "updated");
	assert.deepEqual(a.calls.slice(0, 2), ["check", "choose"]);
	assert.equal(a.calls.filter((call) => call === "install").length, 1);
	assert.match(a.calls.at(-1)!, /jeonseogu를 다시 실행/);
});

test("install errors never report success or start the already loaded old version", async () => {
	for (const install of [async () => false, async () => { throw new Error("ENOENT"); }]) {
		const a = actions("update");
		a.install = install;
		assert.equal(await runStartupUpdate("0.2.3", "0.87.1", a), "failed");
		assert.match(a.calls.at(-1)!, /실패.*npm i -g/);
		assert.ok(!a.calls.some((call) => call.includes("업데이트 완료")));
	}
});

test("picker handles navigation, numeric choices, cancellation and restores terminal state", async () => {
	const cases: [string, UpdateChoice][] = [
		["\r", "update"], ["\x1b[B\r", "skip"], ["\x1b[A\r", "dismiss"],
		["jj\r", "dismiss"], ["1", "update"], ["2", "skip"], ["3", "dismiss"],
		["\x1b", "skip"], ["\x03", "skip"], ["\x04", "skip"],
	];
	for (const [keys, expected] of cases) {
		const input = Object.assign(new PassThrough(), {
			isRaw: false,
			setRawMode(mode: boolean) { this.isRaw = mode; },
		});
		const output = new PassThrough();
		let screen = "";
		output.on("data", (chunk) => { screen += chunk.toString(); });
		const selected = chooseUpdate(info, input, output);
		assert.equal(input.isRaw, true);
		assert.match(screen, /v0\.2\.3 → v0\.2\.4/);
		assert.match(screen, /pi v0\.87\.1 → v0\.88\.0/);
		input.write(keys);
		assert.equal(await selected, expected);
		assert.equal(input.isRaw, false);
		assert.equal(input.isPaused(), true);
		assert.equal(input.listenerCount("keypress"), 0);
		assert.equal(output.listenerCount("resize"), 0);
		assert.ok(screen.endsWith("\x1b[?25h\x1b[?1049l"));
		input.destroy();
		output.destroy();
	}
});
