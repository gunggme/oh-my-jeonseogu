import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { after, before, describe, it } from "node:test";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { ChatPrinter } from "../src/printer.js";
import { createChatSession, loadSystemPrompt, resolveModel } from "../src/session.js";
import { MessageSplitter } from "../src/splitter.js";

const REPLY = "그래\n---\n만들어라\n---\n재밌겠네";

function sseChunk(delta: Record<string, unknown>, finish: string | null = null): string {
	const payload = {
		id: "chatcmpl-mock",
		object: "chat.completion.chunk",
		created: 1,
		model: "mock-1",
		choices: [{ index: 0, delta, finish_reason: finish }],
	};
	return "data: " + JSON.stringify(payload) + "\n\n";
}

describe("e2e: session against a mock OpenAI endpoint", () => {
	let server: Server;
	let port = 0;
	let lastRequest: any;

	before(async () => {
		server = createServer((req, res) => {
			let body = "";
			req.on("data", (c) => (body += c));
			req.on("end", () => {
				lastRequest = JSON.parse(body);
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.write(sseChunk({ role: "assistant" }));
				// Small chunks so the delimiter itself is split across deltas.
				for (let i = 0; i < REPLY.length; i += 4) {
					res.write(sseChunk({ content: REPLY.slice(i, i + 4) }));
				}
				res.write(sseChunk({}, "stop"));
				res.write(
					'data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1,"model":"mock-1","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}' +
						"\n\ndata: [DONE]\n\n",
				);
				res.end();
			});
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		port = (server.address() as { port: number }).port;
	});

	after(() => server.close());

	it("sends the persona system prompt and renders split messages", async () => {
		const dir = mkdtempSync(join(tmpdir(), "jeonseogu-test-"));
		const modelsJson = join(dir, "models.json");
		writeFileSync(
			modelsJson,
			JSON.stringify({
				providers: {
					mock: {
						baseUrl: "http://127.0.0.1:" + port + "/v1",
						api: "openai-completions",
						apiKey: "test",
						compat: {
							supportsDeveloperRole: false,
							supportsReasoningEffort: false,
							supportsUsageInStreaming: false,
						},
						models: [
							{
								id: "mock-1",
								name: "Mock",
								reasoning: false,
								input: ["text"],
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
								contextWindow: 128000,
								maxTokens: 4096,
							},
						],
					},
				},
			}),
		);

		const authStorage = AuthStorage.create();
		const registry = ModelRegistry.create(authStorage, modelsJson);
		const model = resolveModel(registry, "mock:mock-1");
		assert.ok(model, "mock model should resolve");

		const { session } = await createChatSession({
			cwd: dir,
			model,
			systemPrompt: loadSystemPrompt(),
			authStorage,
			modelRegistry: registry,
		});

		let buf = "";
		const out = new Writable({
			write(c, _e, cb) {
				buf += c.toString();
				cb();
			},
		});
		const printer = new ChatPrinter({ delays: false, out });
		const splitter = new MessageSplitter();
		session.subscribe((event) => {
			if (event.type === "message_update") {
				const e = event.assistantMessageEvent;
				if (e.type === "text_delta") for (const ev of splitter.feed(e.delta)) printer.handle(ev);
			} else if (event.type === "message_end" && event.message.role === "assistant") {
				for (const ev of splitter.end()) printer.handle(ev);
				printer.finish();
			}
		});

		await session.prompt("안녕");
		printer.finish();
		await printer.drain();
		session.dispose();

		// The persona system prompt reached the provider.
		const sys = lastRequest.messages[0];
		assert.match(sys.content, /전서구/);
		assert.match(sys.content, /출력 형식/);
		const last = lastRequest.messages.at(-1);
		const lastText = typeof last.content === "string" ? last.content : last.content[0]?.text;
		assert.equal(lastText, "안녕");

		// Three messages rendered with the bird prefix, in order.
		const plain = buf.replaceAll(/\x1b\[[0-9;]*m/g, "");
		const lines = plain.trim().split("\n");
		assert.equal(lines.length, 3);
		assert.ok(lines.every((l) => l.startsWith("🐦 ")), plain);
		assert.deepEqual(
			lines.map((l) => l.slice(3)),
			["그래", "만들어라", "재밌겠네"],
		);
	});
});
