import type { SplitEvent } from "./splitter.js";

const BIRD = "\u{1F426}"; // bird emoji
const INDENT = "   "; // aligns under the bird prefix
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PrinterOptions {
	/** Pause briefly between messages, like separate chat sends. */
	delays: boolean;
	minDelayMs?: number;
	maxDelayMs?: number;
	out?: NodeJS.WritableStream;
}

/**
 * Renders split message events to the terminal. Each message gets a bird
 * prefix; continuation lines are indented to align under the text.
 * Writes are chained so inter-message delays never interleave output.
 */
export class ChatPrinter {
	private chain: Promise<void> = Promise.resolve();
	private open = false;
	private needsDelay = false;
	private atLineStart = true;
	/** A newline was written inside a message; indent the next text chunk. */
	private pendingIndent = false;

	constructor(private opts: PrinterOptions) {}

	handle(ev: SplitEvent): void {
		this.chain = this.chain.then(() => this.apply(ev));
	}

	/** Wait until every queued write/delay has been flushed. */
	drain(): Promise<void> {
		return this.chain;
	}

	/** Close any open message (call when the assistant turn ends). */
	finish(): void {
		this.chain = this.chain.then(() => {
			if (this.open && !this.atLineStart) this.write("\n");
			this.open = false;
			this.needsDelay = false;
			this.pendingIndent = false;
		});
	}

	/** Print a dim system note, closing any open message first. */
	note(text: string): void {
		this.chain = this.chain.then(() => {
			if (this.open && !this.atLineStart) this.write("\n");
			this.open = false;
			this.atLineStart = true;
			this.pendingIndent = false;
			this.write(DIM + text + RESET + "\n");
		});
	}

	error(text: string): void {
		this.chain = this.chain.then(() => {
			if (this.open && !this.atLineStart) this.write("\n");
			this.open = false;
			this.atLineStart = true;
			this.pendingIndent = false;
			this.write(RED + text + RESET + "\n");
		});
	}

	private write(s: string): void {
		(this.opts.out ?? process.stdout).write(s);
	}

	private async apply(ev: SplitEvent): Promise<void> {
		if (ev.type === "boundary") {
			if (this.open && !this.atLineStart) this.write("\n");
			this.open = false;
			this.atLineStart = true;
			this.pendingIndent = false;
			this.needsDelay = true;
			return;
		}
		if (!ev.text) return;
		if (!this.open) {
			if (this.needsDelay && this.opts.delays) {
				const min = this.opts.minDelayMs ?? 250;
				const max = this.opts.maxDelayMs ?? 650;
				await sleep(min + Math.random() * (max - min));
			}
			this.write(YELLOW + BIRD + RESET + " ");
			this.open = true;
			this.needsDelay = false;
			this.atLineStart = false;
			this.pendingIndent = false;
		}
		this.writeMessageText(ev.text);
	}

	/** Write message text; lines after the first are indented under the prefix. */
	private writeMessageText(text: string): void {
		let i = 0;
		while (i < text.length) {
			const nl = text.indexOf("\n", i);
			const chunk = nl === -1 ? text.slice(i) : text.slice(i, nl);
			if (chunk) {
				if (this.pendingIndent) {
					this.write(INDENT);
					this.pendingIndent = false;
				}
				this.write(chunk);
				this.atLineStart = false;
			}
			if (nl === -1) break;
			this.write("\n");
			this.atLineStart = true;
			this.pendingIndent = true;
			i = nl + 1;
		}
	}
}
