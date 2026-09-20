import assert from "node:assert/strict";
import { test } from "node:test";
import { mapArgs } from "../src/args.js";

test("injects isolation defaults by default", () => {
	const m = mapArgs([]);
	assert.deepEqual(m.prepend, ["--no-tools", "--no-extensions", "--no-skills", "--no-context-files"]);
	assert.deepEqual(m.rest, []);
	assert.equal(m.userPrompt, false);
	assert.equal(m.persona, undefined);
});

test("consumes --persona (both forms) and keeps the rest", () => {
	const m = mapArgs(["--persona", "custom.md", "안녕"]);
	assert.equal(m.persona, "custom.md");
	assert.deepEqual(m.rest, ["안녕"]);

	const m2 = mapArgs(["--persona=custom.md"]);
	assert.equal(m2.persona, "custom.md");
});

test("does not inject --no-tools when the user picks tools", () => {
	for (const flag of ["--tools", "-t", "--no-tools", "-nt", "--no-builtin-tools", "-nbt"]) {
		const m = mapArgs([flag, "read"]);
		assert.ok(!m.prepend.includes("--no-tools"), flag);
	}
});

test("keeps skills/extensions enabled when the user includes one explicitly", () => {
	for (const flag of ["--skill", "--extension", "-e"]) {
		const m = mapArgs([flag, "foo/index.ts"]);
		assert.ok(!m.prepend.includes("--no-skills"), flag);
		assert.ok(!m.prepend.includes("--no-extensions"), flag);
	}
});

test("always disables context files", () => {
	const m = mapArgs(["--tools", "read", "--skill", "foo"]);
	assert.ok(m.prepend.includes("--no-context-files"));
});

test("detects user-provided prompt flags", () => {
	for (const flag of ["--system-prompt", "--append-system-prompt"]) {
		const m = mapArgs([flag, "you are x"]);
		assert.equal(m.userPrompt, true, flag);
	}
});

test("passes pi-native flags through in order", () => {
	const m = mapArgs(["--model", "anthropic/claude-opus-4-5", "-c", "안녕"]);
	assert.deepEqual(m.rest, ["--model", "anthropic/claude-opus-4-5", "-c", "안녕"]);
});
