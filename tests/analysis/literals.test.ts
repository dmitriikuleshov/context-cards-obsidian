import { afterEach, describe, expect, it, vi } from 'vitest';
import { protectedWritingLiteral } from '../../src/writing-literals';
import { WritingModel } from '../../src/writing-model';
import { DEFAULTS } from '../../src/types';
import * as http from '../../src/http';
afterEach(() => vi.restoreAllMocks());
describe('literal data and surrounding prose', () => {
  it.each([
    ['The literal `I has` is test data.', 'has', 'have', true],
    ['The label reads "I has" exactly as printed.', 'has', 'have', true],
    ["The string is 'I don't knows'.", 'knows', 'know', true],
    ['The variable is “she have”.', 'have', 'has', true],
    ['The literal is ‘she have’.', 'have', 'has', true],
    ['The code `word` contains a value.', 'word', 'words', true],
    ['The identifier `value` is set.', 'value', 'valued', true],
    ['The literal `I has` is test data.', 'has', 'has now', true],
    ['She have the variable `x`.', 'have', 'has', false],
    [
      'Why the function `foo` returns a value?',
      'the function `foo` returns',
      'does the function `foo` return',
      false,
    ],
    ['The literal `abc` is set.', 'literal `abc`', 'literal', true],
    ['The literal `abc` is set.', 'literal `abc`', 'new literal `abc`', false],
    ['She said "I has a car".', 'has', 'have', false],
    ['No matching target.', 'missing', 'replacement', false],
    ['The label reads "word".', 'label', 'labels', false],
    ['The label reads "word".', 'reads', 'read', false],
  ])(
    'protects data but permits real nearby corrections (%#)',
    (source, before, after, expected) => {
      expect(protectedWritingLiteral(source, before, after)).toBe(expected);
    },
  );
  it('ignores a mistaken model rewrite inside a quoted label before review/export', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValue({
        message: {
          content: JSON.stringify({
            sentences: [{ id: '1', corrected: 'The label reads "I have" exactly as printed.' }],
          }),
        },
      });
    expect(
      (
        await new WritingModel(DEFAULTS).analyse(
          'The label reads "I has" exactly as printed.',
          new AbortController().signal,
        )
      ).findings,
    ).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
