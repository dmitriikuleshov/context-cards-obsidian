import { describe, expect, it } from 'vitest';
import { sourceMarkRange } from '../src/source-mark';
import type { Capture } from '../src/types';
function capture(text: string, word: string, start = text.indexOf(word)): Capture {
  return {
    text,
    selected: word,
    start,
    end: start + word.length,
    file: 'Book.md',
    book: 'Book',
    vault: 'Test',
    mode: 'reading',
  };
}
describe('marking the selected source occurrence', () => {
  it('locates the intended repeated word using surrounding context', () => {
    const text = 'The bright sun rose. The bright student smiled.';
    expect(sourceMarkRange(text, capture('The bright student smiled.', 'bright'))).toMatchObject({
      start: 25,
      end: 31,
    });
  });
  it('maps rendered text back through Markdown emphasis', () => {
    const text = 'He **could** conceivably survive.';
    expect(
      sourceMarkRange(text, capture('He could conceivably survive.', 'conceivably')),
    ).toMatchObject({ start: 13, end: 24 });
  });
  it('uses the exact editor selection even when surrounding text repeats', () => {
    const text = 'The word. The word.';
    expect(sourceMarkRange(text, capture('The word.', 'word'), 14)).toMatchObject({
      start: 14,
      end: 18,
    });
  });
  it('does not mark a stale snapshot or words inside an unclosed fence', () => {
    expect(
      sourceMarkRange('A bright future awaits.', capture('The bright student smiled.', 'bright')),
    ).toBeNull();
    expect(sourceMarkRange('```text\nword', capture('word', 'word'))).toBeNull();
    expect(sourceMarkRange('~~~text\nword', capture('word', 'word'))).toBeNull();
    expect(sourceMarkRange('```text\n`literal` word\n```', capture('word', 'word'))).toBeNull();
    expect(
      sourceMarkRange('```text\ncode\n```\nA word.', capture('A word.', 'word')),
    ).not.toBeNull();
  });
  it('avoids double wrapping, code fences, partial words and ambiguous copies', () => {
    expect(
      sourceMarkRange(
        'He `conceivably` survived.',
        capture('He conceivably survived.', 'conceivably'),
      ),
    ).toBeNull();
    expect(
      sourceMarkRange('```\nconceivably\n```', capture('conceivably', 'conceivably')),
    ).toBeNull();
    expect(sourceMarkRange('A rainbow.', capture('rain', 'rain'))).toBeNull();
    expect(sourceMarkRange('The word. The word.', capture('The word.', 'word'))).toBeNull();
  });
});
