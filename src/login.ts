import { spawn } from "node:child_process";
import type { AgentSession, AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import { isRealModel } from "./session.js";

export type AskLine = (question: string) => Promise<string>;

/** Best-effort browser open; the URL is always printed as a fallback. */
export function openInBrowser(url: string): void {
	const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
	const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
	try {
		spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
	} catch {
		// ignore — URL is printed anyway
	}
}

/** Run an OAuth login (Anthropic / GitHub Copilot / OpenAI Codex) via pi's AuthStorage. */
export async function oauthLogin(
	authStorage: AuthStorage,
	providerId: string,
	note: (msg: string) => void,
	ask: AskLine,
): Promise<void> {
	const provider = authStorage.getOAuthProviders().find((p) => p.id === providerId);
	if (!provider) throw new Error("OAuth provider를 못 찾음: " + providerId);

	let manualCodePromise: Promise<string> | null = null;

	const callbacks: OAuthLoginCallbacks = {
		onAuth: (info) => {
			note("브라우저에서 로그인: " + info.url);
			if (info.instructions) note(info.instructions);
			openInBrowser(info.url);
			if (provider.usesCallbackServer) {
				// Race the local callback server against a manual redirect-URL paste.
				manualCodePromise = ask("리다이렉트된 주소 붙여넣기 (브라우저 승인 후 그냥 기다려도 됨): ");
				// If the callback server wins, this answer is discarded by the caller.
				void manualCodePromise.catch(() => {});
			}
		},
		onPrompt: (prompt) =>
			ask(prompt.message + (prompt.placeholder ? " [" + prompt.placeholder + "]" : "") + " "),
		onProgress: (message) => note(message),
		onManualCodeInput: () => manualCodePromise ?? ask("코드 입력: "),
		onSelect: async (select) => {
			note(select.message);
			select.options.forEach((o, i) => note("  " + (i + 1) + ". " + o.label));
			const answer = await ask("번호 선택 (엔터 = 취소): ");
			const n = Number.parseInt(answer, 10);
			if (Number.isNaN(n)) return undefined;
			return select.options[n - 1]?.id;
		},
	};

	await authStorage.login(provider.id, callbacks);
}

/** Store a plain API key for providers without an OAuth flow. */
export async function apiKeyLogin(authStorage: AuthStorage, providerId: string, ask: AskLine): Promise<void> {
	const key = await ask(providerId + " API key 입력: ");
	if (!key) throw new Error("빈 키라서 취소함");
	authStorage.set(providerId, { type: "api_key", key });
}

/** Refresh the registry after login and pick a model when the session has none. */
export async function afterAuth(
	registry: ModelRegistry,
	session: AgentSession,
	providerId: string,
	note: (msg: string) => void,
): Promise<void> {
	registry.refresh();
	const providerModels = registry.getAvailable().filter((m) => m.provider === providerId);
	if (providerModels.length === 0) {
		note("자격증명 저장함. 근데 " + providerId + " 쪽 사용 가능한 모델이 없음 — /models 확인");
		return;
	}
	if (!isRealModel(session.model)) {
		await session.setModel(providerModels[0]!);
		note("모델 선택: " + providerModels[0]!.provider + "/" + providerModels[0]!.id);
	} else {
		note(
			"자격증명 저장함. /model " + providerModels[0]!.provider + ":" + providerModels[0]!.id + " 로 전환 가능",
		);
	}
}
