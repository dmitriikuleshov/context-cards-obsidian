import { describe, expect, it } from 'vitest';
import {
  MAX_WRITING_FINDINGS,
  correctedSentence,
  isolatedQuestion,
  minimalCorrection,
  parseWritingAnalysis,
  parseWritingCard,
  restoreWritingSessions,
  writingCorrectionTitle,
  writingPracticeFields,
} from '../../src/writing';
import { writingHighlights } from '../../src/writing-workflow';
import { SOURCE, finding, rawFinding, card, session, analysisJSON, cardJSON } from './fixtures';

describe('untrusted analysis contracts', () => {
  it.each([
    'null',
    '{}',
    '[]',
    '{"summary":"x","findings":{}}',
    '{"summary":"x","findings":null}',
    analysisJSON(Array(MAX_WRITING_FINDINGS + 1).fill(rawFinding())),
  ])('rejects invalid analysis envelopes: %s', (raw) => {
    expect(() => parseWritingAnalysis(raw, SOURCE, true)).toThrow();
  });
  it.each([
    null,
    {},
    { kind: 'other' },
    ...[
      ['title', 123],
      ['title', 'x'.repeat(121)],
      ['title', '  '],
      ['original_sentence', ''],
      ['original_sentence', 'x'.repeat(6001)],
      ['target_before', 123],
      ['target_before', 'x'.repeat(301)],
      ['target_before', ''],
      ['target_after', null],
      ['target_after', 'x'.repeat(301)],
      ['explanation', false],
      ['explanation', ' '],
      ['explanation', 'x'.repeat(2001)],
      ['tip', null],
      ['tip', 'x'.repeat(501)],
      ['pattern', null],
      ['pattern', 'x'.repeat(301)],
    ].map(([key, value]) => rawFinding({ [key as string]: value })),
  ])('rejects malformed finding %# without accepting a partial result', (item) => {
    expect(() => parseWritingAnalysis(analysisJSON([rawFinding(), item]), SOURCE, true)).toThrow();
  });
  it('rejects a corrected sentence that is unchanged or whose edit exceeds the target budget', () => {
    expect(() =>
      parseWritingAnalysis(analysisJSON([rawFinding({ corrected_sentence: SOURCE })]), SOURCE),
    ).toThrow('does not change');
    expect(() =>
      parseWritingAnalysis(
        analysisJSON([rawFinding({ corrected_sentence: 'x'.repeat(301) })]),
        SOURCE,
      ),
    ).toThrow('clearer single target');
  });
  it('requires a unique source anchor even for unclear feedback', () => {
    expect(() =>
      parseWritingAnalysis(
        analysisJSON([rawFinding({ kind: 'unclear', target_before: 'missing' })]),
        SOURCE,
      ),
    ).toThrow('unclear fragment');
  });
  it('prefers a selectable grammar finding over the same optional or typo finding without creating duplicates', () => {
    for (const kind of ['style', 'typo', 'grammar']) {
      const result = parseWritingAnalysis(
        analysisJSON([rawFinding({ kind }), rawFinding(), rawFinding({ kind: 'style' })]),
        SOURCE,
      );
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.kind).toBe('grammar');
    }
  });
  it('labels deletions and shortens long edit labels without displaying a hallucinated title', () => {
    expect(writingCorrectionTitle(finding({ after: '' }))).toBe('wrote → (remove)');
    expect(writingCorrectionTitle(finding({ before: 'a'.repeat(80), after: 'b'.repeat(80) }))).toBe(
      'a'.repeat(57) + '… → ' + 'b'.repeat(57) + '…',
    );
  });
  it('rejects no-op corrections and treats replacement metacharacters literally', () => {
    expect(() => correctedSentence(finding({ after: 'wrote' }))).toThrow('must change');
    expect(correctedSentence(finding({ after: '$& $$ $1' }))).toBe(
      'I have $& $$ $1 three stories.',
    );
  });
});

