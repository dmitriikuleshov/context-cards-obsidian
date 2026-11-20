// Local model evaluation on short vocabulary passages inspired by the supplied canvas. No Anki writes.
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
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
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const cases = [
  { target: 'stilted', source: 'He spoke in a dreamy, stilted manner.' },
  {
    target: 'obscurity',
    source: 'Interest was intensified by the obscurity of the cause of death.',
  },
  {
    target: 'straining',
    source: 'The sciences, each straining in its own direction, have hitherto harmed us little.',
  },
  {
    target: 'brisk',
    source: 'Death was induced by the brisk ascent of so steep a hill by so elderly a man.',
  },
  {
    target: 'resorted to',
    source: 'The method had frequently been resorted to when other approaches failed.',
  },
  {
    target: 'conspicuous',
    source:
      'My uncle showed some sharpness in replying, for the conspicuous freshness of the tablet implied kinship with anything but archaeology.',
  },
  {
    target: 'besieged',
    source:
      'When the professor became convinced that the sculptor knew nothing of any cult, he besieged his visitor with demands for future reports of dreams.',
  },
  { target: 'damp', source: 'The bas-relief was exceedingly damp and fresh.' },
];
const label = process.argv[2] ?? 'latest',
  results = [];
if (!/^[a-z0-9_-]+$/i.test(label)) throw new Error('Use a simple report label.');
for (const item of cases) {
  try {
    const result = await new Ollama(DEFAULTS).generate(
      item.target,
      item.source,
      new AbortController().signal,
    );
    results.push({ ...item, ...result });
    console.log(
      item.target + ' ' + result.seconds.toFixed(1) + 's ' + JSON.stringify(result.content),
    );
  } catch (e) {
    results.push({ ...item, error: String(e) });
    console.log(String(e));
  }
}
await writeFile(
  'experiments/canvas-' + label + '.json',
  JSON.stringify({ date: new Date().toISOString(), results }, null, 2),
);
