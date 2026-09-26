import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface UpdateInfo {
	self: { current: string; latest: string };
	pi: { current: string; latest: string };
}

export const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));

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

/** Skip update checks in dev checkouts and when explicitly disabled. */
export function shouldCheckForUpdates(noUpdateFlag: boolean): boolean {
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
	dismissedSelf?: string;
	dismissedPi?: string;
}

function version(value: unknown): string | undefined {
	return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(value) ? value : undefined;
}

function readCache(): UpdateCache | undefined {
	try {
		const data: unknown = JSON.parse(readFileSync(cachePath(), "utf8"));
		if (typeof data !== "object" || data === null || !("checkedAt" in data)) return undefined;
		return {
			checkedAt: typeof data.checkedAt === "number" && Number.isFinite(data.checkedAt) ? data.checkedAt : 0,
			selfLatest: "selfLatest" in data ? version(data.selfLatest) : undefined,
			piPackage: "piPackage" in data && data.piPackage === PI_PACKAGE ? PI_PACKAGE : undefined,
			piLatest: "piLatest" in data ? version(data.piLatest) : undefined,
			dismissedSelf: "dismissedSelf" in data ? version(data.dismissedSelf) : undefined,
			dismissedPi: "dismissedPi" in data ? version(data.dismissedPi) : undefined,
		};
	} catch {
		// Missing or corrupt cache must not prevent startup.
	}
	return undefined;
}

function writeCache(cache: UpdateCache): boolean {
	try {
		const p = cachePath();
		mkdirSync(join(p, ".."), { recursive: true });
		writeFileSync(p, JSON.stringify(cache));
		return true;
	} catch {
		return false;
	}
}

async function latestVersion(pkg: string): Promise<string | undefined> {
	try {
		const res = await fetch("https://registry.npmjs.org/" + encodeURIComponent(pkg) + "/latest", {
			signal: AbortSignal.timeout(4000),
		});
		if (!res.ok) return undefined;
		const data: unknown = await res.json();
		return typeof data === "object" && data !== null && "version" in data ? version(data.version) : undefined;
	} catch {
		return undefined; // offline / blocked network — never break the CLI
	}
}

/**
 * Check npm for newer versions of ourselves and of the pi harness.
 * Uses a 24h cache; returns null when nothing new needs to be shown.
 */
export async function checkForUpdates(selfVersion: string, piVersion: string): Promise<UpdateInfo | null> {
	const cached = readCache();
	const age = cached ? Date.now() - cached.checkedAt : Infinity;
	const fresh = age >= 0 && age < CHECK_INTERVAL_MS ? cached : undefined;
	const [selfLatest, piLatest] = await Promise.all([
		fresh?.selfLatest ?? latestVersion("oh-my-jeonseogu"),
		(fresh?.piPackage === PI_PACKAGE ? fresh.piLatest : undefined) ?? latestVersion(PI_PACKAGE),
	]);
	if (selfLatest || piLatest) {
		writeCache({ ...cached, checkedAt: fresh?.checkedAt ?? Date.now(), selfLatest, piPackage: PI_PACKAGE, piLatest });
	}
	const info: UpdateInfo = {
		self: { current: selfVersion, latest: selfLatest ?? selfVersion },
		pi: { current: piVersion, latest: piLatest ?? piVersion },
	};
	const showSelf = isNewer(info.self.latest, selfVersion) && (!cached?.dismissedSelf || isNewer(info.self.latest, cached.dismissedSelf));
	const showPi = isNewer(info.pi.latest, piVersion) && (!cached?.dismissedPi || isNewer(info.pi.latest, cached.dismissedPi));
	if (showSelf || showPi) return info;
	return null;
}

/** Keep dismissals even after the registry cache expires. */
export function dismissUpdate(info: UpdateInfo): boolean {
	const cached = readCache();
	return writeCache({
		...cached, checkedAt: cached?.checkedAt ?? 0,
		dismissedSelf: info.self.latest, dismissedPi: info.pi.latest,
	});
}

/** Only called after the user chooses to update, before pi takes over the terminal. */
export function runSelfUpdate(): Promise<boolean> {
	return new Promise((resolve) => {
		const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
		const child = spawn(cmd, ["install", "-g", "oh-my-jeonseogu@latest"], {
			stdio: "inherit",
			shell: process.platform === "win32",
		});
		child.on("error", () => resolve(false));
		child.on("close", (code) => resolve(code === 0));
	});
}
