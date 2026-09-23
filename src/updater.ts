import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface UpdateInfo {
	self: { current: string; latest: string };
	pi: { current: string; latest: string };
}

export interface UpdateOutcome {
	info: UpdateInfo;
	/** npm exited 0. */
	ok: boolean;
}

export const PACKAGE_ROOT = new URL("../", import.meta.url).pathname;

export function pkgVersion(): string {
	try {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

/** Numeric semver-ish compare: is the first version ahead of the second? */
export function isNewer(latest: string, current: string): boolean {
	const a = latest.split(".").map((n) => Number.parseInt(n, 10) || 0);
	const b = current.split(".").map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		if (x > y) return true;
		if (x < y) return false;
	}
	return false;
}

/** Skip auto-update in dev checkouts and when explicitly disabled. */
export function shouldAutoUpdate(noUpdateFlag: boolean): boolean {
	if (noUpdateFlag) return false;
	if (process.env.JEONSEOGU_NO_UPDATE) return false;
	if (existsSync(join(PACKAGE_ROOT, ".git"))) return false; // running from a git clone
	return true;
}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PI_PACKAGE = "@earendil-works/pi-coding-agent";

function cachePath(): string {
	const base =
		process.platform === "win32"
			? (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
			: (process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"));
	return join(base, "oh-my-jeonseogu", "update.json");
}

interface UpdateCache {
	checkedAt: number;
	selfLatest?: string;
	piPackage?: string;
	piLatest?: string;
}

function readCache(): UpdateCache | undefined {
	try {
		const data = JSON.parse(readFileSync(cachePath(), "utf8")) as UpdateCache;
		if (Date.now() - data.checkedAt < CHECK_INTERVAL_MS) return data;
	} catch {
		// no fresh cache
	}
	return undefined;
}

function writeCache(cache: UpdateCache): void {
	try {
		const p = cachePath();
		mkdirSync(join(p, ".."), { recursive: true });
		writeFileSync(p, JSON.stringify(cache));
	} catch {
		// best effort
	}
}

async function latestVersion(pkg: string): Promise<string | undefined> {
	try {
		const res = await fetch("https://registry.npmjs.org/" + encodeURIComponent(pkg) + "/latest", {
			signal: AbortSignal.timeout(4000),
		});
		if (!res.ok) return undefined;
		const data = (await res.json()) as { version?: string };
		return data.version;
	} catch {
		return undefined; // offline / blocked network — never break the CLI
	}
}

/**
 * Check npm for newer versions of ourselves and of the pi harness.
 * Uses a 24h cache; returns null when nothing newer or on any failure.
 */
export async function checkForUpdates(selfVersion: string, piVersion: string): Promise<UpdateInfo | null> {
	const cached = readCache();
	const selfLatest = cached?.selfLatest ?? (await latestVersion("oh-my-jeonseogu"));
	const piLatest = (cached?.piPackage === PI_PACKAGE ? cached.piLatest : undefined) ?? (await latestVersion(PI_PACKAGE));
	if (selfLatest || piLatest) {
		writeCache({ checkedAt: cached?.checkedAt ?? Date.now(), selfLatest, piPackage: PI_PACKAGE, piLatest });
	}
	const info: UpdateInfo = {
		self: { current: selfVersion, latest: selfLatest ?? selfVersion },
		pi: { current: piVersion, latest: piLatest ?? piVersion },
	};
	if (isNewer(info.self.latest, selfVersion) || isNewer(info.pi.latest, piVersion)) return info;
	return null;
}

/** Reinstall the package globally; the pi dependency follows npm's latest tag. */
function runSelfUpdate(): Promise<boolean> {
	return new Promise((resolve) => {
		const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
		const child = spawn(cmd, ["install", "-g", "oh-my-jeonseogu@latest"], {
			detached: true,
			stdio: "ignore",
			shell: process.platform === "win32",
		});
		child.on("error", () => resolve(false));
		child.on("exit", (code) => resolve(code === 0));
	});
}

let started: Promise<UpdateOutcome | null> | undefined;

/** The in-flight update, if cli.ts started one. */
export function updateOutcome(): Promise<UpdateOutcome | null> | undefined {
	return started;
}

/** Singleton: check, then self-update in the background. Never throws. */
export function startAutoUpdate(selfVersion: string, piVersion: string): Promise<UpdateOutcome | null> {
	started ??= (async (): Promise<UpdateOutcome | null> => {
		const info = await checkForUpdates(selfVersion, piVersion);
		if (!info) return null;
		const ok = await runSelfUpdate();
		return { info, ok };
	})();
	return started;
}
