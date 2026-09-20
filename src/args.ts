export interface CliOptions {
	model?: string;
	print?: string;
	continueSession: boolean;
	ephemeral: boolean;
	noDelay: boolean;
	tools: boolean;
	thinking?: string;
	persona?: string;
	help: boolean;
	version: boolean;
	/** Positional args joined into a one-shot message (implies print mode). */
	message?: string;
}

export type ParseResult = { ok: true; options: CliOptions } | { ok: false; error: string };

export function parseArgv(argv: string[]): ParseResult {
	const options: CliOptions = {
		continueSession: false,
		ephemeral: false,
		noDelay: false,
		tools: false,
		help: false,
		version: false,
	};
	const positional: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--") {
			positional.push(...argv.slice(i + 1));
			break;
		}
		// --flag=value form
		const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
		const flag = eq > 0 ? arg.slice(0, eq) : arg;
		const inlineValue = eq > 0 ? arg.slice(eq + 1) : undefined;

		const takeValue = (): string | undefined => {
			if (inlineValue !== undefined) return inlineValue;
			return argv[++i];
		};

		switch (flag) {
			case "-m":
			case "--model": {
				const v = takeValue();
				if (v === undefined) return { ok: false, error: flag + " requires a value" };
				options.model = v;
				break;
			}
			case "-p":
			case "--print": {
				const v = takeValue();
				if (v === undefined) return { ok: false, error: flag + " requires a value" };
				options.print = v;
				break;
			}
			case "--think": {
				const v = takeValue();
				if (v === undefined) return { ok: false, error: flag + " requires a value" };
				options.thinking = v;
				break;
			}
			case "--persona": {
				const v = takeValue();
				if (v === undefined) return { ok: false, error: flag + " requires a value" };
				options.persona = v;
				break;
			}
			case "-c":
			case "--continue":
				options.continueSession = true;
				break;
			case "-e":
			case "--ephemeral":
				options.ephemeral = true;
				break;
			case "--no-delay":
				options.noDelay = true;
				break;
			case "--tools":
				options.tools = true;
				break;
			case "-h":
			case "--help":
				options.help = true;
				break;
			case "-v":
			case "--version":
				options.version = true;
				break;
			default:
				if (arg.startsWith("-")) return { ok: false, error: "unknown flag: " + arg };
				positional.push(arg);
		}
	}

	if (positional.length > 0) options.message = positional.join(" ");
	return { ok: true, options };
}

export const USAGE = [
	"oh-my-jeonseogu — 전서구 말투에서 영감을 받은 대화 CLI",
	"",
	"Usage:",
	"  jeonseogu                     interactive chat",
	'  jeonseogu "할 말"             one-shot reply',
	'  echo "할 말" | jeonseogu      pipe mode',
	'  jeonseogu -p "할 말"',
	"",
	"Options:",
	"  -m, --model <spec>     provider:id, provider/id, or model id",
	"  -p, --print <msg>      print one reply and exit",
	"  -c, --continue         continue the most recent session",
	"  -e, --ephemeral        don't persist the session",
	"      --tools            enable coding tools (read/bash/edit/write)",
	"      --think <level>    off|minimal|low|medium|high|xhigh",
	"      --persona <path>   use a custom persona file",
	"      --no-delay         no pause between split messages",
	"  -h, --help             show this help",
	"  -v, --version          show version",
	"",
	"In chat:",
	"  /login      log in with OAuth or an API key (/login <provider>)",
	"  /logout     remove stored credentials (/logout <provider>)",
	"  /new        reset the conversation",
	"  /model      show current model; /model <spec> to switch",
	"  /models     list models with credentials configured",
	"  /delay      toggle the pause between messages",
	"  /quit       exit",
	"",
].join("\n");
