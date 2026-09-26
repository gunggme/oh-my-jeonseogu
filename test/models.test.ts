import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
	type AgentSession, type ModelSelectEvent,
} from "@earendil-works/pi-coding-agent";
import { jeonseoguModels, latestAvailableModel } from "../src/models.js";

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
			models: [{ id: "gpt-5.5", reasoning: true }, { id: "gpt-6-astra", reasoning: true }],
		},
	} }));
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), allowModelNetwork: false,
	});
	const first = modelRuntime.getModel("jeonseogu-test", "gpt-5.5")!;
	const second = modelRuntime.getModel("jeonseogu-test", "gpt-6-astra")!;
	const sessions: AgentSession[] = [];
	const warnings: string[] = [];
	async function open(options: {
		model?: typeof first; mode?: "tui" | "rpc" | "print"; sessionManager?: SessionManager;
		args?: string[]; scopedModels?: { model: typeof first }[]; projectTrusted?: boolean;
		thinkingLevel?: "low" | "high";
	} = {}) {
		const settingsManager = SettingsManager.create(root, agentDir, { projectTrusted: options.projectTrusted ?? false });
		const loader = new DefaultResourceLoader({
			cwd: root, agentDir, settingsManager,
			noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			systemPrompt: "Synthetic test persona.", appendSystemPrompt: [],
			extensionFactories: [(pi) => jeonseoguModels(pi, {
				agentDir, allowNetwork: false,
				args: options.args ?? (options.model ? ["--model", options.model.id] : []),
			})],
		});
		await loader.reload();
		const { session } = await createAgentSession({
			cwd: root, agentDir, modelRuntime, settingsManager, resourceLoader: loader,
			model: options.model, scopedModels: options.scopedModels, thinkingLevel: options.thinkingLevel,
			noTools: "all", sessionManager: options.sessionManager ?? SessionManager.inMemory(root),
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
		root, agentDir, settingsPath, first, second, modelRuntime, warnings, open,
		settings: () => SettingsManager.create(root, agentDir, { projectTrusted: false }),
		close: () => { for (const session of sessions) session.dispose(); rmSync(root, { recursive: true, force: true }); },
	};
}

test("first startup picks and saves the latest available generation", async () => {
	const f = await fixture();
	try {
		assert.equal((await f.open()).model?.id, f.second.id);
		assert.equal(f.settings().getDefaultModel(), f.second.id);
		assert.equal(f.settings().getDefaultProvider(), f.second.provider);
		assert.equal((await f.open()).model?.id, f.second.id);
	} finally { f.close(); }
});

test("an older saved choice wins over a newer model on subsequent startup", async () => {
	const f = await fixture();
	try {
		const session = await f.open();
		await session.setModel(f.first);
		assert.equal((await f.open()).model?.id, f.first.id);
	} finally { f.close(); }
});

test("first startup refreshes the provider catalog before choosing its latest model", async () => {
	const f = await fixture();
	try {
		const modelsPath = join(f.agentDir, "models.json");
		const catalog = JSON.parse(readFileSync(modelsPath, "utf8"));
		catalog.providers["jeonseogu-test"].models.push({ id: "gpt-7-sol" });
		writeFileSync(modelsPath, JSON.stringify(catalog));
		assert.equal((await f.open()).model?.id, "gpt-7-sol");
		assert.equal(f.settings().getDefaultModel(), "gpt-7-sol");
	} finally { f.close(); }
});

test("trusted project model defaults are not replaced or copied to global settings", async () => {
	const f = await fixture();
	try {
		mkdirSync(join(f.root, ".pi"));
		writeFileSync(join(f.root, ".pi", "settings.json"), JSON.stringify({
			defaultProvider: f.first.provider, defaultModel: f.first.id,
		}));
		assert.equal((await f.open({ projectTrusted: true })).model?.id, f.first.id);
		assert.equal(f.settings().getDefaultModel(), undefined);
	} finally { f.close(); }
});

test("startup without any available authenticated models leaves defaults unset", async (t) => {
	const f = await fixture();
	try {
		t.mock.method(f.modelRuntime, "getAvailableSnapshot", () => []);
		t.mock.method(f.modelRuntime, "hasConfiguredAuth", () => false);
		// pi's underlying agent exposes its "unknown" placeholder without auth.
		assert.equal((await f.open()).model?.id, "unknown");
		assert.equal(f.settings().getDefaultModel(), undefined);
		assert.deepEqual(f.warnings, []);
	} finally { f.close(); }
});

test("failed authentication during initial selection retains the working startup model", async (t) => {
	const f = await fixture();
	try {
		t.mock.method(f.modelRuntime, "checkAuth", async () => undefined);
		assert.equal((await f.open()).model?.id, f.first.id);
		assert.equal(f.settings().getDefaultModel(), undefined);
		assert.equal(f.warnings.length, 1);
	} finally { f.close(); }
});

test("initial selection respects CLI model/session flags and scoped models", async () => {
	const f = await fixture();
	try {
		for (const args of [
			["--model", f.first.id], ["--provider", f.first.provider], ["--models", f.first.id],
			["-c"], ["--continue"], ["--resume"], ["--session", "synthetic.jsonl"], ["--fork", "synthetic.jsonl"],
		]) {
			assert.equal((await f.open({ model: f.first, args })).model?.id, f.first.id);
			assert.equal(f.settings().getDefaultModel(), undefined);
		}
		assert.equal((await f.open({ scopedModels: [{ model: f.first }] })).model?.id, f.first.id);
		assert.equal(f.settings().getDefaultModel(), undefined);
	} finally { f.close(); }
});

test("initial selection preserves explicit thinking level without rewriting the saved level", async () => {
	const f = await fixture();
	try {
		const session = await f.open({ args: ["--thinking", "low"], thinkingLevel: "low" });
		assert.equal(session.model?.id, f.second.id);
		assert.equal(session.thinkingLevel, "low");
		assert.equal(f.settings().getDefaultThinkingLevel(), "high");
	} finally { f.close(); }
});

test("a failed initial catalog refresh uses cached available models", async (t) => {
	const f = await fixture();
	try {
		t.mock.method(f.modelRuntime, "refresh", async () => { throw new Error("offline"); });
		assert.equal((await f.open()).model?.id, f.second.id);
		assert.deepEqual(f.warnings, []);
	} finally { f.close(); }
});

test("print and RPC startup do not auto-select or save a new default", async () => {
	const f = await fixture();
	try {
		for (const mode of ["print", "rpc"] as const) {
			assert.equal((await f.open({ model: f.first, args: [], mode })).model?.id, f.first.id);
			assert.equal(f.settings().getDefaultModel(), undefined);
		}
	} finally { f.close(); }
});

test("latest generation comparison is numeric and stays within the available provider and family", () => {
	const model = (id: string, provider = "test") => ({ id, provider });
	const current = model("gpt-5.5");
	assert.equal(latestAvailableModel(current, [model("gpt-5.9"), model("gpt-5.10")])?.id, "gpt-5.10");
	assert.equal(latestAvailableModel(current, [current, model("gpt-6-astra"), model("gpt-99", "unavailable")])?.id, "gpt-6-astra");
	assert.equal(latestAvailableModel(current, [model("gpt-5.5-20990101"), model("gpt-5.6")])?.id, "gpt-5.6");
	assert.equal(latestAvailableModel(model("gpt-5.6-sol"), [model("gpt-6-astra"), model("gpt-6-sol")])?.id, "gpt-6-sol");
	assert.equal(latestAvailableModel(model("claude-opus-4-6"), [model("claude-opus-4-8"), model("claude-sonnet-5")])?.id, "claude-opus-4-8");
	assert.equal(latestAvailableModel(model("gemini-2.5-pro"), [model("gemini-3.1-pro-preview")])?.id, "gemini-3.1-pro-preview");
	const custom = model("custom-405b");
	assert.equal(latestAvailableModel(custom, [custom, model("custom-999b")]), custom);
	assert.equal(latestAvailableModel(current, []), undefined);
});

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
