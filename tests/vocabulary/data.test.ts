import { describe, expect, it } from 'vitest';
import { restoreData } from '../../src/storage';
import { DEFAULTS, DEFAULT_FIELDS } from '../../src/types';
import {
  bookDeck,
  contextHtml,
  contextWindow,
  issues,
  parseTags,
  termRanges,
  updateContext,
} from '../../src/text';
import { examplesHtml, metadataHtml, noteFields, optionalFieldBlocks } from '../../src/templates';
import { americanPronunciations, arpabetToIpa } from '../../src/pronunciation';
import { sourceMarkRange } from '../../src/source-mark';
import { capture, draft } from './fixtures';

describe('untrusted stored vocabulary data', () => {
  it('restores pronunciation variants, timing and note references without resuming work', () => {
    const result = restoreData({
      drafts: [draft({ ipaVariant: 'british', seconds: 1.5, noteId: 42, phase: 'generating' })],
    }).drafts[0]!;
    expect(result.ipaVariant).toBe('british');
    expect(result.seconds).toBe(1.5);
    expect(result.noteId).toBe(42);
    expect(result.phase).toBe('editing');
  });
  it.each([undefined, null, [], 12, 'text'])('returns independent defaults for %s', (raw) => {
    const result = restoreData(raw);
    expect(result).toEqual({ settings: DEFAULTS, drafts: [], skipped: 0 });
    result.settings.fields.examples = false;
    expect(DEFAULTS.fields.examples).toBe(true);
  });
  it('restores every field option, endpoint and book mapping without sharing defaults', () => {
    const settings = {
      ...structuredClone(DEFAULTS),
      ollamaUrl: 'http://localhost:9999',
      ankiKey: 'key',
      decksByBook: false,
      markSourceWord: true,
      temperature: 2,
      contextSize: 6000,
      fields: {
        grammar: false,
        ipa: 'british',
        wordFormation: false,
        context: false,
        examples: false,
        meaningSentences: 0,
        generalMeaningSentences: 10,
        explanationSentences: 3,
        maxUsages: 5,
        examplesPerUsage: 10,
      },
      bookDecks: { Book: 'Custom', blank: ' ', wrong: 4 },
    };
    const result = restoreData({ settings }).settings;
    expect(result.fields).toEqual(settings.fields);
    expect(result.bookDecks).toEqual({ Book: 'Custom' });
    expect(result.ollamaUrl).toBe(settings.ollamaUrl);
    expect(result.temperature).toBe(2);
    expect(result.contextSize).toBe(6000);
  });
  for (const invalid of [-1, 1.5, 11, NaN, Infinity, '2', null])
    it(`rejects invalid numeric field options ${String(invalid)}`, () => {
      const fields = Object.fromEntries(
        [
          'meaningSentences',
          'generalMeaningSentences',
          'explanationSentences',
          'maxUsages',
          'examplesPerUsage',
        ].map((k) => [k, invalid]),
      );
      expect(restoreData({ settings: { fields } }).settings.fields).toEqual(DEFAULT_FIELDS);
    });
  it('rejects wrong types for boolean and enum options', () => {
    const result = restoreData({
      settings: {
        fields: {
          grammar: 'false',
          ipa: 'Australian',
          context: 0,
          wordFormation: null,
          examples: [],
        },
        model: 3,
        decksByBook: 0,
        bookDecks: [],
      },
    });
    expect(result.settings).toEqual(DEFAULTS);
  });
  for (const [key, value] of [
    ['start', -1],
    ['start', 0.5],
    ['start', NaN],
    ['end', 0],
    ['end', 1000],
    ['end', 15.5],
    ['selected', 'wrong'],
    ['text', null],
    ['file', 3],
  ] as const)
    it(`skips a malformed capture ${key}=${String(value)}`, () => {
      const result = restoreData({
        drafts: [{ ...draft(), capture: { ...capture(), [key]: value } }, draft()],
      });
      expect(result.skipped).toBe(1);
      expect(result.drafts).toHaveLength(1);
    });
  it('recovers metadata defaults and strips malformed pending source data', () => {
    const d: any = draft({ phase: 'saved', noteId: -1 });
    Object.assign(d, {
      created: 3,
      answerStart: NaN,
      deck: 3,
      tags: 3,
      revision: NaN,
      seconds: NaN,
      pendingContent: { status: 'unknown', examples: ['One'], notes: ['Note'] },
      pendingSource: { context: 3, answer: 'word' },
    });
    d.capture.mode = 'invalid';
    const restored = restoreData({ drafts: [d] }).drafts[0]!;
    expect(restored.phase).toBe('editing');
    expect(restored.noteId).toBeUndefined();
    expect(restored.capture.mode).toBe('manual');
    expect(restored.answerStart).toBe(-1);
    expect(restored.deck).toBe(DEFAULTS.rootDeck);
    expect(restored.tags).toBe(DEFAULTS.defaultTags);
    expect(restored.seconds).toBeUndefined();
    expect(restored.pendingSource).toBeUndefined();
    expect(restored.pendingContent!.examples).toEqual(['One', '', '', '', '']);
  });
  for (const groups of [
    [],
    Array(6).fill({ meaning: 'x', examples: ['x'] }),
    [null],
    [{ meaning: 3, examples: ['x'] }],
    [{ meaning: 'x', examples: [] }],
    [{ meaning: 'x', examples: Array(11).fill('x') }],
    [{ meaning: 'x', examples: [3] }],
  ])
    it(`ignores corrupt usage groups ${JSON.stringify(groups).slice(0, 50)}`, () => {
      const result = restoreData({ drafts: [{ ...draft(), exampleGroups: groups }] }).drafts[0]!;
      expect(result.exampleGroups).toBeUndefined();
      expect(result.examples).toHaveLength(5);
    });
  it('handles corrupt content without losing a valid source snapshot', () => {
    const result = restoreData({
      drafts: [
        {
          ...draft(),
          status: 'bad',
          examples: [3],
          notes: 3,
          ipaVariant: 'wrong',
          pendingContent: [],
        },
      ],
    }).drafts[0]!;
    expect(result.examples).toEqual(['', '', '', '', '']);
    expect(result.notes).toEqual([]);
    expect(result.pendingContent).toBeUndefined();
  });
});
describe('vocabulary recall and safe card rendering', () => {
  it('keeps a selected word in a long unpunctuated sentence and does not duplicate overlapping gap markup', () => {
    const text = 'before '.repeat(100) + 'word' + ' after'.repeat(100),
      start = text.indexOf('word');
    const result = contextWindow(text, start, start + 4, 100);
    expect(result.context.slice(result.answerStart, result.answerStart + 4)).toBe('word');
    expect(result.context.length).toBeLessThanOrEqual(100);
    expect(
      contextHtml(draft({ context: 'a a a', answer: 'a a', answerStart: 2 }), true).match(
        /cc-gap/g,
      ),
    ).toHaveLength(1);
  });
  it.each([
    [-1, 2],
    [2, 2],
    [2, 100],
  ])('rejects invalid context offsets %s..%s', (a, b) =>
    expect(() => contextWindow('abc', a, b, 10)).toThrow('Select'),
  );
  it('handles empty answers, regex punctuation, Unicode boundaries and line wrapping', () => {
    expect(termRanges('word', '')).toEqual([]);
    expect(termRanges('c++ C++ c+++', 'c++')).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
    ]);
    expect(termRanges('ébank bank banké _bank bank1', 'bank')).toEqual([[6, 10]]);
    expect(termRanges('brush\n off brush off', 'brush off')).toEqual([
      [0, 10],
      [11, 20],
    ]);
  });
  it('keeps an exact substring selection even when whole-word matching cannot locate it', () => {
    const d = draft({ context: 'foobar', answer: 'bar', answerStart: 3 });
    expect(contextHtml(d, true)).toBe('foo<span class="cc-gap">[…]</span>');
    d.answerStart = -1;
    expect(contextHtml(d)).toBe('foobar');
  });
  it('preserves offsets when an edit is after the answer and reselects a unique remaining answer', () => {
    const d = draft();
    updateContext(d, d.context + ' More.');
    expect(d.answerStart).toBe(4);
    updateContext(d, 'They brushed off advice.');
    expect(d.answerStart).toBe(5);
    updateContext(d, 'Nothing remains.');
    expect(d.answerStart).toBe(-1);
  });
  it('uses a safe deck fallback and cleans a remembered destination', () => {
    expect(bookDeck({ ...DEFAULTS, rootDeck: '::', decksByBook: false }, capture())).toBe(
      'English::Books',
    );
    expect(bookDeck(DEFAULTS, capture({ book: '' }))).toBe('English::Books::Reading');
    expect(
      bookDeck(
        { ...DEFAULTS, bookDecks: { 'Books/Book.md': '  Root :: :: Child\u0000 ' } },
        capture(),
      ),
    ).toBe('Root::Child');
    expect(parseTags(' a b a\n c ')).toEqual(['a', 'b', 'c']);
  });
  for (const groups of [
    [],
    Array(6).fill({ meaning: 'x', examples: ['x'] }),
    [{ meaning: '', examples: ['x'] }],
    [{ meaning: 'sense', examples: [] }],
    [{ meaning: 'sense', examples: Array(11).fill('x') }],
    [{ meaning: 'sense', examples: [' '] }],
  ])
    it(`requires complete editable usage groups ${JSON.stringify(groups).slice(0, 45)}`, () => {
      expect(issues(draft({ exampleGroups: groups }))).toContain(
        'Complete each meaning group and its examples.',
      );
    });
  it('allows disabled content fields but still requires a word, answer and destination', () => {
    const d = draft({ expression: '', meaning: '', explanation: '', examples: [], deck: '::' }),
      settings = {
        ...DEFAULTS,
        fields: {
          ...DEFAULT_FIELDS,
          meaningSentences: 0,
          explanationSentences: 0,
          examples: false,
        },
      };
    const problems = issues(d, settings);
    expect(problems).toHaveLength(2);
    expect(problems.join()).toContain('word or expression');
    expect(problems.join()).toContain('deck');
  });
  it('escapes group headings, example bodies and usage notes; omits blank legacy entries', () => {
    const d = draft({
      exampleGroups: [{ meaning: '<img>', examples: ['A & B', '<script>x</script>'] }],
      notes: [' ', '<b>note</b>'],
    });
    expect(examplesHtml(d)).toBe(
      '<div class="cc-label">&lt;img&gt;</div><ul><li>A &amp; B</li><li>&lt;script&gt;x&lt;/script&gt;</li></ul>',
    );
    expect(noteFields(d).UsageNotes).toBe('<ul><li>&lt;b&gt;note&lt;/b&gt;</li></ul>');
    d.exampleGroups = [];
    d.examples = [' ', 'Safe'];
    expect(examplesHtml(d)).toBe('<ul><li>Safe</li></ul>');
  });
  it('renders all metadata combinations and preserves custom HTML through optional wrappers', () => {
    expect(metadataHtml(false, false)).not.toContain('{{');
    expect(metadataHtml(true, false)).not.toContain('{{AmericanIPA}}');
    expect(metadataHtml(false, true)).not.toContain('{{PartOfSpeech}}');
    const html =
      '<details class="cc-details"><summary>Show context</summary><div class="cc-context">{{Context}}</div></details><div class="cc-context">{{Context}}</div>';
    const output = optionalFieldBlocks(html);
    expect(output.match(/{{#Context}}/g)).toHaveLength(2);
    expect(optionalFieldBlocks(output)).toBe(output);
    expect(optionalFieldBlocks('Custom')).toBe('Custom');
  });
  it('does not mutate a draft when hiding fields and retains the source gap task', () => {
    const d = draft(),
      before = structuredClone(d);
    d.generalMeaning = undefined;
    d.wordFormation = undefined;
    const output = noteFields(d, {
      fields: {
        ...DEFAULT_FIELDS,
        grammar: false,
        ipa: 'off',
        meaningSentences: 0,
        generalMeaningSentences: 0,
        wordFormation: false,
        context: false,
        explanationSentences: 0,
        examples: false,
      },
    });
    for (const key of [
      'PartOfSpeech',
      'AmericanIPA',
      'Meaning',
      'GeneralMeaning',
      'WordFormation',
      'Context',
      'Explanation',
      'Examples',
    ])
      expect(output[key]).toBe('');
    expect(output.GapContext).toContain('cc-gap');
    expect(d.context).toBe(before.context);
    expect(d.examples).toEqual(before.examples);
  });
});
describe('offline pronunciation and source-mark boundaries', () => {
  it('places secondary stress before the consonant onset of a syllable', () =>
    expect(arpabetToIpa('K AA2 N S EH1 P T')).toBe('ˌkɑnˈsɛpt'));
  it('does not close a code fence with a short marker or one containing trailing text', () => {
    const c = capture({ selected: 'word', text: 'word', start: 0, end: 4 });
    for (const text of ['````text\n```\nword', '```text\n```still code\nword', '~~~\n```\nword'])
      expect(sourceMarkRange(text, c)).toBeNull();
    expect(sourceMarkRange('```bad`info\nword', c)).not.toBeNull();
  });
  it('converts reduced vowels and rejects unknown phones', () => {
    expect(arpabetToIpa('AH0 ER0 IY0')).toBe('əɚi');
    expect(() => arpabetToIpa('UNKNOWN')).toThrow('Unsupported');
    expect(americanPronunciations('RECORD')).toEqual(americanPronunciations('record'));
    expect(americanPronunciations('fooobarbaz')).toEqual([]);
    expect(americanPronunciations(Array(13).fill('word').join(' '))).toEqual([]);
    expect(americanPronunciations('record record record')).toHaveLength(8);
  });
  it.each(['', 'a`b', 'line\nbreak', 'line\rbreak'])(
    'does not mark unsafe selection %s',
    (selected) =>
      expect(
        sourceMarkRange(
          selected,
          capture({ text: selected, selected, start: 0, end: selected.length }),
        ),
      ).toBeNull(),
  );
  it('respects explicit positions and word boundaries', () => {
    const c = capture({ text: 'bank bank', selected: 'bank', start: 0, end: 4 });
    expect(sourceMarkRange('bank bank', c, 5)).toEqual({ start: 5, end: 9 });
    expect(sourceMarkRange('bank bank', c, 99)).toBeNull();
    expect(sourceMarkRange('banker unbank', c)).toBeNull();
  });
});
