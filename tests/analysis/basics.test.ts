import { afterEach, describe, expect, it, vi } from 'vitest';
import { WritingModel } from '../../src/writing-model';
import { DEFAULTS } from '../../src/types';
import * as http from '../../src/http';
import { analysisJSON, rawFinding } from './fixtures';

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
        verdict: 'keep',
      })),
    }),
  );
}
afterEach(() => vi.restoreAllMocks());

describe('basic proofreading regressions', () => {
  it('keeps the capitalization correction with one unambiguous reviewer verdict', async () => {
    const text = 'I started to learn english a few years ago.';
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce(
        envelope(
          analysisJSON([
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
        expect(schema.properties.verdict.enum).toEqual(['keep', 'reject']);
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
    ['She bought new car yesterday.', 'new', 'a', 'a new', 'She bought a new car yesterday.'],
    ['Where you live?', 'you', 'do', 'do you', 'Where do you live?'],
  ])(
    'repairs a target that loses a source word during insertion: %s',
    async (text, before, wrong, after, corrected) => {
      const proposal = (replacement: string) =>
        envelope(
          analysisJSON([
            rawFinding({
              original_sentence: text,
              corrected_sentence: corrected,
              target_before: before,
              target_after: replacement,
            }),
          ]),
        );
      const request = vi
        .spyOn(http, 'jsonRequest')
        .mockResolvedValueOnce(proposal(wrong))
        .mockResolvedValueOnce(proposal(after))
        .mockImplementation(async (_url, body: any) => keep(body));
      const { findings } = await new WritingModel(DEFAULTS).analyse(text, signal());
      expect(findings).toHaveLength(1);
      expect(findings[0]!.original.replace(findings[0]!.before, () => findings[0]!.after)).toBe(
        corrected,
      );
      expect(request).toHaveBeenCalledTimes(3);
      const firstSchema = (request.mock.calls[0]![1] as any).format.properties.findings.items;
      expect(firstSchema.required).toContain('corrected_sentence');
      expect(
        JSON.parse((request.mock.calls[1]![1] as any).messages[1].content).validation_error,
      ).toContain('disagree');
    },
  );

  it('never silently interprets the old contradictory double-boolean response as an approval', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce(envelope(analysisJSON()))
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
