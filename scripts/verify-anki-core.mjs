import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
const bundle = await build({
  stdin: {
    contents: `
  import {FIELDS,TEMPLATES,CARD_CSS,noteFields} from './src/templates.ts';
  import {createDraft,htmlText} from './src/text.ts';
  import {DEFAULTS} from './src/types.ts';
  import {searchQuote} from './src/anki.ts';
  const draft=createDraft({text:'She brushed off my advice.',start:4,end:15,selected:'brushed off',
    file:'Book.md',book:'Book',vault:'Test',mode:'reading'},DEFAULTS);
  Object.assign(draft,{expression:'brush off',partOfSpeech:'phrasal verb',americanIpa:'/bɹʌʃ ɔf/',meaning:'dismiss without considering',generalMeaning:'A general definition. A broader clarification.',explanation:'She dismissed the advice.',
    examples:['He brushed off my advice.','They brushed off the complaint.','She brushed off the criticism.', 'We brushed off his suggestion.', 'They brushed off our complaints.']});
  const expressions=['brush off','a*b_thing',"can't",'A & B','"hello"','some\\\\thing','a:b'];
  export default {fields:FIELDS,templates:TEMPLATES,css:CARD_CSS,note:noteFields(draft),deck:draft.deck,
    cases:expressions.map(expression=>({expression:htmlText(expression),query:'note:'+searchQuote(DEFAULTS.noteType)+' Expression:'+searchQuote(htmlText(expression))}))};
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
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
  )
).default;
const result = spawnSync('uv', ['run', '--with', 'anki', 'python', 'scripts/verify-anki-core.py'], {
  input: JSON.stringify(fixture),
  encoding: 'utf8',
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
