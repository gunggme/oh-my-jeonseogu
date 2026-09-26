import { parseArgs } from "@earendil-works/pi-coding-agent";
import { emitKeypressEvents, type Key } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
	checkForUpdates, dismissUpdate, isNewer, runSelfUpdate,
	type UpdateInfo,
} from "./updater.js";

export type UpdateChoice = "update" | "skip" | "dismiss";

/** Match pi's interactive mode, excluding commands that never start a conversation. */
export function shouldPromptForUpdate(args: string[], stdinIsTTY = process.stdin.isTTY, stdoutIsTTY = process.stdout.isTTY): boolean {
	if (!stdinIsTTY || !stdoutIsTTY) return false;
	if (["1", "true", "yes"].includes(process.env.PI_OFFLINE?.toLowerCase() ?? "")) return false;
	const parsed = parseArgs(args);
	if (parsed.offline || parsed.print || parsed.mode === "json" || parsed.mode === "rpc") return false;
	if (parsed.help || parsed.version || parsed.export || parsed.listModels !== undefined) return false;
	if (parsed.diagnostics.some((diagnostic) => diagnostic.type === "error")) return false;
	return !["auth", "config", "install", "remove", "update", "list"].includes(parsed.messages[0] ?? "");
}

type TerminalInput = Readable & { isRaw?: boolean; setRawMode(mode: boolean): unknown };

/** A small pre-start picker; release the terminal before starting npm or pi. */
export function chooseUpdate(info: UpdateInfo, input: TerminalInput = process.stdin, output: Writable = process.stdout): Promise<UpdateChoice> {
	return new Promise((resolve) => {
		const choices: UpdateChoice[] = ["update", "skip", "dismiss"];
		const labels = ["지금 업데이트", "이번에는 건너뛰기", "다음 버전까지 알리지 않기"];
		const wasRaw = input.isRaw ?? false;
		const wasFlowing = input.readableFlowing === true;
		let selected = 0;
		let done = false;
		const render = (): void => {
			const versions = [
				isNewer(info.self.latest, info.self.current) ? `oh-my-jeonseogu v${info.self.current} → v${info.self.latest}` : "",
				isNewer(info.pi.latest, info.pi.current) ? `pi v${info.pi.current} → v${info.pi.latest}` : "",
			].filter(Boolean);
			output.write("\x1b[H\x1b[2J" + [
				"", "  새 업데이트가 있습니다", ...versions.map((line) => "  " + line), "",
				...labels.map((label, index) => `  ${selected === index ? "›" : " "} ${index + 1}. ${label}`), "",
				"  ↑/↓ 선택 · Enter 확인 · Esc 건너뛰기", "",
			].join("\r\n"));
		};
		const finish = (choice: UpdateChoice): void => {
			if (done) return;
			done = true;
			input.removeListener("keypress", onKey);
			input.removeListener("end", onEnd);
			input.removeListener("error", onEnd);
			output.removeListener("resize", render);
			input.setRawMode(wasRaw);
			if (!wasFlowing) input.pause();
			output.write("\x1b[?25h\x1b[?1049l");
			resolve(choice);
		};
		const onEnd = (): void => finish("skip");
		const onKey = (_text: string, key: Key): void => {
			if (key.name === "escape" || (key.ctrl && (key.name === "c" || key.name === "d"))) return finish("skip");
			if (key.name === "return") return finish(choices[selected]!);
			if (key.sequence === "1" || key.sequence === "2" || key.sequence === "3") return finish(choices[Number(key.sequence) - 1]!);
			if (key.name === "up" || key.name === "k") selected = (selected + choices.length - 1) % choices.length;
			else if (key.name === "down" || key.name === "j") selected = (selected + 1) % choices.length;
			else return;
			render();
		};
		emitKeypressEvents(input);
		input.setRawMode(true);
		input.on("keypress", onKey);
		input.once("end", onEnd);
		input.once("error", onEnd);
		output.on("resize", render);
		output.write("\x1b[?1049h\x1b[?25l");
		render();
		input.resume();
	});
}

interface StartupUpdateActions {
	check: typeof checkForUpdates;
	choose: (info: UpdateInfo) => Promise<UpdateChoice>;
	install: () => Promise<boolean>;
	dismiss: typeof dismissUpdate;
	write: (message: string) => void;
}

const defaultActions: StartupUpdateActions = {
	check: checkForUpdates, choose: chooseUpdate, install: runSelfUpdate, dismiss: dismissUpdate,
	write: (message) => { process.stdout.write(message + "\n"); },
};

/** Successful installs must exit: this process already loaded the old package. */
export async function runStartupUpdate(selfVersion: string, piVersion: string, actions: StartupUpdateActions = defaultActions): Promise<"continue" | "updated" | "failed"> {
	let info: UpdateInfo | null;
	try {
		info = await actions.check(selfVersion, piVersion);
	} catch {
		return "continue";
	}
	if (!info) return "continue";
	const choice = await actions.choose(info);
	if (choice === "dismiss") {
		if (!actions.dismiss(info)) actions.write("알림 숨김을 저장하지 못했습니다. 이번 실행에서는 건너뜁니다.");
	}
	if (choice !== "update") return "continue";
	actions.write("업데이트 중: npm install -g oh-my-jeonseogu@latest");
	let ok = false;
	try {
		ok = await actions.install();
	} catch {
		// Include npm spawn failures in the same actionable failure path.
	}
	if (!ok) {
		actions.write("업데이트 실패. npm i -g oh-my-jeonseogu@latest 로 다시 시도해 주세요.");
		return "failed";
	}
	actions.write("업데이트 완료. 최신 버전을 사용하려면 jeonseogu를 다시 실행해 주세요.");
	return "updated";
}
