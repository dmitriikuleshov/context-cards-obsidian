// Re-run the production pipeline on recorded responses. Every outgoing JSON payload
// must exactly match the original live request, otherwise the replay is invalid.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deepStrictEqual } from 'node:assert';

const folders = process.argv.slice(2);
if (!folders.length) throw new Error('Pass one or more completed live audit folders');
const out = resolve('.test-artifacts/writing-replay');
await mkdir(out, { recursive: true });
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
      name: 'replay-transport',
      setup(b) {
        b.onLoad({ filter: /[\\/]src[\\/]http\.ts$/ }, async (args) => {
          const source = await readFile(args.path, 'utf8');
          return {
            loader: 'ts',
            contents:
              source.slice(0, source.indexOf('export function jsonRequest<T>(')) +
              `export async function jsonRequest<T>(url: string, data?: unknown): Promise<T> { return (globalThis as any).__replayHTTP(url, data); }`,
          };
        });
      },
    },
  ],
});
const { WritingModel, DEFAULTS, correctedSentence } = await import(
  pathToFileURL(resolve(out, 'client.mjs'))
);
for (const folder of folders) {
  const cases = JSON.parse(await readFile(resolve(folder, 'cases.json'), 'utf8'));
  const original = JSON.parse(await readFile(resolve(folder, 'results.json'), 'utf8'));
  const meta = JSON.parse(await readFile(resolve(folder, 'run.json'), 'utf8'));
  const traces = (await readFile(resolve(folder, 'transport.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const models = new Set(original.map((r) => r.model));
  if (models.size !== 4 || original.length !== 4 * cases.length)
    throw new Error('Incomplete live audit');
  const results = [];
  let payloadsMatched = 0;
  for (const recorded of original) {
    const c = cases.find((c) => c.id === recorded.id);
    const pending = traces.filter((t) => t.model === recorded.model && t.id === c.id);
    globalThis.__replayHTTP = async (url, data) => {
      const next = pending.shift();
      if (!next) throw new Error('Replay requested an extra model call');
      deepStrictEqual(data, next.request, `Request changed for ${recorded.model} / ${c.id}`);
      if (!url.endsWith('/api/chat')) throw new Error('Unexpected endpoint');
      payloadsMatched++;
      if (next.error) throw new Error(next.error);
      return structuredClone(next.response);
    };
    const model = new WritingModel({
      ...DEFAULTS,
      model: recorded.model,
      timeoutSeconds: 300,
      writing: { ...DEFAULTS.writing, ...c.writing },
    });
    const analysis = await model.analyse(c.text, new AbortController().signal);
    const actual = analysis.findings.map(correctedSentence);
    const row = {
      model: recorded.model,
      id: c.id,
      expected: c.expected,
      actual,
      findings: analysis.findings,
      missing: c.expected.filter((s) => !actual.includes(s)),
      extra: actual.filter((s) => !c.expected.includes(s)),
    };
    if (meta.cards && c.cards !== false) {
      row.cards = [];
      for (const f of analysis.findings.filter((f) => f.selected))
        for (const format of f.after.trim() ? ['correction', 'gap'] : ['correction'])
          row.cards.push({
            finding: f.id,
            ...(await model.exercise(
              { ...f, format },
              new AbortController().signal,
              analysis.findings,
            )),
          });
    }
    if (pending.length) throw new Error('Replay skipped a recorded model call');
    row.pass = !row.missing.length && !row.extra.length;
    results.push(row);
  }
  await writeFile(
    resolve(folder, 'replay-results.json'),
    JSON.stringify({ payloadsMatched, results }, null, 2),
  );
  console.log(
    JSON.stringify({
      folder,
      payloadsMatched,
      cases: results.length,
      passed: results.filter((r) => r.pass).length,
    }),
  );
}
