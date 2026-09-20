/**
 * Incremental splitter for multi-message replies.
 *
 * The model writes one reply as several chat-style messages separated by a
 * line containing only "---". Deltas arrive piecemeal, so the splitter holds
 * back a trailing partial line that could still grow into a delimiter, and
 * ignores delimiters inside fenced code blocks.
 */
export type SplitEvent = { type: "text"; text: string } | { type: "boundary" };

/** A complete line that is only dashes (3+) and whitespace. */
const DELIMITER_LINE = /^[ \t]*-{3,}[ \t]*$/;
/** A partial line that could still become a delimiter (only spaces/tabs/dashes so far). */
const DELIMITER_PREFIX = /^[ \t]*-*$/;
/** A line opening or closing a fenced code block (\x60 is a backtick). */
const FENCE_LINE = /^[ \t]*([\x60]{3,}|~{3,})/;

export class MessageSplitter {
	private buffer = "";
	/** How many chars of the current (partial) last line were already emitted. */
	private emittedInLine = 0;
	private fenceChar: string | null = null;
	private fenceLen = 0;

	/** Feed a streamed delta; returns displayable text and boundary events. */
	feed(delta: string): SplitEvent[] {
		this.buffer += delta;
		const events: SplitEvent[] = [];
		this.processCompleteLines(events);
		this.emitPartialLine(events);
		return events;
	}

	/** Flush remaining buffered text at end of the assistant message. */
	end(): SplitEvent[] {
		const events: SplitEvent[] = [];
		if (this.buffer.length > 0) {
			const line = this.buffer;
			this.buffer = "";
			this.processLine(line, events, false);
			this.emittedInLine = 0;
		}
		return events;
	}

	reset(): void {
		this.buffer = "";
		this.emittedInLine = 0;
		this.fenceChar = null;
		this.fenceLen = 0;
	}

	private processCompleteLines(events: SplitEvent[]): void {
		let idx = this.buffer.indexOf("\n");
		while (idx !== -1) {
			const line = this.buffer.slice(0, idx);
			this.buffer = this.buffer.slice(idx + 1);
			this.processLine(line, events, true);
			this.emittedInLine = 0;
			idx = this.buffer.indexOf("\n");
		}
	}

	private processLine(line: string, events: SplitEvent[], hasNewline: boolean): void {
		if (!this.fenceChar && DELIMITER_LINE.test(line)) {
			events.push({ type: "boundary" });
			return;
		}
		this.updateFence(line);
		const text = line.slice(this.emittedInLine) + (hasNewline ? "\n" : "");
		if (text) events.push({ type: "text", text });
	}

	private updateFence(line: string): void {
		const m = FENCE_LINE.exec(line);
		if (!m) return;
		const marker = m[1]!;
		const ch = marker[0]!;
		if (!this.fenceChar) {
			this.fenceChar = ch;
			this.fenceLen = marker.length;
		} else if (ch === this.fenceChar && marker.length >= this.fenceLen) {
			this.fenceChar = null;
			this.fenceLen = 0;
		}
	}

	private emitPartialLine(events: SplitEvent[]): void {
		if (this.buffer.length === 0) return;
		// Hold text that could still turn into a delimiter line.
		if (!this.fenceChar && DELIMITER_PREFIX.test(this.buffer)) return;
		const text = this.buffer.slice(this.emittedInLine);
		if (text) {
			events.push({ type: "text", text });
			this.emittedInLine = this.buffer.length;
		}
	}
}