describe('exercise contracts and HTML boundaries', () => {
  it.each(['null', '1', '"text"', '[]', '{}'])('rejects malformed card %s', (raw) => {
    expect(() => parseWritingCard(raw, finding())).toThrow();
  });
  it.each(['question', 'corrected_sentence', 'explanation'])('requires nonempty %s', (key) => {
    expect(() => parseWritingCard(cardJSON({ [key]: ' ' }), finding())).toThrow('empty required');
  });
  it('requires a nonempty typed answer, a single-line answer and exact reconstruction', () => {
    const f = finding({ format: 'gap' });
    expect(() =>
      parseWritingCard(cardJSON({ question: 'I have [[gap]] three stories.', answer: ' ' }), f),
    ).toThrow('empty required');
    const multiline = finding({ format: 'gap', after: 'written\nagain' });
    expect(() =>
      parseWritingCard(
        cardJSON({
          question: 'I have [[gap]] three stories.',
          answer: multiline.after,
          corrected_sentence: 'I have written\nagain three stories.',
        }),
        multiline,
      ),
    ).toThrow('single short');
    expect(() =>
      parseWritingCard(
        cardJSON({
          question: 'I have [[gap]] three stories.',
          corrected_sentence: 'A different sentence.',
        }),
        f,
      ),
    ).toThrow('do not reproduce');
    expect(() =>
      parseWritingCard(cardJSON({ question: 'I have [[gap]] three stories.', target: 'have' }), f),
    ).toThrow('approved correction');
  });
  it('does not accept a duplicated target or a changed surrounding sentence on a correction card', () => {
    expect(() => parseWritingCard(cardJSON({ question: 'wrote wrote' }), finding())).toThrow(
      'approved correction',
    );
    expect(() =>
      parseWritingCard(cardJSON({ corrected_sentence: 'I wrote stories.' }), finding()),
    ).toThrow('approved correction');
  });
  it('requires a prepared exercise and escapes every user/model field in both formats', () => {
    expect(() => writingPracticeFields(finding())).toThrow('Generate and review');
    const f = finding({
      original: 'She wrote <script>alert(1)</script>.',
      card: card({
        question: 'She wrote <script>alert(1)</script>.',
        corrected: 'She written <script>alert(1)</script>.',
        hint: '<img src=x>',
        explanation: '<b>rule</b>',
        tip: '"tip" & more',
      }),
    });
    const fields = writingPracticeFields(f);
    for (const field of Object.values(fields)) expect(field).not.toMatch(/<script|<img|<b>/);
    expect(fields.Question).toContain('&lt;script&gt;');
    f.format = 'gap';
    f.card = {
      ...f.card!,
      kind: 'gap',
      question: 'She [[gap]] <script>alert(1)</script>.',
      hint: '',
    };
    const gap = writingPracticeFields(f);
    expect(gap.Typed).toBe('yes');
    expect(gap.Question).toContain('class="cc-gap"');
    expect(gap.Question).not.toContain('<details');
  });
});

