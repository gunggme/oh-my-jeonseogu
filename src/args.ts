/**
 * Maps jeonseogu argv to pi argv. jeonseogu-only flags (--persona) are
 * consumed here; everything else is passed through to pi untouched.
 */

/** pi flags that take over tool selection — if present, we don't inject --no-tools. */
const PI_TOOL_FLAGS = ["--no-tools", "-nt", "--no-builtin-tools", "-nbt", "--tools", "-t"];
/** pi flags that pull in skills/extensions explicitly. */
const PI_INCLUDE_FLAGS = ["--skill", "--extension", "-e"];
/** pi flags that replace the default prompt. */
const PI_PROMPT_FLAGS = ["--system-prompt", "--append-system-prompt"];

export interface MappedArgs {
	/** Flags injected ahead of the user's args. */
	prepend: string[];
	/** User args minus jeonseogu-only flags. */
	rest: string[];
	/** Custom persona path from --persona. */
	persona?: string;
	/** The user set their own prompt flags, so persona injection is skipped. */
	userPrompt: boolean;
}

export function mapArgs(argv: string[]): MappedArgs {
	const rest: string[] = [];
	let persona: string | undefined;
	let userPrompt = false;
	let sawToolFlag = false;
	let sawIncludeFlag = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--persona") {
			persona = argv[++i];
			continue;
		}
		if (arg.startsWith("--persona=")) {
			persona = arg.slice("--persona=".length);
			continue;
		}
		if (PI_PROMPT_FLAGS.includes(arg)) userPrompt = true;
		if (PI_TOOL_FLAGS.includes(arg)) sawToolFlag = true;
		if (PI_INCLUDE_FLAGS.includes(arg)) sawIncludeFlag = true;
		rest.push(arg);
	}

	// Opinionated defaults: pure persona, no pi/project resources.
	const prepend: string[] = [];
	if (!sawToolFlag) prepend.push("--no-tools");
	if (!sawIncludeFlag) prepend.push("--no-extensions", "--no-skills");
	prepend.push("--no-context-files"); // AGENTS.md/CLAUDE.md must not leak into the persona

	return { prepend, rest, persona, userPrompt };
}
