import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageSplitter, type SplitEvent } from "../src/splitter.js";

/** Feed a whole string at once and collect events including the final flush. */
function run(input: string): SplitEvent[] {
	const s = new MessageSplitter();
	return [...s.feed(input), ...s.end()];
}

/** Feed input in fixed-size chunks, like network deltas. */
function runChunked(input: string, size: number): SplitEvent[] {
	const s = new MessageSplitter();
	const events: SplitEvent[] = [];
	for (let i = 0; i < input.length; i += size) events.push(...s.feed(input.slice(i, i + size)));
	events.push(...s.end());
	return events;
}

/** Reassemble text events into messages split on boundaries. */
function messages(events: SplitEvent[]): string[] {
	const msgs: string[] = [];
	let cur = "";
	for (const ev of events) {
		if (ev.type === "boundary") {
			msgs.push(cur);
			cur = "";
		} else {
			cur += ev.text;
		}
	}
	msgs.push(cur);
	return msgs;
}

describe("MessageSplitter", () => {
	it("passes a single message through", () => {
		assert.deepEqual(messages(run("만들어라")), ["만들어라"]);
	});

	it("splits on a --- line", () => {
		assert.deepEqual(messages(run("만들어라\n---\n재밌겠네")), ["만들어라\n", "재밌겠네"]);
	});

	it("splits many short messages", () => {
		assert.deepEqual(messages(run("그럼이제\n---\n중첩상태\n---\n모름")), [
			"그럼이제\n",
			"중첩상태\n",
			"모름",
		]);
	});

	it("handles delimiter split across deltas", () => {
		const s = new MessageSplitter();
		const events = [...s.feed("첫째\n-"), ...s.feed("--"), ...s.feed("\n둘째"), ...s.end()];
		assert.deepEqual(messages(events), ["첫째\n", "둘째"]);
	});

	it("does not split on -- (only two dashes)", () => {
		assert.deepEqual(messages(run("a\n--\nb")), ["a\n--\nb"]);
	});

	it("accepts longer dash runs and padded delimiters", () => {
		assert.deepEqual(messages(run("a\n-----\nb")), ["a\n", "b"]);
		assert.deepEqual(messages(run("a\n  ---  \nb")), ["a\n", "b"]);
	});

	it("ignores delimiters inside fenced code", () => {
		const input = "코드:\n\x60\x60\x60yaml\n---\nkey: 1\n\x60\x60\x60\n끝";
		assert.deepEqual(messages(run(input)), ["코드:\n\x60\x60\x60yaml\n---\nkey: 1\n\x60\x60\x60\n끝"]);
	});

	it("resumes splitting after the fence closes", () => {
		const input = "\x60\x60\x60\n---\n\x60\x60\x60\n---\n밖";
		assert.deepEqual(messages(run(input)), ["\x60\x60\x60\n---\n\x60\x60\x60\n", "밖"]);
	});

	it("is chunk-size agnostic", () => {
		const input = "개발 이야기좀\n---\n해볼까\n---\n유지보수성이 떨어지기에 HFSM으로 상태를 관리할것입니다";
		const expected = messages(run(input));
		for (const size of [1, 2, 3, 5, 7]) {
			assert.deepEqual(messages(runChunked(input, size)), expected, "chunk size " + size);
		}
	});

	it("keeps a lone dash prefix as text when it never becomes a delimiter", () => {
		const s = new MessageSplitter();
		const events = [...s.feed("a\n--"), ...s.feed("x"), ...s.end()];
		assert.deepEqual(messages(events), ["a\n--x"]);
	});

	it("emits an empty trailing message after a final delimiter", () => {
		// Trailing "---" produces a boundary; the empty tail is the printer's
		// problem, not extra text.
		assert.deepEqual(messages(run("a\n---\n")), ["a\n", ""]);
	});
});
