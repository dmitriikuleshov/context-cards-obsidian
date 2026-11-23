import { expect, it } from 'vitest';
import { scoreWritingEdits } from '../scripts/writing-audit-score.mjs';
it('accepts predeclared valid alternatives without excusing unrelated edits', () => {
  const c = {
    expected: ['She gave me some advice.'],
    alternativeExpected: [['She gave me a piece of advice.'], ['She gave me advice.']],
  };
  expect(scoreWritingEdits(['She gave me advice.'], c).pass).toBe(true);
  const result = scoreWritingEdits(['She gave me advice.', 'Unrelated rewrite.'], c);
  expect(result.pass).toBe(false);
  expect(result.extra).toEqual(['Unrelated rewrite.']);
});
it('reports omitted independent corrections rather than crediting only one', () => {
  const r = scoreWritingEdits(['first'], { expected: ['first', 'second'] });
  expect(r.pass).toBe(false);
  expect(r.missing).toEqual(['second']);
});
it('does not accept changes to a correct-text control', () => {
  expect(scoreWritingEdits([], { expected: [] }).pass).toBe(true);
  expect(scoreWritingEdits(['an optional preference'], { expected: [] }).pass).toBe(false);
});
