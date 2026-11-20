import { visibleDraft } from './fields';
import type { Draft, Settings } from './types';
import { contextHtml, escapeHtml, htmlText, sourceUri, typedAnswer } from './text';

export const FIELDS = [
  'Key',
  'Expression',
  'Meaning',
  'Context',
  'GapContext',
  'SourceForm',
  'Explanation',
  'Examples',
  'UsageNotes',
  'Source',
  'Created',
  'PartOfSpeech',
  'AmericanIPA',
  'GeneralMeaning',
  'WordFormation',
];
export const CARD_CSS = `
.card { font: 19px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:#222b35; background:#faf9f6; text-align:left; padding:26px; }
.cc-card { max-width:640px; margin:auto; overflow-wrap:anywhere; }
.cc-eyebrow { text-transform:uppercase; letter-spacing:.12em; font-size:11px; color:#748077; margin-bottom:16px; }
.cc-expression { font:600 34px/1.3 Georgia,serif; margin:18px 0 26px; }
.cc-context { font:21px/1.7 Georgia,serif; white-space:normal; }
.cc-gap { display:inline-block; border-bottom:2px solid #8a987b; min-width:70px; text-align:center; color:#718064; }
.cc-meaning { font-size:23px; font-weight:600; margin:18px 0; }
.cc-label { font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:#748077; margin-top:24px; }
.cc-notes,.cc-source { font-size:15px; color:#647064; }
.cc-source { margin-top:32px; }
.cc-source a { color:inherit; }
.cc-details { margin:20px 0; font-size:16px; }
.cc-details summary { color:#647656; cursor:pointer; }
.cc-details > div { padding-top:12px; }
.cc-card mark { background:#e6eddb; color:inherit; padding:1px 4px; border-radius:3px; }
#typeans { font-size:21px; border-radius:6px; width:100%; box-sizing:border-box; padding:9px; }
.cc-card ul { padding-left:24px; }
hr#answer { border:0; border-top:1px solid #d9ddd2; margin:24px 0; }
.nightMode.card,.night_mode.card { background:#202420; color:#e5e9df; }
.nightMode .cc-card mark,.night_mode .cc-card mark { background:#3c4936; }
.nightMode :is(.cc-label,.cc-source,.cc-notes,.cc-eyebrow,.cc-details summary),.night_mode :is(.cc-label,.cc-source,.cc-notes,.cc-eyebrow,.cc-details summary) { color:#a5b49a; }
.nightMode #typeans,.night_mode #typeans { background:#293029; color:#e5e9df; border:1px solid #55614d; }
.nightMode hr#answer,.night_mode hr#answer { border-color:#485241; }
`;
const source = '<div class="cc-source">{{Source}}</div>';
export function metadataHtml(grammar = true, ipa = true): string {
  return `<div class="cc-notes cc-metadata">${grammar ? '{{#PartOfSpeech}}<span>{{PartOfSpeech}}</span>{{/PartOfSpeech}}' : ''}${grammar && ipa ? ' ' : ''}${ipa ? '{{#AmericanIPA}}<span>{{AmericanIPA}}</span>{{/AmericanIPA}}' : ''}</div>`;
}
export function generalMeaningHtml(): string {
  return '{{#GeneralMeaning}}<div class="cc-label">General meaning</div><div>{{GeneralMeaning}}</div>{{/GeneralMeaning}}';
}
export function wordFormationHtml(): string {
  return '{{#WordFormation}}<div class="cc-label">Word formation</div><div>{{WordFormation}}</div>{{/WordFormation}}';
}
const answer = `${metadataHtml()}<div class="cc-label">Meaning in this context</div><div class="cc-meaning">{{Meaning}}</div>${generalMeaningHtml()}${wordFormationHtml()}<div class="cc-label">Explanation</div><div>{{Explanation}}</div>
<div class="cc-label">Usage examples</div><div>{{Examples}}</div>
{{#UsageNotes}}<div class="cc-label">Usage notes</div><div class="cc-notes">{{UsageNotes}}</div>{{/UsageNotes}}${source}`;
export function optionalFieldBlocks(html: string): string {
  const fragments: [string, string][] = [
    [
      'Meaning',
      '<div class="cc-label">Meaning in this context</div><div class="cc-meaning">{{Meaning}}</div>',
    ],
    [
      'Meaning',
      '<details class="cc-details"><summary>Show definition</summary><div>{{Meaning}}</div></details>',
    ],
    ['Explanation', '<div class="cc-label">Explanation</div><div>{{Explanation}}</div>'],
    ['Examples', '<div class="cc-label">Usage examples</div><div>{{Examples}}</div>'],
    [
      'Context',
      '<details class="cc-details"><summary>Show context</summary><div class="cc-context">{{Context}}</div></details>',
    ],
    ['Context', '<div class="cc-context">{{Context}}</div>'],
  ];
  for (const [field, fragment] of fragments) {
    const wrapped = `{{#${field}}}${fragment}{{/${field}}}`;
    // Avoid nesting the Context div inside an already conditional details block.
    if (html.includes(wrapped)) continue;
    if (field === 'Context' && fragment.startsWith('<div') && html.includes('{{#Context}}')) {
      const details =
        '{{#Context}}<details class="cc-details"><summary>Show context</summary><div class="cc-context">{{Context}}</div></details>{{/Context}}';
      html = html
        .replace(details, '__CC_CONTEXT_DETAILS__')
        .replaceAll(fragment, wrapped)
        .replace('__CC_CONTEXT_DETAILS__', details);
    } else html = html.replaceAll(fragment, wrapped);
  }
  return html;
}
export const TEMPLATES = [
  {
    Name: 'Recognition',
    Front: `<div class="cc-card"><div class="cc-eyebrow">Recall the meaning used in the source</div>
<div class="cc-expression">{{Expression}}</div>
<details class="cc-details"><summary>Show context</summary><div class="cc-context">{{Context}}</div></details></div>`,
    Back: `<div class="cc-card"><div class="cc-expression">{{Expression}}</div><div class="cc-context">{{Context}}</div><hr id="answer">${answer}</div>`,
  },
  {
    Name: 'Recall',
    Front: `<div class="cc-card"><div class="cc-eyebrow">Restore the original word or expression</div>
<div class="cc-context">{{GapContext}}</div>
<details class="cc-details"><summary>Show definition</summary><div>{{Meaning}}</div></details>
<div class="cc-label">Your answer</div>{{type:SourceForm}}</div>`,
    Back: `{{FrontSide}}<hr id="answer"><div class="cc-card"><div class="cc-expression">{{SourceForm}}</div>
<div class="cc-context">{{Context}}</div>${answer}</div>`,
  },
].map((t) => ({ ...t, Front: optionalFieldBlocks(t.Front), Back: optionalFieldBlocks(t.Back) }));
export function examplesHtml(draft: Draft): string {
  if (draft.exampleGroups?.length)
    return draft.exampleGroups
      .map(
        (g) =>
          `<div class="cc-label">${htmlText(g.meaning)}</div><ul>${g.examples.map((v) => `<li>${htmlText(v)}</li>`).join('')}</ul>`,
      )
      .join('');
  return `<ul>${draft.examples
    .filter((v) => v.trim())
    .map((v) => `<li>${htmlText(v)}</li>`)
    .join('')}</ul>`;
}
export function noteFields(draft: Draft, settings?: Partial<Settings>): Record<string, string> {
  const original = draft;
  draft = visibleDraft(draft, settings);
  const list = (values: string[]) =>
    `<ul>${values
      .filter((v) => v.trim())
      .map((v) => `<li>${htmlText(v)}</li>`)
      .join('')}</ul>`;
  return {
    Key: draft.id,
    PartOfSpeech: htmlText(draft.partOfSpeech),
    AmericanIPA: htmlText(draft.americanIpa),
    Expression: htmlText(draft.expression),
    Meaning: htmlText(draft.meaning),
    GeneralMeaning: htmlText(draft.generalMeaning ?? ''),
    WordFormation: htmlText(draft.wordFormation ?? ''),
    Context: draft.context ? contextHtml(draft) : '',
    GapContext: contextHtml(original, true),
    SourceForm: escapeHtml(typedAnswer(draft.answer)),
    Explanation: htmlText(draft.explanation),
    Examples: draft.examples.length ? examplesHtml(draft) : '',
    UsageNotes: draft.notes.filter((v) => v.trim()).length ? list(draft.notes) : '',
    Source: `${escapeHtml(draft.capture.book)} · <a href="${escapeHtml(sourceUri(draft.capture))}">Open source in Obsidian</a>`,
    Created: draft.created,
  };
}
