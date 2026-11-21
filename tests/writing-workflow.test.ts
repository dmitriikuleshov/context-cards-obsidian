import { describe, it, expect } from 'vitest';
import { writingHighlights } from '../src/writing-workflow';
import type { WritingFinding } from '../src/writing';
const f = (id: string, original: string, before: string) =>
  ({ id, original, before }) as WritingFinding;
describe('exact source annotations', () => {
  it('anchors a word to its own sentence rather than an earlier occurrence', () => {
    const source = 'He wrote before. I have wrote stories.';
    expect(writingHighlights(source, [f('a', 'I have wrote stories.', 'wrote')])).toEqual([
      { id: 'a', start: 24, end: 29 },
    ]);
  });
  it('keeps every repeated quote inspectable and ignores missing source quotes', () => {
    const source = 'I did it. I did it.';
    const ranges = writingHighlights(source, [
      f('a', 'I did it.', 'did'),
      f('missing', 'I do it.', 'do'),
    ]);
    expect(ranges).toHaveLength(2);
    expect(ranges.map((r) => source.slice(r.start, r.end))).toEqual(['did', 'did']);
  });
  it('does not produce overlapping markup or treat HTML as markup', () => {
    const source = '<script> I have wrote stories.';
    const ranges = writingHighlights(source, [
      f('a', source, 'have wrote'),
      f('b', source, 'wrote'),
    ]);
    expect(ranges).toHaveLength(1);
    expect(source.slice(ranges[0]!.start, ranges[0]!.end)).toBe('have wrote');
  });
});
