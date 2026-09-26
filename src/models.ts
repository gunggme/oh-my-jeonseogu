import { getAgentDir, SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Remember interactive choices using pi's locked, field-preserving settings writer. */
export function rememberModelSelection(pi: ExtensionAPI, agentDir = getAgentDir()): void {
	pi.on("model_select", async (event, ctx) => {
		// Restoring a transcript or running an RPC/script must not change startup defaults.
		if (ctx.mode !== "tui" || event.source === "restore") return;
		const settings = SettingsManager.create(ctx.cwd, agentDir, { projectTrusted: false });
		settings.setDefaultModelAndProvider(event.model.provider, event.model.id);
		await settings.flush();
		if (settings.drainErrors().length > 0) {
			ctx.ui.notify("모델은 변경했지만 기본 모델을 저장하지 못했습니다. pi 설정 파일 권한과 형식을 확인해 주세요.", "warning");
		}
	});
}
