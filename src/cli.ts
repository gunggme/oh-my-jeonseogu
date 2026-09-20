#!/usr/bin/env node
import { readFileSync } from "node:fs";
import * as readline from "node:readline";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { AuthStorage, ModelRegistry, type AgentSession } from "@mariozechner/pi-coding-agent";
import { parseArgv, USAGE } from "./args.js";
import { ChatPrinter } from "./printer.js";
import { createChatSession, defaultSessionDir, loadSystemPrompt, resolveModel } from "./session.js";
import { MessageSplitter } from "./splitter.js";

const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function pkgVersion(): string {
	try {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function err(msg: string): void {
	process.stderr.write(RED + msg + RESET + "\n");
}

function readStdin(): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (c) => (data += c));
		process.stdin.on("end", () => resolve(data.trim()));
		process.stdin.on("error", reject);
	});
}

const NO_KEY_HINT = [
	"사용 가능한 모델이 없음. API 키가 필요하다:",
	"  ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY 등을 환경변수로 설정하거나",
	"  pi CLI로 로그인해서 ~/.pi/agent/auth.json 을 채우면 됨",
].join("\n");

async function main(): Promise<void> {
	const parsed = parseArgv(process.argv.slice(2));
	if (!parsed.ok) {
		err(parsed.error);
		process.stderr.write(USAGE + "\n");
		process.exit(2);
	}
	const opts = parsed.options;

	if (opts.help) {
		process.stdout.write(USAGE + "\n");
		return;
	}
	if (opts.version) {
		process.stdout.write(pkgVersion() + "\n");
		return;
	}
	if (opts.thinking && !THINKING_LEVELS.includes(opts.thinking as ThinkingLevel)) {
		err("--think must be one of: " + THINKING_LEVELS.join(", "));
		process.exit(2);
	}

	let systemPrompt: string;
	try {
		systemPrompt = loadSystemPrompt(opts.persona);
	} catch {
		err("페르소나 파일을 못 읽음: " + (opts.persona ?? "personas/jeonseogu.md"));
		process.exit(1);
	}

	const cwd = process.cwd();
	const sessionOpts = {
		cwd,
		sessionDir: opts.ephemeral ? undefined : defaultSessionDir(cwd),
		continueRecent: opts.continueSession,
		thinkingLevel: (opts.thinking ?? "off") as ThinkingLevel,
		tools: opts.tools,
		systemPrompt,
	};

	const authStorage = AuthStorage.create();
	const registry = ModelRegistry.create(authStorage);

	const model = resolveModel(registry, opts.model);
	if (!model) {
		if (opts.model) {
			err("모델을 못 찾음: " + opts.model);
			const avail = registry.getAvailable();
			if (avail.length > 0) {
				err("사용 가능: " + avail.map((m) => m.provider + "/" + m.id).join(", "));
			} else {
				err(NO_KEY_HINT);
			}
		} else {
			err(NO_KEY_HINT);
		}
		process.exit(1);
	}
	if (opts.model && !registry.hasConfiguredAuth(model)) {
		err("모델은 있는데 자격증명이 없음: " + model.provider + "/" + model.id);
		err(NO_KEY_HINT);
		process.exit(1);
	}

	const printerOpts = { delays: !opts.noDelay && !!process.stdout.isTTY };
	const printer = new ChatPrinter(printerOpts);
	const splitter = new MessageSplitter();

	let chat = await createChatSession({ ...sessionOpts, model, authStorage, modelRegistry: registry });
	let session = chat.session;

	const wire = (s: AgentSession): (() => void) =>
		s.subscribe((event) => {
			switch (event.type) {
				case "message_update": {
					const e = event.assistantMessageEvent;
					if (e.type === "text_delta") {
						for (const ev of splitter.feed(e.delta)) printer.handle(ev);
					} else if (e.type === "error") {
						printer.error("오류: " + (e.error.errorMessage ?? "unknown"));
					}
					break;
				}
				case "message_end":
					if (event.message.role === "assistant") {
						for (const ev of splitter.end()) printer.handle(ev);
						printer.finish();
					}
					break;
				case "auto_retry_start":
					printer.note("잠깐 렉 걸림, 재시도 중…");
					break;
			}
		});

	let unwire = wire(session);

	const modelLabel = () => {
		const m = session.model;
		return m ? m.provider + "/" + m.id : "none";
	};

	// One-shot: positional message, -p flag, or piped stdin.
	let oneShot = opts.print ?? opts.message;
	if (oneShot === undefined && !process.stdin.isTTY) {
		oneShot = await readStdin();
	}
	if (oneShot !== undefined) {
		if (!oneShot) process.exit(0);
		try {
			await session.prompt(oneShot);
		} catch (e) {
			printer.error(String(e instanceof Error ? e.message : e));
		}
		printer.finish();
		await printer.drain();
		session.dispose();
		return;
	}

	// Interactive REPL.
	process.stdout.write(
		DIM + "oh-my-jeonseogu " + pkgVersion() + " — " + modelLabel() + " — /help" + RESET + "\n",
	);

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: CYAN + "› " + RESET,
		historySize: 200,
	});
	rl.prompt();

	const runPrompt = async (text: string): Promise<void> => {
		if (session.isStreaming) {
			await session.followUp(text);
			printer.note("(답변 끝나면 이어서 전달)");
			return;
		}
		try {
			await session.prompt(text);
			await session.agent.waitForIdle();
		} catch (e) {
			printer.error(String(e instanceof Error ? e.message : e));
		}
		printer.finish();
		await printer.drain();
	};

	const handleCommand = async (line: string): Promise<void> => {
		const [cmd, ...rest] = line.split(/\s+/);
		switch (cmd) {
			case "/quit":
			case "/exit":
				rl.close();
				return;
			case "/help":
				printer.note(USAGE);
				break;
			case "/new": {
				unwire();
				session.dispose();
				chat = await createChatSession({ ...sessionOpts, model: session.model });
				session = chat.session;
				unwire = wire(session);
				splitter.reset();
				printer.note("새 대화 시작");
				break;
			}
			case "/model": {
				const spec = rest.join(" ").trim();
				if (!spec) {
					printer.note("현재 모델: " + modelLabel());
					break;
				}
				const m = resolveModel(registry, spec);
				if (!m) {
					printer.error("모델을 못 찾음: " + spec);
					break;
				}
				if (!registry.hasConfiguredAuth(m)) {
					printer.error("자격증명 없음: " + m.provider + "/" + m.id);
					break;
				}
				await session.setModel(m);
				printer.note("모델 변경: " + modelLabel());
				break;
			}
			case "/models": {
				const avail = registry.getAvailable();
				printer.note(
					avail.length > 0
						? avail.map((m) => m.provider + "/" + m.id).join("\n")
						: "사용 가능한 모델 없음",
				);
				break;
			}
			case "/delay":
				printerOpts.delays = !printerOpts.delays;
				printer.note("딜레이 " + (printerOpts.delays ? "켬" : "끔"));
				break;
			default:
				printer.note("모르는 명령: " + cmd + " (/help)");
		}
	};

	rl.on("line", (line) => {
		const text = line.trim();
		const done = () => rl.prompt();
		if (!text) return done();
		const work = text.startsWith("/") ? handleCommand(text) : runPrompt(text);
		work.catch((e) => printer.error(String(e))).finally(done);
	});

	rl.on("SIGINT", () => {
		if (session.isStreaming) {
			void session.abort();
			printer.note("중단함");
			rl.prompt();
		} else {
			rl.close();
		}
	});

	rl.on("close", () => {
		session.dispose();
		process.stdout.write("\n");
		process.exit(0);
	});
}

main().catch((e) => {
	err(String(e instanceof Error ? e.stack ?? e.message : e));
	process.exit(1);
});
