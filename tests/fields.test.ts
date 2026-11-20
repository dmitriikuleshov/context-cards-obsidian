import { describe, expect, it } from 'vitest';
import { DEFAULTS, DEFAULT_FIELDS } from '../src/types';
import { restoreData } from '../src/storage';
import { createDraft, issues } from '../src/text';
import { noteFields, optionalFieldBlocks, TEMPLATES } from '../src/templates';
import { visibleDraft } from '../src/fields';
const draft = () =>
  Object.assign(
    createDraft(
      {
        text: 'A bright room.',
        selected: 'bright',
        start: 2,
        end: 8,
        file: 'Book.md',
        book: 'Book',
        vault: 'Test',
        mode: 'editor',
      },
      DEFAULTS,
    ),
    {
      expression: 'bright',
      partOfSpeech: 'adjective',
      americanIpa: '/braɪt/',
      meaning: 'Full of light.',
      generalMeaning: 'Light or intelligent.',
      explanation: 'A well-lit room.',
      wordFormation: 'Unused test base.',
      examples: ['One.', 'Two.', 'Three.', 'Four.', 'Five.'],
    },
  );
describe('configurable teaching fields', () => {
  it('migrates old settings and validates saved counts and toggles', () => {
    expect(restoreData({}).settings.fields).toEqual(DEFAULT_FIELDS);
    const fields = restoreData({
      settings: {
        fields: {
          ipa: 'british',
          grammar: false,
          meaningSentences: 0,
          generalMeaningSentences: 3,
          examplesPerUsage: 4,
          maxUsages: 99,
          explanationSentences: 1.5,
        },
      },
    }).settings.fields;
    expect(fields).toMatchObject({
      ipa: 'british',
      grammar: false,
      meaningSentences: 0,
      generalMeaningSentences: 3,
      examplesPerUsage: 4,
      maxUsages: 5,
      explanationSentences: 2,
    });
  });
  it('hides disabled content without destroying the draft or the recall exercise', () => {
    const d = draft(),
      before = structuredClone(d);
    const config = {
      ...DEFAULTS,
      fields: {
        ...DEFAULT_FIELDS,
        grammar: false,
        ipa: 'off' as const,
        meaningSentences: 0,
        generalMeaningSentences: 0,
        explanationSentences: 0,
        wordFormation: false,
        examples: false,
        context: false,
      },
    };
    const exported = noteFields(d, config);
    for (const key of [
      'PartOfSpeech',
      'AmericanIPA',
      'Meaning',
      'GeneralMeaning',
      'Explanation',
      'WordFormation',
      'Examples',
      'Context',
    ])
      expect(exported[key]).toBe('');
    expect(exported.GapContext).toContain('cc-gap');
    expect(exported.SourceForm).toBe('bright');
    expect(issues(d, config)).toEqual([]);
    expect(d).toEqual(before);
    expect(visibleDraft(d, DEFAULTS).meaning).toBe(before.meaning);
  });
  it('makes built-in optional blocks conditional without repeatedly nesting them', () => {
    for (const t of TEMPLATES) {
      expect(optionalFieldBlocks(t.Front)).toBe(t.Front);
      expect(optionalFieldBlocks(t.Back)).toBe(t.Back);
      expect(t.Back).toContain('{{#Explanation}}');
      expect(t.Back).toContain('{{#Examples}}');
    }
  });
});
