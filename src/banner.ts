import { readFileSync } from "node:fs";
import { VERSION as PI_VERSION, type ExtensionAPI, type Theme } from "@mariozechner/pi-coding-agent";

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
const PIGEON = [" (o>", " \\_//)", "  \\_/_)", "   _|_"];

function pkgVersion(): string {
	try {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function bannerLines(theme: Theme): string[] {
	const accent = (s: string): string => theme.fg("accent", s);
	const muted = (s: string): string => theme.fg("muted", s);
	const dim = (s: string): string => theme.fg("dim", s);

	const ohMy = renderWord("OH-MY").map((row, i) => {
		// pigeon's feet sit on the OH-MY baseline (last row)
		const bird = i >= 1 ? "  " + dim(PIGEON[i - 1]!) : "";
		return muted(row) + bird;
	});
	const jeonseogu = renderWord("JEONSEOGU").map(accent);

	return [
		"",
		...ohMy,
		"",
		...jeonseogu,
		"",
		muted("전서구 말투 캐릭터") + dim(" · oh-my-jeonseogu v" + pkgVersion() + " · pi v" + PI_VERSION),
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
	});
}
