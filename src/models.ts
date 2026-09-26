import {
	getAgentDir, parseArgs, SettingsManager,
	type ExtensionAPI, type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

interface ModelReference {
	provider: string;
	id: string;
}

function versionOf(id: string): { family: string; version: number[]; variant: string } | undefined {
	// Other families can encode parameter counts rather than generations.
	// A dated snapshot is not a newer model generation.
	const alias = id.replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, "");
	const match = /^(gpt-|claude-(?:opus-|sonnet-|haiku-)?|gemini-)(\d+(?:[.-]\d+)*)(.*)$/.exec(alias);
	if (!match) return undefined;
	return { family: match[1]!, version: match[2]!.split(/[.-]/).map(Number), variant: match[3]! };
}

/** Newest comparable generation on the provider/family pi already selected. */
export function latestAvailableModel<T extends ModelReference>(current: T, available: readonly T[]): T | undefined {
	const base = versionOf(current.id);
	if (!base) return available.find((model) => model.provider === current.provider && model.id === current.id);
	const candidates = available.flatMap((model) => {
		const parsed = versionOf(model.id);
		return model.provider === current.provider && parsed?.family === base.family ? [{ model, ...parsed }] : [];
	});
	candidates.sort((a, b) => {
		for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
			const difference = (b.version[i] ?? 0) - (a.version[i] ?? 0);
			if (difference !== 0) return difference;
		}
		// Retain the variant within a generation, then prefer the plain model,
		// then catalog order. Price is not a recency signal.
		const rank = (variant: string): number => variant === base.variant ? 0 : variant === "" ? 1 : 2;
		return rank(a.variant) - rank(b.variant);
	});
	return candidates[0]?.model;
}

interface ModelDefaultsOptions {
	args?: string[];
	agentDir?: string;
	/** Tests can refresh synthetic catalogs without contacting providers. */
	allowNetwork?: boolean;
}

/** Keep pi's model/auth machinery and persist choices with its locked settings writer. */
export function jeonseoguModels(pi: ExtensionAPI, options: ModelDefaultsOptions = {}): void {
	const agentDir = options.agentDir ?? getAgentDir();
	const args = parseArgs(options.args ?? []);
	let selectingInitialModel = false;
	const save = async (model: ModelReference, ctx: ExtensionContext): Promise<void> => {
		const settings = SettingsManager.create(ctx.cwd, agentDir, { projectTrusted: false });
		settings.setDefaultModelAndProvider(model.provider, model.id);
		await settings.flush();
		if (settings.drainErrors().length > 0) {
			ctx.ui.notify("모델은 변경했지만 기본 모델을 저장하지 못했습니다. pi 설정 파일 권한과 형식을 확인해 주세요.", "warning");
		}
	};

	pi.on("model_select", async (event, ctx) => {
		// Restoring a transcript or running an RPC/script must not change startup defaults.
		if (ctx.mode !== "tui" || event.source === "restore" || selectingInitialModel) return;
		await save(event.model, ctx);
	});

	pi.on("session_start", async (event, ctx) => {
		if (ctx.mode !== "tui" || event.reason !== "startup" || !ctx.model) return;
		if (args.model || args.provider || args.models || args.continue || args.resume || args.session || args.fork) return;
		if (ctx.scopedModels.length > 0 || ctx.sessionManager.getBranch().some((entry) => entry.type === "message")) return;
		const settings = SettingsManager.create(ctx.cwd, agentDir, { projectTrusted: ctx.isProjectTrusted() });
		// Saved choices and trusted project defaults take precedence, even if old.
		if (settings.getDefaultModel() || settings.getDefaultProvider() || settings.drainErrors().length > 0) return;
		const current = ctx.model;
		try {
			await ctx.modelRegistry.refresh({
				providers: [current.provider], allowNetwork: options.allowNetwork, signal: AbortSignal.timeout(3_000),
			});
		} catch {
			// Offline/failed refreshes still leave the bundled or cached catalog usable.
		}
		const latest = latestAvailableModel(current, ctx.modelRegistry.getAvailable());
		if (!latest) return;
		selectingInitialModel = true;
		try {
			const thinkingLevel = pi.getThinkingLevel();
			if (await pi.setModel(latest)) {
				if (args.thinking) pi.setThinkingLevel(thinkingLevel);
				await save(latest, ctx);
			}
		} catch {
			ctx.ui.notify("최신 모델을 선택하지 못해 기존 모델로 시작합니다. /model에서 다시 선택할 수 있습니다.", "warning");
		} finally {
			selectingInitialModel = false;
		}
	});
}
