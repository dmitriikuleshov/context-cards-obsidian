import { describe, expect, it } from 'vitest';
import { writingEdits } from '../../src/writing-diff';
import { parseWritingAnalysis } from '../../src/writing';

describe('edits derived from corrected prose', () => {
  it.each([
    ['I learn english.', 'I learn English.', [{ before: 'english', after: 'English' }]],
    [
      'She have wrote a letter.',
      'She has written a letter.',
      [
        { before: 'have', after: 'has' },
        { before: 'wrote', after: 'written' },
      ],
    ],
    ['Where you live?', 'Where do you live?', [{ before: 'you', after: 'do you' }]],
    ['She bought new car.', 'She bought a new car.', [{ before: 'new', after: 'a new' }]],
    ['We discussed about the plan.', 'We discussed the plan.', [{ before: 'about ', after: '' }]],
    [
      'I have wrote a stroy.',
      'I have written a story.',
      [
        { before: 'wrote', after: 'written' },
        { before: 'stroy', after: 'story' },
      ],
    ],
    ['She is nice', 'She is nice.', [{ before: 'nice', after: 'nice.' }]],
    ['She  is nice.', 'She is nice.', []],
    ['Good.', 'Good.', []],
    ['It is hand-written.', 'It is handwritten.', []],
    ['Use email.', 'Use e-mail.', []],
    ["The dog wagged it's tail.", 'The dog wagged its tail.', [{ before: "'", after: '' }]],
    ['Hello 🙂 english.', 'Hello 🙂 English.', [{ before: 'english', after: 'English' }]],
  ])('extracts grounded complete-word targets: %s', (before, after, edits) => {
    expect(writingEdits(before as string, after as string)).toEqual(edits);
  });

  it.each([
    ['I work here?', 'Do I work here?'],
    ['Very good', 'Very good indeed'],
    ['He dont know.', "He doesn't know."],
    ['He does not likes coffee.', 'He does not like coffee.'],
    ['I saw a mesage and a mesage.', 'I saw a message and a mesage.'],
  ])('reconstructs a single local correction exactly: %s', (original, corrected) => {
    const edits = writingEdits(original, corrected);
    expect(edits).toHaveLength(1);
    expect(original.replace(edits[0]!.before, () => edits[0]!.after)).toBe(corrected);
  });

  it('bounds expensive alignments and oversized rewrites', () => {
    expect(() => writingEdits('a '.repeat(600), 'b '.repeat(600))).toThrow('Too many changes');
    expect(() => writingEdits('a'.repeat(301), 'b'.repeat(301))).toThrow('rewrote too much');
  });

  it('preserves nonoverlapping atomic targets when adjacent verb errors are independently reviewed', () => {
    const original = 'She have wrote a letter.';
    const findings = writingEdits(original, 'She has written a letter.').map((edit) => ({
      kind: 'grammar',
      title: 'Verb form',
      original_sentence: original,
      target_before: edit.before,
      target_after: edit.after,
      explanation: 'Verb form.',
      tip: '',
      pattern: '',
      recommended_format: 'correction',
    }));
    const parsed = parseWritingAnalysis(JSON.stringify({ summary: '', findings }), original, true);
    expect(parsed.findings.map((f) => f.before)).toEqual(['have', 'wrote']);
  });
});
