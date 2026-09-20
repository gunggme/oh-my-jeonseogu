import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgv } from "../src/args.js";

describe("parseArgv", () => {
	it("parses positional message", () => {
		const r = parseArgv(["안녕", "전서구"]);
		assert.ok(r.ok);
		assert.equal(r.options.message, "안녕 전서구");
	});

	it("parses flags", () => {
		const r = parseArgv(["-m", "anthropic:claude-x", "--no-delay", "--tools", "-e"]);
		assert.ok(r.ok);
		assert.equal(r.options.model, "anthropic:claude-x");
		assert.equal(r.options.noDelay, true);
		assert.equal(r.options.tools, true);
		assert.equal(r.options.ephemeral, true);
	});

	it("parses --flag=value", () => {
		const r = parseArgv(["--model=openai/gpt-x", "--print=잘가"]);
		assert.ok(r.ok);
		assert.equal(r.options.model, "openai/gpt-x");
		assert.equal(r.options.print, "잘가");
	});

	it("rejects unknown flags and missing values", () => {
		assert.equal(parseArgv(["--nope"]).ok, false);
		assert.equal(parseArgv(["--model"]).ok, false);
	});

	it("treats everything after -- as positional", () => {
		const r = parseArgv(["--", "--not-a-flag"]);
		assert.ok(r.ok);
		assert.equal(r.options.message, "--not-a-flag");
	});
});
