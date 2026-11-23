import { afterEach, describe, expect, it, vi } from 'vitest';
import { americanSpellingPolicy } from '../../src/writing-american';
import { WritingModel } from '../../src/writing-model';
import { DEFAULTS } from '../../src/types';
import * as http from '../../src/http';

afterEach(() => vi.restoreAllMocks());
describe('American spelling policy on grounded model proposals', () => {
  it.each([
    ['I practise daily.', 'practise', 'practice', 'normalize'],
    ['She practises daily.', 'practises', 'practices', 'normalize'],
    ['We analysed it.', 'analysed', 'analyzed', 'normalize'],
    ['The colour is red.', 'colour', 'color', 'normalize'],
    ['The color is red.', 'color', 'colour', 'preserve'],
    ["The label is 'colour'.", 'colour', 'color', 'preserve'],
    ['The label is “colour”.', 'colour', 'color', 'preserve'],
    ['The variable `colour` is set.', 'colour', 'color', 'preserve'],
    ['A `label` before colour.', 'colour', 'color', 'normalize'],
    ['The Colour Party won.', 'Colour', 'Color', undefined],
    ['I practise daily.', 'practise', 'train', undefined],
    ['No such word.', 'colour', 'color', undefined],
  ])('preserves meaning and the requested standard (%#)', (source, before, after, expected) => {
    expect(americanSpellingPolicy(source, before, after)).toBe(expected);
  });

  it.each(['required', 'optional', 'incorrect'] as const)(
    'handles a %s regional verdict without overriding a rejected replacement',
    async (verdict) => {
      vi.spyOn(http, 'jsonRequest')
        .mockResolvedValueOnce({
          message: {
            content: JSON.stringify({ sentences: [{ id: '1', corrected: 'I practice daily.' }] }),
          },
        })
        .mockResolvedValueOnce({
          message: {
            content: JSON.stringify({
              decisions: [
                {
                  id: '1',
                  verdict,
                  category: 'vocabulary',
                  recommended_format: 'correction',
                  pattern: 'spelling variation',
                  explanation: 'Use the American spelling.',
                  tip: '',
                },
              ],
            }),
          },
        });
      const { findings } = await new WritingModel(DEFAULTS).analyse(
        'I practise daily.',
        new AbortController().signal,
      );
      expect(findings).toHaveLength(verdict === 'incorrect' ? 0 : 1);
      if (verdict !== 'incorrect')
        expect(findings[0]).toMatchObject({
          kind: 'typo',
          selected: false,
          before: 'practise',
          after: 'practice',
          pattern: 'American spelling',
        });
    },
  );

  it.each([
    ["The label is 'colour'.", "The label is 'color'."],
    ['The variable `colour` is set.', 'The variable `color` is set.'],
    ['The color is red.', 'The colour is red.'],
  ])(
    'does not rename literals or switch away from American English: %s',
    async (source, corrected) => {
      vi.spyOn(http, 'jsonRequest')
        .mockResolvedValueOnce({
          message: { content: JSON.stringify({ sentences: [{ id: '1', corrected }] }) },
        })
        .mockResolvedValueOnce({
          message: {
            content: JSON.stringify({
              decisions: [
                {
                  id: '1',
                  verdict: 'required',
                  category: 'typo',
                  recommended_format: 'correction',
                  pattern: 'spelling',
                  explanation: 'Use the alternative spelling.',
                  tip: '',
                },
              ],
            }),
          },
        });
      expect(
        (await new WritingModel(DEFAULTS).analyse(source, new AbortController().signal)).findings,
      ).toEqual([]);
    },
  );
});
