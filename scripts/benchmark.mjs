// Runs the actual plugin client on synthetic passages. Does not write to Anki or download models.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const bundle = await build({
  stdin: {
    contents: `export {Ollama} from './src/ollama.ts';export {DEFAULTS} from './src/types.ts';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { Ollama, DEFAULTS } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const models = process.argv.slice(2);
if (!models.length) models.push(DEFAULTS.model);
const cases = [
  {
    target: 'brushed off',
    source: 'She brushed off my warning and walked onto the thin ice.',
    expected: 'dismiss/ignore; lemma brush off',
  },
  {
    target: 'fine',
    source: 'The judge ordered him to pay a fine of two hundred pounds for illegal parking.',
    expected: 'noun: monetary penalty; both examples nouns',
  },
  {
    target: 'provided that',
    source: 'You may borrow the car provided that you bring it back before midnight.',
    expected: 'conjunction: on condition that; preserve the phrase',
  },
  {
    target: 'moot',
    source: 'Since the trip had already been cancelled, the question of who would drive was moot.',
    expected: 'no longer practically relevant, not open to debate',
  },
  {
    target: 'tabled',
    source:
      'In the British committee meeting, the chair tabled a motion for discussion. The members began debating it immediately.',
    expected: 'presented for discussion, not postponed',
  },
  {
    target: 'bank',
    source: 'She waited near the bank.',
    expected: 'ambiguous: river bank or financial institution',
  },
  {
    target: 'zindlebrate',
    source: 'We should zindlebrate the plan before Friday.',
    expected: 'unknown: do not invent a definition',
  },
];
const results = [];
for (const model of models) {
  const client = new Ollama({ ...DEFAULTS, model, timeoutSeconds: 120 });
  console.log(`\n${model}`);
  for (const item of cases) {
    try {
      const result = await client.generate(item.target, item.source, new AbortController().signal);
      results.push({ model, ...item, ...result });
      console.log(
        `${item.target}: ${result.seconds.toFixed(2)}s · ${result.content.status} · ${result.content.meaning}`,
      );
    } catch (error) {
      results.push({ model, ...item, error: String(error) });
      console.log(`${item.target}: ${String(error)}`);
    }
  }
}
await mkdir('.test-artifacts', { recursive: true });
await writeFile(
  '.test-artifacts/plugin-benchmark.json',
  JSON.stringify({ date: new Date().toISOString(), results }, null, 2),
);
console.log(
  '\nSaved .test-artifacts/plugin-benchmark.json. Structural success is not a guarantee of semantic correctness.',
);
