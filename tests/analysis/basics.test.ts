import { afterEach, describe, expect, it, vi } from 'vitest';
import { WritingModel } from '../../src/writing-model';
import { DEFAULTS } from '../../src/types';
import * as http from '../../src/http';
import { proofreadingJSON, rawFinding } from './fixtures';

const signal = () => new AbortController().signal;
const envelope = (content: string) => ({ message: { content } });
function keep(body: any) {
  const data = JSON.parse(body.messages[1].content);
  return envelope(
    JSON.stringify({
      decisions: (data.input ?? data).candidates.map((c: any) => ({
        id: c.id,
        explanation: 'Names of languages are capitalized.',
        tip: 'Capitalize language names.',
        verdict: 'required',
        category: 'grammar',
        pattern: 'Capitalization',
        recommended_format: 'correction',
      })),
    }),
  );
}
afterEach(() => vi.restoreAllMocks());

describe('basic proofreading regressions', () => {
  it.each([
    'null',
    '{}',
    '{"sentences":[]}',
    JSON.stringify({ sentences: [{ id: 'missing', corrected: 'Good.' }] }),
    JSON.stringify({ sentences: [{ id: 1, corrected: 'Good.' }] }),
    JSON.stringify({ sentences: [null] }),
    ...[null, '', '  ', 'x'.repeat(6301)].map((corrected) =>
      JSON.stringify({ sentences: [{ id: '1', corrected }] }),
    ),
  ])('retries incomplete or ungrounded sentence coverage, then fails closed (%#)', async (raw) => {
    const request = vi.spyOn(http, 'jsonRequest').mockResolvedValue(envelope(raw));
    await expect(new WritingModel(DEFAULTS).analyse('Good.', signal())).rejects.toThrow(
      'after retry',
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate sentence IDs even when the result count matches', async () => {
    vi.spyOn(http, 'jsonRequest').mockResolvedValue(
      envelope(
        JSON.stringify({
          sentences: [
            { id: '1', corrected: 'Good.' },
            { id: '1', corrected: 'Fine.' },
          ],
        }),
      ),
    );
    await expect(new WritingModel(DEFAULTS).analyse('Good. Fine.', signal())).rejects.toThrow(
      'identifier',
    );
  });

  it('matches reordered sentence results by ID and preserves the original passage', async () => {
    vi.spyOn(http, 'jsonRequest').mockResolvedValue(
      envelope(
        JSON.stringify({
          sentences: [
            { id: '2', corrected: 'Fine.' },
            { id: '1', corrected: 'Good.' },
          ],
        }),
      ),
    );
    expect((await new WritingModel(DEFAULTS).analyse('Good. Fine.', signal())).findings).toEqual(
      [],
    );
  });

  it.each(['Good', 'She works!'])(
    'does not invent a terminal full stop on a selected fragment: %s',
    async (text) => {
      const corrected = text === 'Good' ? 'Good.' : text;
      const request = vi
        .spyOn(http, 'jsonRequest')
        .mockResolvedValue(envelope(JSON.stringify({ sentences: [{ id: '1', corrected }] })));
      expect((await new WritingModel(DEFAULTS).analyse(text, signal())).findings).toEqual([]);
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves a real word correction while removing a model-added terminal full stop', async () => {
    vi.spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce(
        envelope(JSON.stringify({ sentences: [{ id: '1', corrected: 'I learn English.' }] })),
      )
      .mockImplementation(async (_url, body: any) => keep(body));
    const result = await new WritingModel(DEFAULTS).analyse('I learn english', signal());
    expect(result.findings.map((f) => [f.before, f.after])).toEqual([['english', 'English']]);
  });
  it('keeps the capitalization correction with one unambiguous reviewer verdict', async () => {
    const text = 'I started to learn english a few years ago.';
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce(
        envelope(
          proofreadingJSON([
            rawFinding({
              original_sentence: text,
              corrected_sentence: text.replace('english', 'English'),
              target_before: 'english',
              target_after: 'English',
            }),
          ]),
        ),
      )
      .mockImplementation(async (_url, body: any) => {
        const schema = body.format.properties.decisions.items;
        expect(schema.properties.verdict.enum).toEqual(['required', 'optional', 'incorrect']);
        expect(schema.properties).not.toHaveProperty('original_acceptable');
        expect(schema.properties).not.toHaveProperty('valid');
        const candidate = JSON.parse(body.messages[1].content).candidates[0];
        expect(candidate.original).toBe(text);
        expect(candidate.proposed).toBe(text.replace('english', 'English'));
        return keep(body);
      });
    const { findings } = await new WritingModel(DEFAULTS).analyse(text, signal());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ before: 'english', after: 'English', selected: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['She bought new car yesterday.', 'She bought a new car yesterday.'],
    ['Where you live?', 'Where do you live?'],
  ])(
    'derives an insertion without allowing the model to remove the neighbouring word: %s',
    async (text, corrected) => {
      const request = vi
        .spyOn(http, 'jsonRequest')
        .mockResolvedValueOnce(envelope(JSON.stringify({ sentences: [{ id: '1', corrected }] })))
        .mockImplementation(async (_url, body: any) => keep(body));
      const { findings } = await new WritingModel(DEFAULTS).analyse(text, signal());
      expect(findings).toHaveLength(1);
      expect(findings[0]!.original.replace(findings[0]!.before, () => findings[0]!.after)).toBe(
        corrected,
      );
      expect(request).toHaveBeenCalledTimes(2);
      const firstSchema = (request.mock.calls[0]![1] as any).format.properties.sentences.items;
      expect(firstSchema.required).toEqual(['id', 'corrected']);
      expect(firstSchema.properties).not.toHaveProperty('target_before');
    },
  );

  it('never silently interprets the old contradictory double-boolean response as an approval', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce(envelope(proofreadingJSON()))
      .mockResolvedValueOnce(
        envelope(
          JSON.stringify({
            decisions: [
              {
                id: '1',
                original_acceptable: true,
                valid: false,
                explanation: 'The correction is required.',
                tip: '',
              },
            ],
          }),
        ),
      )
      .mockImplementation(async (_url, body: any) => keep(body));
    expect(
      (await new WritingModel(DEFAULTS).analyse('I have wrote three stories.', signal())).findings,
    ).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(3);
  });
});
