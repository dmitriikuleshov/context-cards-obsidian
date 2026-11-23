import { afterEach, describe, expect, it, vi } from 'vitest';
import { WritingModel } from '../src/writing-model';
import { DEFAULTS, type WritingOptions } from '../src/types';
import * as http from '../src/http';
import { proofreadingJSON } from './analysis/fixtures';

const text = 'I have wrote stories. I did a mistake. This is a stroy.';
const fixtures = [
  {
    kind: 'grammar',
    original_sentence: 'I have wrote stories.',
    target_before: 'wrote',
    target_after: 'written',
    recommended_format: 'gap',
  },
  {
    kind: 'vocabulary',
    original_sentence: 'I did a mistake.',
    target_before: 'did',
    target_after: 'made',
    recommended_format: 'correction',
  },
  {
    kind: 'typo',
    original_sentence: 'This is a stroy.',
    target_before: 'stroy',
    target_after: 'story',
    recommended_format: 'correction',
  },
];
function setup(options: Partial<WritingOptions> = {}, items = fixtures) {
  const request = vi.spyOn(http, 'jsonRequest').mockImplementation(async (_url, body: any) => {
    const fields = body.format.properties;
    let result: unknown;
    if (fields.sentences)
      result = JSON.parse(proofreadingJSON(items, JSON.parse(body.messages[1].content).text));
    else if (fields.decisions)
      result = {
        decisions: JSON.parse(body.messages[1].content).candidates.map((c: any) => ({
          id: c.id,
          verdict: 'required',
          pattern: 'A rule',
          recommended_format: c.target_before === 'wrote' ? 'gap' : 'correction',
          category: fixtures.find((f) => f.target_before === c.target_before)?.kind ?? 'grammar',
          explanation: 'Fix this target.',
          tip: '',
        })),
      };
    else
      result = Object.fromEntries(
        ['question', 'target', 'answer', 'corrected_sentence', 'explanation', 'tip']
          .map((key) => [key, fields[key].enum[0]])
          .concat([['hint', 'Use the correct form.']]),
      );
    return { message: { content: JSON.stringify(result) } };
  });
  const model = new WritingModel({ ...DEFAULTS, writing: { ...DEFAULTS.writing, ...options } });
  return { model, request, signal: new AbortController().signal };
}
afterEach(() => vi.restoreAllMocks());
describe('writing preferences', () => {
  it('lets the model choose a different exercise for each correction', async () => {
    const { model, signal, request } = setup();
    const analysis = await model.analyse(text, signal);
    expect(analysis.findings.map((f) => f.format)).toEqual(['gap', 'correction', 'correction']);
    const body = request.mock.calls[0]![1] as any;
    expect(
      (request.mock.calls[1]![1] as any).format.properties.decisions.items.properties
        .recommended_format.enum,
    ).toEqual(['correction', 'gap']);
  });
  it.each(['correction', 'gap'] as const)(
    'applies the %s default even if the model ignores it',
    async (exercise) => {
      const { model, signal, request } = setup({ exercise });
      const analysis = await model.analyse(text, signal);
      expect(analysis.findings.every((f) => f.format === exercise)).toBe(true);
      const body = request.mock.calls[0]![1] as any;
      expect(
        (request.mock.calls[1]![1] as any).format.properties.decisions.items.properties
          .recommended_format.enum,
      ).toEqual(['correction', 'gap']);
    },
  );
  it('keeps per-correction manual choice when preparing an exercise', async () => {
    const { model, signal } = setup({ exercise: 'gap' });
    const analysis = await model.analyse(text, signal);
    const finding = analysis.findings[0]!;
    finding.format = 'correction';
    const card = await model.exercise(finding, signal, analysis.findings);
    expect(card.kind).toBe('correction');
    expect(card.question).toBe('I have wrote stories.');
  });
  it('ignores legacy restrictions and always checks all categories in American English', async () => {
    const { model, signal, request } = setup({
      variant: 'british',
      grammar: false,
      vocabulary: false,
      spelling: false,
    } as any);
    const result = await model.analyse(text, signal);
    expect(result.findings.map((f) => f.kind)).toEqual(['grammar', 'vocabulary', 'typo']);
    for (const call of request.mock.calls.slice(0, 2)) {
      const prompt = (call[1] as any).messages[0].content;
      expect(prompt).toContain('Use American English');
      expect(prompt).not.toContain('Omit disabled categories');
    }
  });
  it('uses correction for deletions even under a gap default', async () => {
    const { model, signal } = setup({ exercise: 'gap' }, [
      {
        ...fixtures[0]!,
        original_sentence: 'We discussed about the plan.',
        target_before: 'about the',
        target_after: 'the',
      },
    ]);
    const analysis = await model.analyse('We discussed about the plan.', signal);
    expect(analysis.findings[0]!.format).toBe('correction');
    expect(analysis.findings[0]!.after).toBe('');
  });
});
