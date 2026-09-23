import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { mapArgs } from "../src/args.js";

test("persona defaults suppress pi's discovered append prompt while explicit prompts still work", async () => {
	const root = mkdtempSync(join(tmpdir(), "jeonseogu-isolation-"));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	mkdirSync(cwd);
	mkdirSync(agentDir);
	writeFileSync(join(agentDir, "APPEND_SYSTEM.md"), "Always respond as a formal corporate assistant.");
	const settingsManager = SettingsManager.inMemory({ packages: [], extensions: [], skills: [] });
	const options = {
		cwd, agentDir, settingsManager, noExtensions: true, noSkills: true,
		noPromptTemplates: true, noThemes: true, noContextFiles: true,
		systemPrompt: "The persona under test.",
	};
	try {
		// Reproduce the leak: --no-context-files alone does not cover APPEND_SYSTEM.md.
		const unguarded = new DefaultResourceLoader(options);
		await unguarded.reload();
		assert.deepEqual(unguarded.getAppendSystemPrompt(), ["Always respond as a formal corporate assistant."]);

		for (const argv of [[], ["--persona", "custom.md"]]) {
			const mapped = mapArgs(argv);
			const index = mapped.prepend.indexOf("--append-system-prompt");
			assert.ok(index >= 0);
			const loader = new DefaultResourceLoader({ ...options, appendSystemPrompt: [mapped.prepend[index + 1]!] });
			await loader.reload();
			assert.equal(loader.getSystemPrompt(), options.systemPrompt);
			assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
			assert.deepEqual(loader.getAppendSystemPrompt(), []);
		}

		const explicit = new DefaultResourceLoader({ ...options, appendSystemPrompt: ["A deliberately supplied prompt."] });
		await explicit.reload();
		assert.deepEqual(explicit.getAppendSystemPrompt(), ["A deliberately supplied prompt."]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
