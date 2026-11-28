import { describe, expect, it } from 'vitest';
import { restoreData } from '../src/storage';
import { createDraft } from '../src/text';
import { noteFields } from '../src/templates';
import { DEFAULTS } from '../src/types';
function draft() {
  return createDraft(
    {
      text: 'A word in a book.',
      selected: 'word',
      start: 2,
      end: 6,
      file: 'Book.md',
      book: 'Book',
      vault: 'Test',
      mode: 'editor',
    },
    DEFAULTS,
  );
}
describe('persisted drafts and settings', () => {
  it('migrates writing preferences and removes old category/dialect restrictions', () => {
    const old = restoreData({ settings: { writingDeck: 'My writing' } }).settings;
    expect(old.writing).toEqual({ exercise: 'ai' });
    const restored = restoreData({
      settings: {
        writing: {
          variant: 'british',
          exercise: 'gap',
          grammar: false,
          vocabulary: false,
          spelling: false,
        },
      },
    }).settings;
    expect(restored.writing).toEqual({ exercise: 'gap' });
    const invalid = restoreData({
      settings: { writing: { exercise: 'auto', grammar: 'no' } },
    }).settings;
    expect(invalid.writing).toEqual(DEFAULTS.writing);
    restored.writing.exercise = 'correction';
    expect(DEFAULTS.writing.exercise).toBe('ai');
    old.writing.exercise = 'gap';
    expect(DEFAULTS.writing.exercise).toBe('ai');
    expect(restoreData({ settings: { writing: null } }).settings.writing).toEqual(DEFAULTS.writing);
  });
  it('keeps the source snapshot of a pending replacement across restart', () => {
    const original = draft();
    original.pendingContent = { ...original };
    original.pendingSource = { context: original.context, answer: original.answer };
    const restored = restoreData({ drafts: [original] }).drafts[0]!;
    expect(restored.pendingSource).toEqual(original.pendingSource);
  });
  it('keeps long manual timeouts and rejects invalid timer values', () => {
    for (const timeoutSeconds of [1, 60, 600, 3600, 2147483])
      expect(restoreData({ settings: { timeoutSeconds } }).settings.timeoutSeconds).toBe(
        timeoutSeconds,
      );
    for (const timeoutSeconds of [0, -1, 1.5, Infinity, NaN, 2147484, '600'])
      expect(restoreData({ settings: { timeoutSeconds } }).settings.timeoutSeconds).toBe(60);
    expect(restoreData({}).settings.timeoutSeconds).toBe(60);
  });

  it('preserves grouped meanings and all ten examples across a restart', () => {
    const original = {
      ...draft(),
      exampleGroups: Array.from({ length: 5 }, (_, i) => ({
        meaning: `Sense ${i}`,
        examples: [`Example ${i}a.`, `Example ${i}b.`],
      })),
    };
    const restored = restoreData({ drafts: [original] }).drafts[0]!;
    expect(restored.exampleGroups).toEqual(original.exampleGroups);
    expect(restored.examples).toHaveLength(10);
    const exported = noteFields(restored).Examples!;
    expect(exported).toContain('Sense 4');
    expect(exported).toContain('Example 4b.');
    expect(exported.match(/<li>/g)).toHaveLength(10);
  });
  it('preserves both meanings independently across a restart', () => {
    const original = {
      ...draft(),
      meaning: 'The exact original contextual meaning.',
      generalMeaning: 'A general definition. It covers other situations.',
    };
    const restored = restoreData({ drafts: [original] }).drafts[0]!;
    expect(restored.meaning).toBe(original.meaning);
    expect(restored.generalMeaning).toBe(original.generalMeaning);
  });
  it('keeps existing two-example drafts and adds empty slots without inventing learning content', () => {
    const old = {
      ...draft(),
      examples: ['Old example one.', 'Old example two.'],
      partOfSpeech: undefined,
      americanIpa: undefined,
    };
    const restored = restoreData({ drafts: [old] }).drafts[0]!;
    expect(restored.examples).toEqual(['Old example one.', 'Old example two.']);
    expect(restored.partOfSpeech).toBe('');
    expect(restored.americanIpa).toBe('');
  });
  it('uses independent defaults for absent or incorrectly typed settings', () => {
    const restored = restoreData({
      settings: {
        bookDecks: null,
        restoreDrafts: 'no',
        contextSize: -1,
        timeoutSeconds: Infinity,
        temperature: NaN,
        model: 'other-local-model',
      },
    });
    expect(restored.settings.model).toBe('other-local-model');
    expect(restored.settings.restoreDrafts).toBe(true);
    expect(restored.settings.contextSize).toBe(1800);
    expect(restored.settings.bookDecks).toEqual({});
    restored.settings.bookDecks['Book.md'] = 'My deck';
    expect(DEFAULTS.bookDecks).toEqual({});
  });
  it('retains edits but never resumes generation or an export automatically', () => {
    const a = draft(),
      b = draft();
    a.phase = 'generating';
    a.meaning = 'My edited meaning';
    b.phase = 'sending';
    const restored = restoreData({ drafts: [a, b] });
    expect(restored.drafts.map((v) => v.phase)).toEqual(['editing', 'editing']);
    expect(restored.drafts[0]!.meaning).toBe('My edited meaning');
    expect(restored.drafts[0]!.id).toBe(a.id);
  });
  it('preserves an exported note ID and a pending regeneration choice', () => {
    const a = draft();
    a.phase = 'saved';
    a.noteId = 123;
    a.pendingContent = {
      status: 'ready',
      expression: 'term',
      partOfSpeech: 'noun',
      americanIpa: '/tɜɹm/',
      meaning: 'a meaning',
      explanation: 'An explanation.',
      examples: ['First.', 'Second.', 'Third.', 'Fourth.', 'Fifth.'],
      notes: [],
      question: '',
    };
    const restored = restoreData({ drafts: [a] }).drafts[0]!;
    expect(restored.phase).toBe('saved');
    expect(restored.noteId).toBe(123);
    expect(restored.pendingContent).toEqual(a.pendingContent);
  });
  it('does not let one damaged record prevent other drafts from loading', () => {
    const good = draft(),
      bad = { ...draft(), capture: { text: 123 } };
    const result = restoreData({ drafts: [null, bad, good] });
    expect(result.skipped).toBe(2);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]!.id).toBe(good.id);
  });
  it('honors disabled persistence and bounds the number of restored drafts', () => {
    const drafts = Array.from({ length: 15 }, draft);
    expect(restoreData({ drafts }).drafts.map((d) => d.id)).toEqual(
      drafts.slice(-4).map((d) => d.id),
    );
    expect(restoreData({ settings: { restoreDrafts: false }, drafts }).drafts).toEqual([]);
  });
});
