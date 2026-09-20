import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import {
	AuthStorage,
	createAgentSession,
	createExtensionRuntime,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type ResourceLoader,
} from "@mariozechner/pi-coding-agent";

const DEFAULT_PERSONA_URL = new URL("../personas/jeonseogu.md", import.meta.url);

export function loadSystemPrompt(personaPath?: string): string {
	const path = personaPath ?? DEFAULT_PERSONA_URL.pathname;
	return readFileSync(path, "utf8");
}

/**
 * A ResourceLoader that isolates the session from the user's pi config:
 * no skills, extensions, prompts, themes, or AGENTS.md — just the persona.
 */
function personaResourceLoader(systemPrompt: string): ResourceLoader {
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

/**
 * Resolve a --model spec. Accepts "provider:id", "provider/id", or a bare
 * model id matched across all providers.
 */
export function resolveModel(registry: ModelRegistry, spec?: string): Model<Api> | undefined {
	if (!spec) return registry.getAvailable()[0];

	for (const sep of ["/", ":"]) {
		const idx = spec.indexOf(sep);
		if (idx > 0) {
			const found = registry.find(spec.slice(0, idx), spec.slice(idx + 1));
			if (found) return found;
		}
	}
	return registry.getAll().find((m) => m.id === spec);
}

export interface ChatSessionOptions {
	cwd: string;
	/** Directory for persisted sessions; omit for in-memory. */
	sessionDir?: string;
	continueRecent?: boolean;
	model?: Model<Api>;
	thinkingLevel?: ThinkingLevel;
	/** Enable pi's built-in coding tools (read/bash/edit/write). */
	tools?: boolean;
	systemPrompt: string;
	/** Shared auth/registry; created fresh when omitted. */
	authStorage?: AuthStorage;
	modelRegistry?: ModelRegistry;
	/** Custom models.json path (mainly for tests). */
	modelsJsonPath?: string;
}

export interface ChatSession {
	session: AgentSession;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
}

export async function createChatSession(opts: ChatSessionOptions): Promise<ChatSession> {
	// Auth and models still come from ~/.pi/agent so a pi login just works.
	const authStorage = opts.authStorage ?? AuthStorage.create();
	const modelRegistry = opts.modelRegistry ?? ModelRegistry.create(authStorage, opts.modelsJsonPath);

	const sessionManager = !opts.sessionDir
		? SessionManager.inMemory(opts.cwd)
		: opts.continueRecent
			? SessionManager.continueRecent(opts.cwd, opts.sessionDir)
			: SessionManager.create(opts.cwd, opts.sessionDir);

	const { session } = await createAgentSession({
		cwd: opts.cwd,
		model: opts.model,
		thinkingLevel: opts.thinkingLevel ?? "off",
		authStorage,
		modelRegistry,
		resourceLoader: personaResourceLoader(opts.systemPrompt),
		sessionManager,
		settingsManager: SettingsManager.inMemory(),
		noTools: opts.tools ? undefined : "all",
	});

	return { session, authStorage, modelRegistry };
}

export function defaultSessionDir(cwd: string): string {
	return join(cwd, ".jeonseogu", "sessions");
}
