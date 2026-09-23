import { VERSION as PI_VERSION, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import { pkgVersion, updateOutcome } from "./updater.js";

/** 5-row block-letter font for the startup banner. */
const GLYPHS: Record<string, string[]> = {
	O: ["█████", "█   █", "█   █", "█   █", "█████"],
	H: ["█   █", "█   █", "█████", "█   █", "█   █"],
	M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
	Y: ["█   █", " █ █ ", "  █  ", "  █  ", "  █  "],
	J: ["█████", "    █", "    █", "█   █", " ███ "],
	E: ["█████", "█    ", "████ ", "█    ", "█████"],
	N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
	S: ["█████", "█    ", "█████", "    █", "█████"],
	G: ["█████", "█    ", "█  ██", "█   █", "█████"],
	U: ["█   █", "█   █", "█   █", "█   █", "█████"],
	"-": ["     ", "     ", "█████", "     ", "     "],
};

function renderWord(word: string): string[] {
	const rows = ["", "", "", "", ""];
	for (const ch of word) {
		const glyph = GLYPHS[ch] ?? ["     ", "     ", "     ", "     ", "     "];
		for (let r = 0; r < 5; r++) rows[r] += glyph[r]! + " ";
	}
	return rows;
}

/** The pigeon, standing to the right of the OH-MY wordmark. */
const PIGEON = [
	"            .-.",
	"           (o  >",
	"        _.-'   \\",
	"     .-'  .-.   |",
	"    /    /==/   /",
	"   /__..'__/_.-'",
	"  <________/",
	"        _| _|",
];

function bannerLines(theme: Theme): string[] {
	const accent = (s: string): string => theme.fg("accent", s);
	const muted = (s: string): string => theme.fg("muted", s);
	const dim = (s: string): string => theme.fg("dim", s);

	const wordmark = renderWord("OH-MY");
	const height = Math.max(wordmark.length, PIGEON.length);
	const ohMy = Array.from({ length: height }, (_, i) => {
		// Align the wordmark's baseline with the pigeon's feet.
		const row = wordmark[i - (height - wordmark.length)] ?? " ".repeat(wordmark[0]!.length);
		const bird = PIGEON[i - (height - PIGEON.length)] ?? "";
		return muted(row) + "  " + dim(bird);
	});
	const jeonseogu = renderWord("JEONSEOGU").map(accent);

	return [
		"",
		...ohMy,
		"",
		...jeonseogu,
		"",
		muted("전서구") + dim(" · oh-my-jeonseogu v" + pkgVersion() + " · pi v" + PI_VERSION),
		dim("/login 로그인 · /help 도움말 · ctrl+c 나가기"),
		"",
	];
}

/** Extension factory passed to pi main(): replaces the built-in header. */
export function jeonseoguBanner(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return; // --print / rpc modes stay silent
		ctx.ui.setHeader((_tui, theme) => ({
			render: () => bannerLines(theme),
			invalidate: () => {},
		}));
		// If cli.ts kicked off the update check, report the outcome once it lands.
		void updateOutcome()?.then((outcome) => {
			if (!outcome) return;
			const piPart = outcome.info.pi.latest !== outcome.info.pi.current
				? " (pi 하네스 v" + outcome.info.pi.latest + " 포함)"
				: "";
			if (outcome.ok) {
				ctx.ui.notify("업데이트 완료: v" + outcome.info.self.latest + piPart + " — 다음 실행부터 적용됨", "info");
			} else {
				ctx.ui.notify("자동 업데이트 실패. 나중에 npm i -g oh-my-jeonseogu@latest 로 직접 하면 됨", "warning");
			}
		});
	});
}
