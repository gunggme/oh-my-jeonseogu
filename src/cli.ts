#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { main } from "@mariozechner/pi-coding-agent";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { mapArgs } from "./args.js";
import { jeonseoguBanner } from "./banner.js";

// Same preamble as pi's own cli.js: long provider streams must not hit
// undici's default body timeouts, and HTTP(S)_PROXY should be honored.
process.env.PI_CODING_AGENT = "true";
process.title = "jeonseogu";
process.emitWarning = () => {};
setGlobalDispatcher(new EnvHttpProxyAgent({ bodyTimeout: 0, headersTimeout: 0 }));

const DEFAULT_PERSONA_PATH = fileURLToPath(new URL("../personas/jeonseogu.md", import.meta.url));

async function run(argv: string[]): Promise<void> {
	const mapped = mapArgs(argv);
	const args = [...mapped.prepend];
	if (!mapped.userPrompt) {
		let persona: string;
		try {
			persona = readFileSync(mapped.persona ?? DEFAULT_PERSONA_PATH, "utf8");
		} catch {
			process.stderr.write("페르소나 파일을 못 읽음: " + (mapped.persona ?? DEFAULT_PERSONA_PATH) + "\n");
			process.exit(1);
		}
		args.push("--system-prompt", persona);
	}
	args.push(...mapped.rest);
	await main(args, { extensionFactories: [jeonseoguBanner] });
}

run(process.argv.slice(2)).catch((e) => {
	process.stderr.write(String(e instanceof Error ? (e.stack ?? e.message) : e) + "\n");
	process.exit(1);
});
