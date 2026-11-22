// Optional live model regression check. Synthetic text only; never contacts Anki or edits a vault.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const bundle = await build({
  stdin: {
    contents:
      "export {WritingModel} from './src/writing-model.ts';export {DEFAULTS} from './src/types.ts';export {writingPracticeFields} from './src/writing.ts';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { WritingModel, DEFAULTS, writingPracticeFields } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const settings = {
  ...DEFAULTS,
  ollamaUrl: process.env.OLLAMA_URL || DEFAULTS.ollamaUrl,
  model: process.env.OLLAMA_MODEL || DEFAULTS.model,
};
const model = new WritingModel(settings);
await mkdir('.test-artifacts', { recursive: true });
const cases = [
  {
    name: 'user-reproduction',
    text: 'This is my hand-written text and I want AI to check it for mistakes. I started to learn english a few years ago. This is good',
    expected: [['english', 'English']],
  },
  {
    name: 'clean-past-time',
    text: 'I started to learn English a few years ago. This is good.',
    expected: [],
  },
  {
    name: 'clean-natural-English',
    text: 'If I were you, I would do it another way. She has lived here since 2015. I have already finished my homework.',
    expected: [],
  },
  {
    name: 'participle-and-collocation',
    text: 'I have wrote three stories this week. I did a mistake yesterday.',
    expected: [
      ['wrote', 'written'],
      ['did', 'made'],
    ],
    cards: true,
  },
  {
    name: 'two-targets-one-sentence',
    text: 'She have wrote three stories this week.',
    expected: [
      ['have', 'has'],
      ['wrote', 'written'],
    ],
    cards: true,
  },
  {
    name: 'typo-near-grammar',
    text: 'I have wrote a stroy.',
    expected: [
      ['wrote', 'written'],
      ['stroy', 'story'],
    ],
    cards: true,
  },
  {
    name: 'deletion',
    text: 'We discussed about the plan yesterday.',
    expected: [['about ', '']],
    cards: true,
  },
  {
    name: 'clean-repeated-sentences',
    text: 'I finished the report yesterday. I finished the report yesterday.',
    expected: [],
  },
  { name: 'regional-accept-both', text: 'The colour of the centre is beautiful.', expected: [] },
  {
    name: 'regional-american',
    writing: { variant: 'american' },
    text: 'The colour of the centre is beautiful.',
    expected: [
      ['colour', 'color'],
      ['centre', 'center'],
    ],
  },
  {
    name: 'regional-british',
    writing: { variant: 'british' },
    text: 'The color of the center is beautiful.',
    expected: [
      ['color', 'colour'],
      ['center', 'centre'],
    ],
  },
  {
    name: 'spelling-only',
    writing: { grammar: false, vocabulary: false },
    text: 'I have wrote a stroy.',
    expected: [['stroy', 'story']],
  },
  {
    name: 'default-correction',
    writing: { exercise: 'correction' },
    text: 'I have wrote three stories this week.',
    expected: [['wrote', 'written']],
    preferredFormat: 'correction',
    cards: true,
  },
  {
    name: 'default-gap',
    writing: { exercise: 'gap' },
    text: 'I have wrote three stories this week.',
    expected: [['wrote', 'written']],
    preferredFormat: 'gap',
    cards: true,
  },
];
const results = [];
for (const c of cases) {
  const started = performance.now();
  try {
    const activeModel = c.writing
      ? new WritingModel({ ...settings, writing: { ...DEFAULTS.writing, ...c.writing } })
      : model;
    const analysis = await activeModel.analyse(c.text, new AbortController().signal);
    if (c.preferredFormat && analysis.findings.some((f) => f.format !== c.preferredFormat))
      throw new Error(`Expected the ${c.preferredFormat} default for each correction.`);
    const analysisSeconds = +((performance.now() - started) / 1000).toFixed(1);
    const targets = analysis.findings.map((f) => [f.before, f.after]);
    const missing =
      c.expected?.filter((e) => !targets.some((t) => t[0] === e[0] && t[1] === e[1])) ?? [];
    const extras = c.expected
      ? targets.filter((t) => !c.expected.some((e) => t[0] === e[0] && t[1] === e[1]))
      : [];
    const cards = [];
    if (c.cards)
      for (const f of analysis.findings.filter((f) => f.selected)) {
        for (const format of f.after ? ['correction', 'gap'] : ['correction']) {
          f.format = format;
          f.card = await activeModel.exercise(f, new AbortController().signal, analysis.findings);
          writingPracticeFields(f);
          cards.push({ target: f.before, ...f.card });
        }
      }
    const item = {
      name: c.name,
      analysisSeconds,
      seconds: +((performance.now() - started) / 1000).toFixed(1),
      targets,
      missing,
      extras,
      cards,
      analysis,
    };
    results.push(item);
    console.log(
      JSON.stringify({
        name: item.name,
        analysisSeconds,
        seconds: item.seconds,
        targets,
        missing,
        extras,
        cards: cards.length,
      }),
    );
  } catch (error) {
    const item = { name: c.name, error: String(error) };
    results.push(item);
    console.log(JSON.stringify(item));
  }
  await writeFile('.test-artifacts/writing-full-live-audit.json', JSON.stringify(results, null, 2));
}
if (results.some((r) => r.error || r.missing?.length || r.extras?.length)) process.exitCode = 1;
