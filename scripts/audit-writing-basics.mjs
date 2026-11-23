// Live, synthetic-only Find mistakes audit. Never writes vault data or Anki notes.
// AUDIT_DIR must identify one immutable code/settings run; completed cases resume.
// Gold corrections are used only by the scorer, never sent to the model.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { scoreWritingEdits } from './writing-audit-score.mjs';

const out = resolve(process.env.AUDIT_DIR || '.test-artifacts/writing-basics-baseline');
await mkdir(out, { recursive: true });
const models = process.argv.slice(2);
if (!models.length)
  models.push('gemma3:12b-it-q4_K_M', 'gemma4:12b-it-qat', 'qwen3:14b-q4_K_M', 'qwen3.5:9b-q4_K_M');
const url = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const api = async (path, body) => {
  const r = await fetch(url + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
  return r.json();
};
// Each expected item is the result of ONE local correction, with peer errors unchanged.
const cases = [
  {
    id: 'user-english',
    text: 'This is my hand-written text and I want AI to check it for mistakes. I started to learn english a few years ago. This is good',
    expected: ['I started to learn English a few years ago.'],
  },
  { id: 'agreement', text: 'She work in a hospital.', expected: ['She works in a hospital.'] },
  {
    id: 'past-participle',
    text: 'I have wrote three letters today.',
    expected: ['I have written three letters today.'],
  },
  {
    id: 'past-perfect',
    text: 'I had never saw him before that day.',
    expected: ['I had never seen him before that day.'],
  },
  {
    id: 'conditional',
    text: 'If I were you, I will take the train.',
    expected: ['If I were you, I would take the train.'],
  },
  {
    id: 'article-missing',
    text: 'She bought new car yesterday.',
    expected: ['She bought a new car yesterday.'],
  },
  {
    id: 'article-sound',
    text: 'It took a hour to finish.',
    expected: ['It took an hour to finish.'],
  },
  {
    id: 'preposition',
    text: 'We discussed about the problem yesterday.',
    expected: ['We discussed the problem yesterday.'],
  },
  { id: 'question-order', text: 'Where you live?', expected: ['Where do you live?'] },
  {
    id: 'collocation',
    text: 'I did a mistake in my report.',
    expected: ['I made a mistake in my report.'],
  },
  {
    id: 'spelling',
    text: 'I received a mesage from my sister.',
    expected: ['I received a message from my sister.'],
  },
  {
    id: 'adjacent',
    text: 'She have wrote a letter.',
    expected: ['She has wrote a letter.', 'She have written a letter.'],
  },
  {
    id: 'clean-user',
    text: 'This is my hand-written text and I want AI to check it for mistakes. I started to learn English a few years ago. This is good.',
    expected: [],
  },
  { id: 'clean-past', text: 'I started learning English three years ago.', expected: [] },
  { id: 'clean-conditional', text: 'If I were you, I would take the train.', expected: [] },
  { id: 'clean-complements', text: 'I like reading. I like to read before bed.', expected: [] },
  {
    id: 'american-spelling',
    text: 'The colour of the centre is unusual.',
    expected: ['The color of the centre is unusual.', 'The colour of the center is unusual.'],
  },
  { id: 'clean-good', text: 'This is good. She is a good teacher. He works hard.', expected: [] },
  // Held-out lexical substitutions: do not use these as prompt examples.
  {
    id: 'held-agreement',
    heldOut: true,
    text: 'My brother play tennis on Sundays.',
    expected: ['My brother plays tennis on Sundays.'],
  },
  {
    id: 'held-participle',
    heldOut: true,
    text: 'They have went home.',
    expected: ['They have gone home.'],
  },
  { id: 'held-article', heldOut: true, text: 'He is engineer.', expected: ['He is an engineer.'] },
  { id: 'held-question', heldOut: true, text: 'What she want?', expected: ['What does she want?'] },
  {
    id: 'held-negative',
    heldOut: true,
    text: 'He does not likes coffee.',
    expected: ['He does not like coffee.'],
  },
  {
    id: 'held-clean',
    heldOut: true,
    text: 'She has lived here since 2020. Yesterday, she visited her parents.',
    expected: [],
  },
];
if (process.env.AUDIT_CASES_FILE) {
  const supplied = JSON.parse(await readFile(process.env.AUDIT_CASES_FILE, 'utf8'));
  if (!Array.isArray(supplied) || !supplied.length) throw new Error('Expected nonempty cases');
  cases.splice(0, cases.length, ...supplied);
}
const chosen = cases.filter((c) =>
  process.env.AUDIT_SET === 'held'
    ? c.heldOut
    : process.env.AUDIT_SET === 'base'
      ? !c.heldOut
      : true,
);
const caseFile = resolve(out, 'cases.json');
const caseSnapshot = JSON.stringify(cases, null, 2);
try {
  if ((await readFile(caseFile, 'utf8')) !== caseSnapshot)
    throw new Error('Cases changed: use a new AUDIT_DIR');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  await writeFile(caseFile, caseSnapshot);
}
// A resumable run always uses its frozen client, even if the working tree changed.
let frozen = false;
try {
  await readFile(resolve(out, 'client.mjs'));
  frozen = true;
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
if (!frozen)
  await build({
    stdin: {
      contents: `export {WritingModel} from './src/writing-model.ts'; export {DEFAULTS} from './src/types.ts'; export {correctedSentence} from './src/writing.ts';`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: resolve(out, 'client.mjs'),
    plugins: [
      {
        name: 'observe-transport',
        setup(b) {
          b.onLoad({ filter: /[\\/]src[\\/]http\.ts$/ }, async (args) => ({
            loader: 'ts',
            contents:
              (await readFile(args.path, 'utf8')).replace(
                'export function jsonRequest<T>(',
                'function baseJsonRequest<T>(',
              ) +
              `\nexport async function jsonRequest<T>(...args: Parameters<typeof baseJsonRequest<T>>): Promise<T> { const start=performance.now(); try { const response=await baseJsonRequest<T>(...args); await (globalThis as any).__auditTransport?.({request:args[1],timeoutMs:args[3],elapsedMs:performance.now()-start,response}); return response; } catch(error) { await (globalThis as any).__auditTransport?.({request:args[1],elapsedMs:performance.now()-start,error:String(error)}); throw error; } }`,
          }));
        },
      },
    ],
  });
const hash = createHash('sha256')
  .update(await readFile(resolve(out, 'client.mjs')))
  .digest('hex');
await writeFile(
  resolve(out, 'run.json'),
  JSON.stringify(
    {
      clientSHA256: hash,
      thinking: false,
      temperature: 0,
      timeoutSeconds: 300,
      cards: !!process.env.AUDIT_CARDS,
    },
    null,
    2,
  ),
);
const { WritingModel, DEFAULTS, correctedSentence } = await import(
  pathToFileURL(resolve(out, 'client.mjs'))
);
const installed = new Set((await api('/api/tags')).models.map((m) => m.name));
for (const model of models)
  if (!installed.has(model)) throw new Error(`Model not installed: ${model}`);
const resultsFile = resolve(out, 'results.json');
let results = [];
try {
  results = JSON.parse(await readFile(resultsFile, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
for (const model of models) {
  if (chosen.every((c) => results.some((r) => r.model === model && r.id === c.id))) continue;
  for (const loaded of (await api('/api/ps')).models)
    if (loaded.name !== model) await api('/api/generate', { model: loaded.name, keep_alive: 0 });
  for (const c of chosen) {
    if (results.some((r) => r.model === model && r.id === c.id)) continue;
    let calls = 0;
    globalThis.__auditTransport = async (trace) => {
      calls++;
      await appendFile(
        resolve(out, 'transport.jsonl'),
        JSON.stringify({ model, id: c.id, ...trace }) + '\n',
      );
    };
    const started = performance.now();
    const row = { model, id: c.id, heldOut: !!c.heldOut, expected: c.expected };
    const client = new WritingModel({
      ...DEFAULTS,
      model,
      ollamaUrl: url,
      timeoutSeconds: 300,
      writing: { ...DEFAULTS.writing, ...c.writing },
    });
    try {
      const analysis = await client.analyse(c.text, new AbortController().signal);
      row.findings = analysis.findings;
      row.actual = analysis.findings.map((f) => correctedSentence(f));
      Object.assign(row, scoreWritingEdits(row.actual, c));
      if (process.env.AUDIT_CARDS && c.cards !== false) {
        row.cards = [];
        for (const f of analysis.findings.filter((f) => f.selected)) {
          for (const format of f.after.trim() ? ['correction', 'gap'] : ['correction']) {
            const card = await client.exercise(
              { ...f, format },
              new AbortController().signal,
              analysis.findings,
            );
            row.cards.push({ finding: f.id, ...card });
          }
        }
      }
    } catch (error) {
      row.error = error.message;
      row.pass = false;
    }
    row.elapsedMs = Math.round(performance.now() - started);
    row.calls = calls;
    results.push(row);
    await writeFile(resultsFile, JSON.stringify(results, null, 2));
    console.log(
      JSON.stringify({
        model,
        id: c.id,
        pass: row.pass,
        missing: row.missing,
        extra: row.extra,
        error: row.error,
        seconds: Math.round(row.elapsedMs / 100) / 10,
        calls,
      }),
    );
  }
}
for (const model of models) {
  const rows = results.filter((r) => r.model === model);
  console.log(
    JSON.stringify({
      model,
      total: rows.length,
      passed: rows.filter((r) => r.pass).length,
      errors: rows.filter((r) => r.error).length,
      missed: rows.reduce((n, r) => n + (r.missing?.length || 0), 0),
      extra: rows.reduce((n, r) => n + (r.extra?.length || 0), 0),
    }),
  );
}
