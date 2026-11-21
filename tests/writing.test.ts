import { WritingModel } from '../src/writing-model';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  parseWritingAnalysis,
  parseWritingCard,
  correctedSentence,
  minimalCorrection,
  isolatedQuestion,
  canPractise,
  restoreWritingSessions,
  type WritingFinding,
} from '../src/writing';
import { writingNoteFields, WRITING_TEMPLATE, WRITING_FIELDS } from '../src/writing-anki';
import { DEFAULTS } from '../src/types';
import * as http from '../src/http';
const source = 'I have wrote three stories this week.';
const finding = {
  kind: 'grammar',
  title: 'Past participle',
  original_sentence: source,
  target_before: 'wrote',
  target_after: 'written',
  explanation: 'Use the past participle after have.',
  tip: 'write → wrote → written',
  pattern: 'present perfect participle',
  recommended_format: 'correction',
};
export function sampleFinding(): WritingFinding {
  return parseWritingAnalysis(
    JSON.stringify({ summary: 'One useful correction.', findings: [finding] }),
    source,
  ).findings[0]!;
}
afterEach(() => vi.restoreAllMocks());
describe('writing analysis and practice validation', () => {
  it('derives a visible complete-word target from the corrected sentence', () => {
    expect(minimalCorrection('I have wrote.', 'I have written.')).toEqual({
      before: 'wrote',
      after: 'written',
    });
    expect(minimalCorrection('I have cat.', 'I have a cat.')).toEqual({
      before: 'cat',
      after: 'a cat',
    });
  });
  it('anchors punctuation insertions and preserves whitespace in deletion targets', () => {
    expect(minimalCorrection('I did it', 'I did it.')).toEqual({ before: 'it', after: 'it.' });
    const raw = {
      ...finding,
      original_sentence: 'This is very good.',
      target_before: 'very ',
      target_after: '',
      corrected_sentence: 'This is good.',
    };
    const f = parseWritingAnalysis(
      JSON.stringify({ summary: '', findings: [raw] }),
      raw.original_sentence,
    ).findings[0]!;
    expect(correctedSentence(f)).toBe('This is good.');
  });
  it('fixes unrelated peer mistakes while leaving the target error to practise', () => {
    const f = {
      ...sampleFinding(),
      original: 'She have wrote stories.',
      before: 'wrote',
      after: 'written',
    };
    const other = {
      ...sampleFinding(),
      id: 'peer',
      original: f.original,
      before: 'have',
      after: 'has',
    };
    expect(isolatedQuestion(f, [f, other])).toBe('She has wrote stories.');
  });
  it('accepts genuine quotes, deduplicates targets and leaves every card unselected', () => {
    const r = parseWritingAnalysis(
      JSON.stringify({ summary: 'One issue.', findings: [finding, finding] }),
      source,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.selected).toBe(false);
    expect(correctedSentence(r.findings[0]!)).toBe('I have written three stories this week.');
  });
  it('rejects invented source quotes and ambiguous targets', () => {
    expect(() =>
      parseWritingAnalysis(
        JSON.stringify({
          summary: '',
          findings: [{ ...finding, original_sentence: 'I wrote yesterday.' }],
        }),
        source,
      ),
    ).toThrow('match');
    expect(() =>
      parseWritingAnalysis(
        JSON.stringify({
          summary: '',
          findings: [{ ...finding, original_sentence: 'wrote wrote' }],
        }),
        'wrote wrote',
      ),
    ).toThrow('exactly once');
  });
  it('allows no findings and distinguishes style, uncertainty and typos', () => {
    expect(
      parseWritingAnalysis('{"summary":"No clear errors.","findings":[]}', source).findings,
    ).toEqual([]);
    for (const kind of ['style', 'unclear', 'typo']) {
      const f = parseWritingAnalysis(
        JSON.stringify({ summary: '', findings: [{ ...finding, kind }] }),
        source,
      ).findings[0]!;
      expect(f.kind).toBe(kind);
      expect(canPractise(f)).toBe(false);
    }
  });
  it('validates one correction target and a gap that reconstructs the answer', () => {
    const f = sampleFinding();
    const data = {
      question: source,
      target: 'wrote',
      answer: 'written',
      corrected_sentence: 'I have written three stories this week.',
      hint: '',
      explanation: 'Use the participle.',
      tip: '',
    };
    expect(parseWritingCard(JSON.stringify(data), f).kind).toBe('correction');
    expect(() => parseWritingCard(JSON.stringify({ ...data, answer: 'wrote' }), f)).toThrow(
      'approved',
    );
    f.format = 'gap';
    expect(
      parseWritingCard(
        JSON.stringify({ ...data, question: 'I have [[gap]] three stories this week.' }),
        f,
      ).answer,
    ).toBe('written');
    expect(() =>
      parseWritingCard(JSON.stringify({ ...data, question: '[[gap]] and [[gap]]' }), f),
    ).toThrow('gap');
  });
  it('escapes model text and creates a single writing exercise instead of vocabulary siblings', () => {
    const f = sampleFinding();
    f.card = parseWritingCard(
      JSON.stringify({
        question: source,
        target: 'wrote',
        answer: 'written',
        corrected_sentence: 'I have written three stories this week.',
        hint: '<img src=x onerror=alert(1)>',
        explanation: 'Use the participle.',
        tip: '',
      }),
      f,
    );
    const fields = writingNoteFields(f, 'obsidian://open?file=Review');
    expect(fields.Question).toContain('<mark>wrote</mark>');
    expect(fields.Question).not.toContain('<img');
    expect(fields.Typed).toBe('');
    expect(WRITING_TEMPLATE.Front).toContain('{{type:Answer}}');
    expect(WRITING_FIELDS[0]).toBe('Key');
  });
  it('refuses card generation for optional style suggestions', async () => {
    const f = { ...sampleFinding(), kind: 'style' as const };
    const request = vi.spyOn(http, 'jsonRequest');
    await expect(
      new WritingModel(DEFAULTS).exercise(f, new AbortController().signal),
    ).rejects.toThrow('Only approved');
    expect(request).not.toHaveBeenCalled();
  });
  it('restores work without restarting jobs or losing valid card identifiers', () => {
    const f = sampleFinding();
    f.noteId = 42;
    const s = {
      id: 'review',
      created: '2026-11-22',
      capture: {
        text: source,
        start: 7,
        end: 12,
        selected: source,
        file: 'Book.md',
        book: 'Book',
        vault: 'Test',
        mode: 'editor',
      },
      summary: 'One correction.',
      findings: [f],
      phase: 'exporting',
      analysed: true,
      deck: 'Writing',
    };
    const restored = restoreWritingSessions([s]);
    expect(restored[0]!.phase).toBe('idle');
    expect(restored[0]!.findings[0]!.noteId).toBe(42);
    expect(restoreWritingSessions([{ ...s, capture: {} }])).toEqual([]);
  });
});
