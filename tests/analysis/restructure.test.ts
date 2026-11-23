import { describe, expect, it } from 'vitest';
import { linkedWritingEdit } from '../../src/writing-edit-relation';
import { writingEdits } from '../../src/writing-diff';
import { parseWritingAnalysis } from '../../src/writing';

describe('one grammatical restructuring', () => {
  it.each([
    ['I wonder where is she.', 'I wonder where she is.'],
    ['I do not know what has he done.', 'I do not know what he has done.'],
    ['She asked where did I live.', 'She asked where I lived.'],
    ['Could you tell me where does he work?', 'Could you tell me where he works?'],
    ['Never I have seen such a view.', 'Never have I seen such a view.'],
    ['Only then I realized my mistake.', 'Only then did I realize my mistake.'],
    ['She explained me the problem.', 'She explained the problem to me.'],
    ['He suggested me to take a break.', 'He suggested that I take a break.'],
    ['What means this word?', 'What does this word mean?'],
    [
      'Only after lunch I understood the problem.',
      'Only after lunch did I understand the problem.',
    ],
  ])('keeps a linked correction as one grounded practice target: %s', (original, corrected) => {
    const edits = writingEdits(original, corrected);
    expect(edits).toHaveLength(1);
    expect(original.replace(edits[0]!.before, () => edits[0]!.after)).toBe(corrected);
    expect(() =>
      parseWritingAnalysis(
        JSON.stringify({
          summary: '',
          findings: [
            {
              kind: 'grammar',
              title: 'Word order',
              original_sentence: original,
              target_before: edits[0]!.before,
              target_after: edits[0]!.after,
              explanation: 'Use the correct clause structure.',
              tip: '',
              pattern: 'word order',
              recommended_format: 'correction',
            },
          ],
        }),
        original,
        true,
      ),
    ).not.toThrow();
  });

  it('does not bundle independent spelling or agreement corrections with a reorder', () => {
    const edits = writingEdits(
      'I wonder where is she becaus I need help.',
      'I wonder where she is because I need help.',
    );
    expect(edits).toHaveLength(2);
    expect(edits.some((e) => e.before === 'becaus' && e.after === 'because')).toBe(true);
    expect(writingEdits('She have a stroy.', 'She has a story.')).toHaveLength(2);
    expect(writingEdits('She have wrote.', 'She has written.')).toHaveLength(2);
  });

  it.each([
    ['', ''],
    ['one', 'one'],
    ['have a stroy', 'has a story'],
    ['a'.repeat(121), 'b'],
    ['b', 'a'.repeat(121)],
    ['a '.repeat(11), 'b'],
    ['b', 'a '.repeat(11)],
    ['do', ''],
    ['I do live', 'I live here'],
    ['I danced', 'do we jump'],
    ['cats work', 'do cat works'],
    ['me to', 'that we'],
    ['her at', 'that she'],
    ['him to', 'why he'],
    ['do work', 'does work'],
  ])('rejects unrelated/oversized combinations (%#)', (before, after) => {
    expect(linkedWritingEdit(before, after)).toBe(false);
  });
  it.each([
    ['him to', 'that he'],
    ['us to', 'that we'],
    ['studies she', 'does she study'],
  ])('supports a bounded complementary structure (%#)', (before, after) => {
    expect(linkedWritingEdit(before, after)).toBe(true);
  });
});
