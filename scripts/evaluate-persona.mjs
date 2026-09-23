import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager, VERSION,
} from '@earendil-works/pi-coding-agent';

// Opt-in live evaluation. Saves only final answers, never reasoning or credentials.
const { values } = parseArgs({ options: {
  persona: { type: 'string', default: 'personas/jeonseogu.md' },
  cases: { type: 'string', default: 'eval/persona-cases.json' },
  provider: { type: 'string', default: 'openai-codex' },
  model: { type: 'string', default: 'gpt-5.5' },
  thinking: { type: 'string', default: 'medium' },
  repeat: { type: 'string', default: '3' },
  concurrency: { type: 'string', default: '2' },
  out: { type: 'string' },
  ids: { type: 'string' },
} });
if (!values.out) throw new Error('Specify --out <new JSONL file>');
const repeat = Number(values.repeat);
const concurrency = Number(values.concurrency);
if (!Number.isInteger(repeat) || repeat < 1 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
  throw new Error('--repeat must be positive; --concurrency must be between 1 and 4');
}
if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(values.thinking)) {
  throw new Error('Unsupported --thinking value');
}
const persona = readFileSync(resolve(values.persona), 'utf8');
const allCases = JSON.parse(readFileSync(resolve(values.cases), 'utf8'));
const ids = values.ids?.split(',');
if (ids?.some(id => !allCases.some(c => c.id === id))) throw new Error('Unknown case id');
const cases = allCases.filter(c => !ids || ids.includes(c.id));
if (!cases.length || cases.some(c => !c.id || !Array.isArray(c.turns) || !c.turns.length || c.turns.some(t => typeof t !== 'string'))) {
  throw new Error('Cases must have an id and a nonempty string array of turns');
}
const modelRuntime = await ModelRuntime.create();
const model = modelRuntime.getModel(values.provider, values.model);
if (!model) throw new Error(`Model not found: ${values.provider}/${values.model}`);
const output = resolve(values.out);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({
  type: 'run', date: new Date().toISOString(), piVersion: VERSION,
  provider: model.provider, model: model.id, thinking: values.thinking, repeat,
  persona: values.persona, personaSha256: createHash('sha256').update(persona).digest('hex'),
  cases: values.cases, casesSha256: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
  tools: [], resources: [],
}) + '\n', { flag: 'wx' });
const jobs = cases.flatMap(c => Array.from({ length: repeat }, (_, i) => ({ scenario: c, repetition: i + 1 })));
let next = 0;
let failures = 0;

async function evaluate({ scenario, repetition }) {
  const resourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => persona,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {}, reload: async () => {},
  };
  const { session } = await createAgentSession({
    modelRuntime, model, thinkingLevel: values.thinking, resourceLoader,
    tools: [], noTools: 'all', sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false }, retry: { enabled: false },
      enableAnalytics: false, enableInstallTelemetry: false,
    }),
  });
  try {
    // Pi appends its cwd section even when --system-prompt replaces the persona.
    const suffix = session.systemPrompt.slice(persona.length).trim();
    const expectedSuffix = `<cwd>\n${process.cwd().replaceAll('\\', '/')}\n</cwd>`;
    if (!session.systemPrompt.startsWith(persona) || suffix !== expectedSuffix || session.getActiveToolNames().length) {
      throw new Error('Evaluation isolation failed');
    }
    for (const [turn, input] of scenario.turns.entries()) {
      const started = Date.now();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; void session.abort(); }, 120_000);
      try {
        await session.prompt(input);
      } finally {
        clearTimeout(timer);
      }
      const answer = session.getLastAssistantText() ?? '';
      const last = session.messages.at(-1);
      if (timedOut || !answer || last?.role !== 'assistant' || ['error', 'aborted'].includes(last.stopReason)) {
        throw new Error(timedOut ? 'Timed out' : (last?.errorMessage || 'No completed answer'));
      }
      appendFileSync(output, JSON.stringify({
        type: 'answer', case: scenario.id, repetition, turn: turn + 1,
        input, answer, thinking: session.thinkingLevel,
        stopReason: last.stopReason, usage: last.usage, durationMs: Date.now() - started,
      }) + '\n');
      console.log(`${scenario.id} #${repetition} turn ${turn + 1}: ${answer.replaceAll('\n', ' / ').slice(0, 160)}`);
    }
  } finally {
    session.dispose();
  }
}

async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    try { await evaluate(job); }
    catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : String(error);
      appendFileSync(output, JSON.stringify({ type: 'error', case: job.scenario.id, repetition: job.repetition, error: message }) + '\n');
      console.error(`${job.scenario.id} #${job.repetition}: ${message}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
appendFileSync(output, JSON.stringify({ type: 'complete', jobs: jobs.length, failures }) + '\n');
process.exitCode = failures ? 1 : 0;
