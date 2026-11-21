import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
const result = await build({
  stdin: {
    contents: `
import {WRITING_FIELDS,WRITING_TEMPLATE,writingNoteFields} from './src/writing-anki.ts';
import {CARD_CSS} from './src/templates.ts';
const f={id:'writing-check',kind:'grammar',title:'Participle',original:'I have wrote three stories.',before:'wrote',after:'written',explanation:'Use a participle.',tip:'write / wrote / written',pattern:'present perfect',selected:true,format:'correction'};
const base={kind:'correction',question:f.original,target:f.before,answer:f.after,corrected:'I have written three stories.',hint:'Use the correct form of write.',explanation:f.explanation,tip:f.tip};
f.card=base;
const correction=writingNoteFields(f,'obsidian://open?file=Review');
f.id='gap-check';f.format='gap';f.card={...base,kind:'gap',question:'I have [[gap]] three stories.'};
export default {fields:WRITING_FIELDS,template:WRITING_TEMPLATE,css:CARD_CSS,notes:[correction,writingNoteFields(f,'obsidian://open?file=Review')]};
`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const fixture = (
  await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  )
).default;
const check = spawnSync(
  'uv',
  ['run', '--with', 'anki', 'python', 'scripts/verify-writing-anki.py'],
  { input: JSON.stringify(fixture), encoding: 'utf8' },
);
process.stdout.write(check.stdout ?? '');
process.stderr.write(check.stderr ?? '');
if (check.error) throw check.error;
process.exitCode = check.status ?? 1;
