import { afterEach, describe, expect, it, vi } from 'vitest';
import { WritingModel } from '../../src/writing-model';
import { DEFAULTS } from '../../src/types';
import { restoreWritingSessions } from '../../src/writing';
import { session } from './fixtures';
import * as http from '../../src/http';
const names = [
  'Alice',
  'Ben',
  'Carla',
  'David',
  'Elena',
  'Frank',
  'Grace',
  'Henry',
  'Iris',
  'Jack',
  'Kate',
  'Leo',
];
const text = names.map((n) => `${n} work here.`).join(' ');
const envelope = (value: unknown) => ({ message: { content: JSON.stringify(value) } });
const corrected = () =>
  envelope({
    sentences: names.map((n, i) => ({ id: String(i + 1), corrected: `${n} works here.` })),
  });
function review(body: any) {
  const data = JSON.parse(body.messages[1].content),
    input = data.input ?? data;
  return envelope({
    decisions: input.candidates.map((f: any) => ({
      id: f.id,
      verdict: 'required',
      category: 'grammar',
      pattern: 'agreement',
      recommended_format: 'correction',
      explanation: 'Use the third-person singular form.',
      tip: '',
    })),
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('bounded review batches and restoration', () => {
  it('reviews all twelve errors and restores them without truncating to ten', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockImplementation(async (_url, body: any) =>
        body.format.properties.sentences ? corrected() : review(body),
      );
    const result = await new WritingModel(DEFAULTS).analyse(text, new AbortController().signal);
    expect(result.findings).toHaveLength(12);
    expect(request).toHaveBeenCalledTimes(3);
    expect(
      request.mock.calls
        .slice(1)
        .map((call) =>
          JSON.parse((call[1] as any).messages[1].content).candidates.map((c: any) => c.id),
        ),
    ).toEqual([
      ['1', '2', '3', '4', '5', '6'],
      ['7', '8', '9', '10', '11', '12'],
    ]);
    const s = session({ findings: result.findings });
    s.capture = { ...s.capture, text, selected: text, end: text.length };
    expect(restoreWritingSessions([s])[0]!.findings).toHaveLength(12);
  });
  it('shares one total deadline across all batches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const request = vi.spyOn(http, 'jsonRequest').mockImplementation(async (_url, body: any) => {
      if (body.format.properties.sentences) {
        vi.setSystemTime(10000);
        return corrected();
      }
      const result = review(body);
      vi.setSystemTime(30000);
      return result;
    });
    await new WritingModel(DEFAULTS).analyse(text, new AbortController().signal);
    expect(request.mock.calls.map((call) => call[3])).toEqual([60000, 50000, 30000]);
  });
  it('never exposes partially checked work if a later batch fails', async () => {
    const request = vi.spyOn(http, 'jsonRequest').mockImplementation(async (_url, body: any) => {
      if (body.format.properties.sentences) return corrected();
      if (JSON.parse(body.messages[1].content).candidates[0].id === '7') throw new Error('offline');
      return review(body);
    });
    await expect(
      new WritingModel(DEFAULTS).analyse(text, new AbortController().signal),
    ).rejects.toThrow('offline');
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('does not reuse decisions from another batch even when the count is right', async () => {
    vi.spyOn(http, 'jsonRequest').mockImplementation(async (_url, body: any) => {
      if (body.format.properties.sentences) return corrected();
      const result = review(body),
        data = JSON.parse(result.message.content);
      data.decisions.forEach((d: any, i: number) => (d.id = String(i + 1)));
      return envelope(data);
    });
    await expect(
      new WritingModel(DEFAULTS).analyse(text, new AbortController().signal),
    ).rejects.toThrow('invalid feedback');
  });
});
