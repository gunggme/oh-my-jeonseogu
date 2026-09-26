import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
	type AgentSession, type ModelSelectEvent,
} from "@earendil-works/pi-coding-agent";
import { rememberModelSelection } from "../src/models.js";

async function fixture() {
	const root = mkdtempSync(join(tmpdir(), "jeonseogu-models-"));
	const agentDir = join(root, "agent");
	mkdirSync(agentDir);
	const settingsPath = join(agentDir, "settings.json");
	writeFileSync(settingsPath, JSON.stringify({ theme: "light", defaultThinkingLevel: "high" }));
	// Synthetic local provider: never read user credentials or contact a model server.
	writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {
		"jeonseogu-test": {
			api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "test-only",
			models: [{ id: "model-1" }, { id: "model-2" }],
		},
	} }));
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), allowModelNetwork: false,
	});
	const first = modelRuntime.getModel("jeonseogu-test", "model-1")!;
	const second = modelRuntime.getModel("jeonseogu-test", "model-2")!;
	const sessions: AgentSession[] = [];
	const warnings: string[] = [];
	async function open(options: { model?: typeof first; mode?: "tui" | "rpc" | "print"; sessionManager?: SessionManager } = {}) {
		const settingsManager = SettingsManager.create(root, agentDir, { projectTrusted: false });
		const loader = new DefaultResourceLoader({
			cwd: root, agentDir, settingsManager,
			noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			systemPrompt: "Synthetic test persona.", appendSystemPrompt: [],
			extensionFactories: [(pi) => rememberModelSelection(pi, agentDir)],
		});
		await loader.reload();
		const { session } = await createAgentSession({
			cwd: root, agentDir, modelRuntime, settingsManager, resourceLoader: loader,
			model: options.model, noTools: "all", sessionManager: options.sessionManager ?? SessionManager.inMemory(root),
		});
		sessions.push(session);
		await session.bindExtensions({
			mode: options.mode ?? "tui",
			uiContext: { ...session.extensionRunner.getUIContext(), notify: (message) => { warnings.push(message); } },
			onError: (error) => { throw new Error(error.error); },
		});
		return session;
	}
	return {
		root, agentDir, settingsPath, first, second, warnings, open,
		settings: () => SettingsManager.create(root, agentDir, { projectTrusted: false }),
		close: () => { for (const session of sessions) session.dispose(); rmSync(root, { recursive: true, force: true }); },
	};
}

test("ordinary model selection is restored in a new session without losing other settings", async () => {
	const f = await fixture();
	try {
		const session = await f.open({ model: f.first });
		await session.setModel(f.second); // The same non-persisting path used by /model Enter.
		assert.equal(f.settings().getDefaultModel(), f.second.id);
		assert.equal(f.settings().getDefaultProvider(), f.second.provider);
		assert.equal(f.settings().getTheme(), "light");
		assert.equal(f.settings().getDefaultThinkingLevel(), "high");
		assert.equal((await f.open()).model?.id, f.second.id);
		assert.deepEqual(f.warnings, []);
	} finally { f.close(); }
});

test("model cycling remembers the most recent choice", async () => {
	const f = await fixture();
	try {
		const session = await f.open({ model: f.first });
		session.setScopedModels([{ model: f.first }, { model: f.second }]);
		await session.cycleModel();
		assert.equal(f.settings().getDefaultModel(), f.second.id);
		await session.cycleModel();
		assert.equal((await f.open()).model?.id, f.first.id);
	} finally { f.close(); }
});

test("a newly refreshed model can be selected and restored without a hard-coded model list", async () => {
	const f = await fixture();
	try {
		const session = await f.open({ model: f.first });
		const modelsPath = join(f.agentDir, "models.json");
		const catalog = JSON.parse(readFileSync(modelsPath, "utf8"));
		catalog.providers["jeonseogu-test"].models.push({ id: "model-3" });
		writeFileSync(modelsPath, JSON.stringify(catalog));
		await session.modelRuntime.refresh({ allowNetwork: false });
		const latest = session.modelRuntime.getAvailableSnapshot().find((model) => model.id === "model-3");
		assert.ok(latest);
		await session.setModel(latest);
		assert.equal((await f.open()).model?.id, latest.id);
	} finally { f.close(); }
});

test("a model without authentication cannot replace the saved default", async () => {
	const f = await fixture();
	try {
		const session = await f.open({ model: f.first });
		await session.setModel(f.second);
		await assert.rejects(session.setModel({ ...f.first, provider: "jeonseogu-no-auth" }), /No API key/);
		assert.equal(f.settings().getDefaultModel(), f.second.id);
		assert.equal(session.model?.id, f.second.id);
	} finally { f.close(); }
});

test("explicit startup models and noninteractive changes do not overwrite the last choice", async () => {
	const f = await fixture();
	try {
		await (await f.open({ model: f.first })).setModel(f.second);
		assert.equal((await f.open({ model: f.first })).model?.id, f.first.id);
		for (const mode of ["print", "rpc"] as const) {
			await (await f.open({ model: f.second, mode })).setModel(f.first);
			assert.equal(f.settings().getDefaultModel(), f.second.id);
		}
		assert.equal((await f.open()).model?.id, f.second.id);
	} finally { f.close(); }
});

test("session restoration does not overwrite the last interactive choice", async () => {
	const f = await fixture();
	try {
		const session = await f.open({ model: f.first });
		await session.setModel(f.second);
		const event: ModelSelectEvent = { type: "model_select", source: "restore", model: f.first, previousModel: f.second };
		await session.extensionRunner.emit(event);
		assert.equal(f.settings().getDefaultModel(), f.second.id);
		const transcript = SessionManager.inMemory(f.root);
		transcript.appendModelChange(f.first.provider, f.first.id);
		transcript.appendMessage({ role: "user", content: "Synthetic message", timestamp: 0 });
		assert.equal((await f.open({ sessionManager: transcript })).model?.id, f.first.id);
		assert.equal(f.settings().getDefaultModel(), f.second.id);
	} finally { f.close(); }
});

test("a corrupt settings file is preserved and saving failure does not undo model selection", async () => {
	const f = await fixture();
	try {
		const session = await f.open({ model: f.first });
		writeFileSync(f.settingsPath, "{broken");
		await session.setModel(f.second);
		assert.equal(session.model?.id, f.second.id);
		assert.equal(readFileSync(f.settingsPath, "utf8"), "{broken");
		assert.equal(f.warnings.length, 1);
		assert.match(f.warnings[0]!, /저장하지 못했습니다/);
	} finally { f.close(); }
});
