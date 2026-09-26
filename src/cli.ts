#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { main, VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import { mapArgs } from "./args.js";
import { jeonseoguBanner } from "./banner.js";
import { jeonseoguModels } from "./models.js";
import { runStartupUpdate, shouldPromptForUpdate } from "./startup-update.js";
import { pkgVersion, shouldCheckForUpdates } from "./updater.js";

// pi's main() configures its own HTTP dispatcher, proxy, and timeout settings.
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "pi";
process.title = "jeonseogu";
process.emitWarning = () => {};

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
	if (shouldCheckForUpdates(mapped.noUpdate) && shouldPromptForUpdate(mapped.rest)) {
		const outcome = await runStartupUpdate(pkgVersion(), PI_VERSION);
		if (outcome !== "continue") {
			process.exitCode = outcome === "updated" ? 0 : 1;
			return;
		}
	}
	await main(args, { extensionFactories: [jeonseoguBanner, (pi) => jeonseoguModels(pi, { args })] });
}

run(process.argv.slice(2)).catch((e) => {
	process.stderr.write(String(e instanceof Error ? (e.stack ?? e.message) : e) + "\n");
	process.exit(1);
});