describe('source alignment invariants', () => {
  it('reconstructs changed sentences exactly with a visible, unique original anchor', () => {
    const prefixes = ['', 'She said: ', 'one one ', '🙂 café '],
      suffixes = ['', '.', ' one one', ' café 🙂'];
    const edits = [
      ['write', 'written'],
      ['cat', 'a cat'],
      ['very ', ''],
      ['same same', 'same other'],
      ['hello', 'Hello'],
      ['', 'new '],
      ['old', ''],
      ['$x', '$&'],
      ['café', 'cafés'],
    ];
    for (const prefix of prefixes)
      for (const suffix of suffixes)
        for (const [before, after] of edits) {
          const original = prefix + before + suffix,
            corrected = prefix + after + suffix;
          if (!original || original === corrected) continue;
          const delta = minimalCorrection(original, corrected);
          expect(delta.before, JSON.stringify({ original, corrected, delta })).not.toBe('');
          expect(original.split(delta.before)).toHaveLength(2);
          expect(original.replace(delta.before, () => delta.after)).toBe(corrected);
        }
  });
  it('isolates multiple peers in source order, ignores optional/rejected/overlapping peers and leaves input unchanged', () => {
    const f = finding({ original: 'She have wrote a stroy.', before: 'wrote' });
    const peers = [
      f,
      finding({ id: 'a', original: f.original, before: 'have', after: 'has' }),
      finding({ id: 'b', kind: 'typo', original: f.original, before: 'stroy', after: 'story' }),
      finding({ id: 'c', original: f.original, before: 'have wrote', after: 'has written' }),
      finding({ id: 'd', kind: 'style', original: f.original, before: 'She', after: 'The author' }),
      finding({ id: 'e', dismissed: true, original: f.original, before: 'She', after: 'He' }),
      finding({ id: 'missing', original: f.original, before: 'missing', after: 'other' }),
    ];
    const saved = structuredClone(peers);
    expect(isolatedQuestion(f, peers)).toBe('She has wrote a story.');
    expect(peers).toEqual(saved);
    expect(() =>
      isolatedQuestion(f, [
        finding({ id: 'duplicate', original: f.original, before: 'stroy', after: 'wrote' }),
      ]),
    ).toThrow('more precise');
    const overlapping = [
      finding({ id: 'long', original: f.original, before: 'a stroy', after: 'one story' }),
      finding({ id: 'short', original: f.original, before: 'stroy', after: 'story' }),
    ];
    expect(isolatedQuestion(f, overlapping)).toBe('She have wrote a story.');
  });
  it('skips malformed highlights and returns sorted, nonoverlapping, exact source slices', () => {
    const source = 'I have wrote. I have wrote.';
    const f = finding({ original: 'I have wrote.' });
    const result = writingHighlights(source, [
      finding({ before: '' }),
      finding({ original: '' }),
      finding({ original: 'I have wrote.', before: 'missing' }),
      f,
    ]);
    expect(result.map((r) => source.slice(r.start, r.end))).toEqual(['wrote', 'wrote']);
    expect(result[0]!.end).toBeLessThanOrEqual(result[1]!.start);
  });
});

describe('saved review recovery', () => {
  it.each([null, {}, 'text', 42])('ignores a non-array saved review list: %s', (value) =>
    expect(restoreWritingSessions(value)).toEqual([]),
  );
  it.each([
    null,
    { id: '' },
    session({ capture: { ...session().capture, selected: '' } }),
    session({ capture: { ...session().capture, selected: 'x'.repeat(6001) } }),
    session({ findings: null as never }),
  ])('keeps a valid review beside a damaged session %#', (bad) => {
    expect(restoreWritingSessions([bad, session()])).toHaveLength(1);
  });
  it('restores only the last four snapshots, defaults missing metadata, and never restarts jobs', () => {
    const result = restoreWritingSessions(
      Array.from({ length: 6 }, (_, i) => ({
        ...session(),
        id: `s${i}`,
        created: undefined,
        deck: undefined,
        summary: undefined,
        phase: 'analysing',
      })),
    );
    expect(result.map((s) => s.id)).toEqual(['s2', 's3', 's4', 's5']);
    for (const s of result) {
      expect(s.phase).toBe('idle');
      expect(s.deck).toBe('English::Writing mistakes');
      expect(Number.isNaN(Date.parse(s.created))).toBe(false);
    }
  });
  it('keeps valid cards and exported IDs, drops invalid cards and preserves explicit rejection', () => {
    const valid = session({ findings: [finding({ card: card(), noteId: 42, reused: true })] });
    const restored = restoreWritingSessions([valid])[0]!.findings[0]!;
    expect(restored.card).toEqual(card());
    expect(restored.noteId).toBe(42);
    expect(restored.reused).toBe(true);
    const invalid = session({
      findings: [
        finding({ card: card({ answer: 'wrong' }), selected: false, dismissed: true, noteId: -1 }),
      ],
    });
    const rejected = restoreWritingSessions([invalid])[0]!.findings[0]!;
    expect(rejected.card).toBeUndefined();
    expect(rejected.noteId).toBeUndefined();
    expect(rejected.selected).toBe(false);
    expect(restoreWritingSessions([session({ summary: 42 as never }), valid])).toHaveLength(1);
  });
});
