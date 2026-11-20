import { describe, it, expect } from 'vitest';
import { americanPronunciations, arpabetToIpa } from '../src/pronunciation';
describe('offline General American pronunciation', () => {
  it('uses the displayed base form rather than the source past tense', () => {
    expect(americanPronunciations('seek to')).toContain('/siːk tuː/');
    expect(americanPronunciations('seek to').join(' ')).not.toContain('səʊt');
  });
  it('preserves stress, plural endings and American r-colouring', () => {
    expect(americanPronunciations('vagaries')).toContain('/ˈveɪɡɚiz/');
    expect(americanPronunciations('conceivably')).toContain('/kənˈsiːvəbli/');
    expect(americanPronunciations('obscurity')).toContain('/əbˈskjʊɹəti/');
    expect(arpabetToIpa('B ER1 D')).toBe('bɝd');
  });
  it('keeps heteronym variants for selection, and leaves unknown words to the model', () => {
    expect(americanPronunciations('record').length).toBeGreaterThan(1);
    expect(americanPronunciations('zindlebrate')).toEqual([]);
  });
});
