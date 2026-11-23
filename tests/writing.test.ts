import { WritingModel } from '../src/writing-model';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  parseWritingAnalysis,
  parseWritingCard,
  correctedSentence,
  minimalCorrection,
  isolatedQuestion,
  canPractise,
  restoreWritingSessions,
  validateWritingTarget,
  writingCorrectionTitle,
  type WritingFinding,
} from '../src/writing';
import { writingNoteFields, WRITING_TEMPLATE, WRITING_FIELDS } from '../src/writing-anki';
import { DEFAULTS } from '../src/types';
import * as http from '../src/http';
import { proofreadingJSON } from './analysis/fixtures';
const source = 'I have wrote three stories this week.';
const finding = {
  kind: 'grammar',
  title: 'Past participle',
  original_sentence: source,
  target_before: 'wrote',
  target_after: 'written',
  explanation: 'Use the past participle after have.',
  tip: 'write → wrote → written',
  pattern: 'present perfect participle',
  recommended_format: 'correction',
};
export function sampleFinding(): WritingFinding {
  return parseWritingAnalysis(
    JSON.stringify({ summary: 'One useful correction.', findings: [finding] }),
    source,
  ).findings[0]!;
}
afterEach(() => vi.restoreAllMocks());
describe('writing analysis and practice validation', () => {
  it('repairs an invalid reviewer verdict instead of accepting unverified feedback', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce({
        message: {
          content: proofreadingJSON([finding], source),
        },
      })
      .mockImplementation(async (_url, body: any) => {
        const input = JSON.parse(body.messages[1].content);
        const candidates = input.candidates ?? input.input.candidates;
        return {
          message: {
            content: JSON.stringify({
              decisions: candidates.map((c: any) => ({
                id: c.id,
                verdict: input.validation_error ? 'required' : 'yes',
                category: 'grammar',
                pattern: 'Participle',
                recommended_format: 'correction',
                explanation: 'Use the past participle after have.',
                tip: '',
              })),
            }),
          },
        };
      });
    const result = await new WritingModel(DEFAULTS).analyse(source, new AbortController().signal);
    expect(result.findings).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(request.mock.calls[2]![1])).toContain('invalid feedback');
  });
  it('uses a correction card for a deletion even if the model requests a typed gap', () => {
    const original = 'We discussed about the plan.';
    const f = parseWritingAnalysis(
      JSON.stringify({
        summary: '',
        findings: [
          {
            ...finding,
            original_sentence: original,
            target_before: 'about the',
            target_after: 'the',
            recommended_format: 'gap',
          },
        ],
      }),
      original,
      true,
    ).findings[0]!;
    expect(f.before).toBe('about ');
    expect(f.after).toBe('');
    expect(f.format).toBe('correction');
  });
  it('normalizes broad or partial-word model targets to the actual complete-word edit', () => {
    for (const [before, after] of [
      ['have wrote', 'have written'],
      ['ote', 'itten'],
    ]) {
      const result = parseWritingAnalysis(
        JSON.stringify({
          summary: '',
          findings: [{ ...finding, target_before: before, target_after: after }],
        }),
        source,
        true,
      );
      expect(result.findings[0]!.before).toBe('wrote');
      expect(result.findings[0]!.after).toBe('written');
    }
  });
  it('rejects competing selectable corrections instead of silently hiding one in the source', () => {
    expect(() =>
      parseWritingAnalysis(
        JSON.stringify({
          summary: '',
          findings: [
            finding,
            { ...finding, target_before: 'have wrote', target_after: 'had written' },
          ],
        }),
        source,
        true,
      ),
    ).toThrow('overlap');
  });
  it('supports a long sentence within the advertised selection limit', () => {
    const original = 'I have wrote ' + 'a detailed story about the journey '.repeat(100) + '.';
    const f = parseWritingAnalysis(
      JSON.stringify({ summary: '', findings: [{ ...finding, original_sentence: original }] }),
      original,
      true,
    ).findings[0]!;
    expect(
      parseWritingCard(
        JSON.stringify({
          question: original,
          target: 'wrote',
          answer: 'written',
          corrected_sentence: original.replace('wrote', 'written'),
          hint: '',
          explanation: f.explanation,
          tip: '',
        }),
        f,
      ).question,
    ).toBe(original);
  });
  it('binds a gap card to the approved correction even when a different answer reconstructs its sentence', () => {
    const f = { ...sampleFinding(), format: 'gap' as const };
    expect(() =>
      parseWritingCard(
        JSON.stringify({
          question: 'They [[gap]] home.',
          target: 'wrote',
          answer: 'went',
          corrected_sentence: 'They went home.',
          hint: '',
          explanation: f.explanation,
          tip: '',
        }),
        f,
      ),
    ).toThrow('approved correction');
  });
  it('repairs a generated card that ignores the constrained schema and invents its surrounding sentence', async () => {
    const f = sampleFinding();
    const request = vi.spyOn(http, 'jsonRequest').mockImplementation(async (_url, body: any) => {
      const wrong = request.mock.calls.length === 1;
      return {
        message: {
          content: JSON.stringify({
            question: wrong ? 'She wrote a novel.' : source,
            target: 'wrote',
            answer: 'written',
            corrected_sentence: wrong ? 'She written a novel.' : source.replace('wrote', 'written'),
            hint: '',
            explanation: f.explanation,
            tip: f.tip,
          }),
        },
      };
    });
    const card = await new WritingModel(DEFAULTS).exercise(f, new AbortController().signal);
    expect(card.question).toBe(source);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('corrects unselected spelling errors surrounding the learning target', () => {
    const f = { ...sampleFinding(), original: 'I have wrote a stroy.' };
    const peer = {
      ...sampleFinding(),
      id: 'typo',
      kind: 'typo' as const,
      original: f.original,
      before: 'stroy',
      after: 'story',
      selected: false,
    };
    expect(isolatedQuestion(f, [f, peer])).toBe('I have wrote a story.');
  });
  it('checks each local edit with its exact target and the full paragraph as context', async () => {
    const text = 'She have wrote three stories this week.';
    const items = [
      { ...finding, original_sentence: text, target_before: 'have', target_after: 'has' },
      { ...finding, original_sentence: text },
    ];
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce({
        message: {
          content: proofreadingJSON(items, text),
        },
      })
      .mockImplementation(async (_url, body: any) => {
        const input = JSON.parse(body.messages[1].content);
        expect(input.text).toBe(text);
        expect(input.candidates.map((f: any) => [f.target_before, f.target_after])).toEqual([
          ['have', 'has'],
          ['wrote', 'written'],
        ]);
        expect(input.candidates.map((f: any) => f.original)).toEqual([
          'She have written three stories this week.',
          'She has wrote three stories this week.',
        ]);
        return {
          message: {
            content: JSON.stringify({
              decisions: input.candidates.map((c: any) => ({
                id: c.id,
                verdict: 'required',
                category: 'grammar',
                pattern: 'Participle',
                recommended_format: 'correction',
                explanation: 'A valid local edit.',
                tip: '',
              })),
            }),
          },
        };
      });
    expect(
      (await new WritingModel(DEFAULTS).analyse(text, new AbortController().signal)).findings,
    ).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('keeps capitalization selectable even if the model labels it as optional style, and deduplicates identical edits', () => {
    const original = 'I learn english.';
    const item = {
      ...finding,
      kind: 'style',
      original_sentence: original,
      target_before: 'english',
      target_after: 'English',
    };
    const result = parseWritingAnalysis(
      JSON.stringify({
        summary: '',
        findings: [item, { ...item, title: 'Another title', pattern: 'Another pattern' }],
      }),
      original,
      true,
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.kind).toBe('grammar');
    expect(result.findings[0]!.selected).toBe(true);
  });
  it('rejects copied example sentences and multiple independent corrections', () => {
    const invented = {
      ...sampleFinding(),
      original: 'This is good',
      before: 'This is good',
      after: 'I made a mistake yesterday.',
    };
    expect(() => validateWritingTarget(invented)).toThrow('unrelated wording');
    expect(() =>
      validateWritingTarget({ ...invented, original: 'This is good.', before: 'This is good.' }),
    ).toThrow('unrelated wording');
    const combined = {
      ...sampleFinding(),
      original: 'I started to learn english a few years ago.',
      before: 'started to learn english',
      after: 'have started to learn English',
    };
    expect(() => validateWritingTarget(combined)).toThrow('multiple separate targets');
  });
  it('does not silently retarget a model correction and keep its unrelated explanation', () => {
    expect(() =>
      parseWritingAnalysis(
        JSON.stringify({
          summary: '',
          findings: [
            {
              ...finding,
              target_before: 'have',
              target_after: 'written',
              corrected_sentence: 'I have written three stories this week.',
            },
          ],
        }),
        source,
        true,
      ),
    ).toThrow('disagree');
  });
  it('uses the actual target for display labels even if a saved model title is unrelated', () => {
    const f = {
      ...sampleFinding(),
      before: 'english',
      after: 'English',
      title: 'Collocation: make a mistake',
    };
    expect(writingCorrectionTitle(f)).toBe('english → English');
  });
  it.each([true, false])(
    'uses the independent correction check before accepting feedback: %s',
    async (valid) => {
      const request = vi
        .spyOn(http, 'jsonRequest')
        .mockResolvedValueOnce({
          message: { content: proofreadingJSON([finding], source) },
        })
        .mockImplementation(async (_url, body: any) => {
          const input = JSON.parse(body.messages[1].content);
          return {
            message: {
              content: JSON.stringify({
                decisions: input.candidates.map((f: any) => ({
                  id: f.id,
                  verdict: valid ? 'required' : 'incorrect',
                  category: 'grammar',
                  pattern: 'Participle',
                  recommended_format: 'correction',
                  explanation: valid
                    ? 'Use the participle.'
                    : 'The original is already acceptable.',
                  tip: '',
                })),
              }),
            },
          };
        });
      const result = await new WritingModel(DEFAULTS).analyse(source, new AbortController().signal);
      expect(result.findings).toHaveLength(valid ? 1 : 0);
      if (valid) expect(result.findings[0]!.explanation).toBe('Use the participle.');
      expect(request).toHaveBeenCalledTimes(2);
    },
  );
  it('rejects an incomplete independent check instead of accepting unchecked findings', async () => {
    vi.spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce({
        message: { content: proofreadingJSON([finding], source) },
      })
      .mockResolvedValue({ message: { content: '{"decisions":[]}' } });
    await expect(
      new WritingModel(DEFAULTS).analyse(source, new AbortController().signal),
    ).rejects.toThrow('every proposed edit');
  });
  it('does not approve an edit when the reviewer says the original is already acceptable', async () => {
    vi.spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce({
        message: {
          content: proofreadingJSON([finding], source),
        },
      })
      .mockImplementation(async (_url, body: any) => ({
        message: {
          content: JSON.stringify({
            decisions: JSON.parse(body.messages[1].content).candidates.map((c: any) => ({
              id: c.id,
              verdict: 'optional',
              category: 'style',
              pattern: 'Optional wording',
              recommended_format: 'correction',
              explanation: 'An optional alternative.',
              tip: '',
            })),
          }),
        },
      }));
    expect(
      (await new WritingModel(DEFAULTS).analyse(source, new AbortController().signal)).findings,
    ).toEqual([]);
  });
  it('repairs invalid analysis once within the original timeout budget', async () => {
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValue(3000);
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce({
        message: {
          content: JSON.stringify({
            summary: '',
            findings: [{ ...finding, explanation: 'x'.repeat(2001) }],
          }),
        },
      })
      .mockResolvedValueOnce({
        message: { content: proofreadingJSON([finding], source) },
      })
      .mockImplementation(async (_url, body: any) => {
        const input = JSON.parse(body.messages[1].content);
        return {
          message: {
            content: JSON.stringify({
              decisions: input.candidates.map((f: any) => ({
                id: f.id,
                verdict: 'required',
                category: 'grammar',
                pattern: 'Participle',
                recommended_format: 'correction',
                explanation: 'Use the participle.',
                tip: '',
              })),
            }),
          },
        };
      });
    const result = await new WritingModel({ ...DEFAULTS, timeoutSeconds: 60 }).analyse(
      source,
      new AbortController().signal,
    );
    expect(result.findings).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[0]![3]).toBe(60000);
    expect(request.mock.calls[1]![3]).toBe(58000);
    expect(request.mock.calls[2]![3]).toBe(58000);
    expect(JSON.stringify(request.mock.calls[1]![1])).toContain('validation_error');
    now.mockRestore();
  });
  it('stops after two invalid responses and does not retry network failures', async () => {
    const request = vi.spyOn(http, 'jsonRequest').mockResolvedValue({ message: { content: '{}' } });
    await expect(
      new WritingModel(DEFAULTS).analyse(source, new AbortController().signal),
    ).rejects.toThrow('after retry');
    expect(request).toHaveBeenCalledTimes(2);
    request.mockReset().mockRejectedValue(new Error('Cannot connect to Ollama'));
    await expect(
      new WritingModel(DEFAULTS).analyse(source, new AbortController().signal),
    ).rejects.toThrow('Cannot connect');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('repairs a truncated card response without accepting a different answer', async () => {
    const f = sampleFinding();
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce({ done_reason: 'length', message: { content: '{}' } })
      .mockResolvedValueOnce({
        message: {
          content: JSON.stringify({
            question: source,
            target: 'wrote',
            answer: 'written',
            corrected_sentence: 'I have written three stories this week.',
            hint: '',
            explanation: f.explanation,
            tip: f.tip,
          }),
        },
      });
    expect(
      (await new WritingModel(DEFAULTS).exercise(f, new AbortController().signal)).answer,
    ).toBe('written');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('derives a visible complete-word target from the corrected sentence', () => {
    expect(minimalCorrection('I have wrote.', 'I have written.')).toEqual({
      before: 'wrote',
      after: 'written',
    });
    expect(minimalCorrection('I have cat.', 'I have a cat.')).toEqual({
      before: 'cat',
      after: 'a cat',
    });
  });
  it('anchors punctuation insertions and preserves whitespace in deletion targets', () => {
    expect(minimalCorrection('We discussed about the plan.', 'We discussed the plan.')).toEqual({
      before: 'about ',
      after: '',
    });
    expect(minimalCorrection('I did it', 'I did it.')).toEqual({ before: 'it', after: 'it.' });
    const raw = {
      ...finding,
      original_sentence: 'This is very good.',
      target_before: 'very ',
      target_after: '',
      corrected_sentence: 'This is good.',
    };
    const f = parseWritingAnalysis(
      JSON.stringify({ summary: '', findings: [raw] }),
      raw.original_sentence,
    ).findings[0]!;
    expect(correctedSentence(f)).toBe('This is good.');
  });
  it('fixes unrelated peer mistakes while leaving the target error to practise', () => {
    const f = {
      ...sampleFinding(),
      original: 'She have wrote stories.',
      before: 'wrote',
      after: 'written',
    };
    const other = {
      ...sampleFinding(),
      id: 'peer',
      original: f.original,
      before: 'have',
      after: 'has',
    };
    expect(isolatedQuestion(f, [f, other])).toBe('She has wrote stories.');
  });
  it('accepts genuine quotes, deduplicates targets and selects corrections by default', () => {
    const r = parseWritingAnalysis(
      JSON.stringify({ summary: 'One issue.', findings: [finding, finding] }),
      source,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.selected).toBe(true);
    expect(correctedSentence(r.findings[0]!)).toBe('I have written three stories this week.');
  });
  it('rejects invented source quotes and ambiguous targets', () => {
    expect(() =>
      parseWritingAnalysis(
        JSON.stringify({
          summary: '',
          findings: [{ ...finding, original_sentence: 'I wrote yesterday.' }],
        }),
        source,
      ),
    ).toThrow('match');
    expect(() =>
      parseWritingAnalysis(
        JSON.stringify({
          summary: '',
          findings: [{ ...finding, original_sentence: 'wrote wrote' }],
        }),
        'wrote wrote',
      ),
    ).toThrow('exactly once');
  });
  it('allows no findings and distinguishes style, uncertainty and typos', () => {
    expect(
      parseWritingAnalysis('{"summary":"No clear errors.","findings":[]}', source).findings,
    ).toEqual([]);
    for (const kind of ['style', 'unclear', 'typo']) {
      const f = parseWritingAnalysis(
        JSON.stringify({ summary: '', findings: [{ ...finding, kind }] }),
        source,
      ).findings[0]!;
      expect(f.kind).toBe(kind);
      expect(canPractise(f)).toBe(false);
    }
  });
  it('validates one correction target and a gap that reconstructs the answer', () => {
    const f = sampleFinding();
    const data = {
      question: source,
      target: 'wrote',
      answer: 'written',
      corrected_sentence: 'I have written three stories this week.',
      hint: '',
      explanation: 'Use the participle.',
      tip: '',
    };
    expect(parseWritingCard(JSON.stringify(data), f).kind).toBe('correction');
    expect(() => parseWritingCard(JSON.stringify({ ...data, answer: 'wrote' }), f)).toThrow(
      'approved',
    );
    f.format = 'gap';
    expect(
      parseWritingCard(
        JSON.stringify({ ...data, question: 'I have [[gap]] three stories this week.' }),
        f,
      ).answer,
    ).toBe('written');
    expect(() =>
      parseWritingCard(JSON.stringify({ ...data, question: '[[gap]] and [[gap]]' }), f),
    ).toThrow('gap');
  });
  it('escapes model text and creates a single writing exercise instead of vocabulary siblings', () => {
    const f = sampleFinding();
    f.card = parseWritingCard(
      JSON.stringify({
        question: source,
        target: 'wrote',
        answer: 'written',
        corrected_sentence: 'I have written three stories this week.',
        hint: '<img src=x onerror=alert(1)>',
        explanation: 'Use the participle.',
        tip: '',
      }),
      f,
    );
    const fields = writingNoteFields(f, 'obsidian://open?file=Review');
    expect(fields.Question).toContain('<mark>wrote</mark>');
    expect(fields.Question).not.toContain('<img');
    expect(fields.Typed).toBe('');
    expect(WRITING_TEMPLATE.Front).toContain('{{type:Answer}}');
    expect(WRITING_FIELDS[0]).toBe('Key');
  });
  it('refuses card generation for optional style suggestions', async () => {
    const f = { ...sampleFinding(), kind: 'style' as const };
    const request = vi.spyOn(http, 'jsonRequest');
    await expect(
      new WritingModel(DEFAULTS).exercise(f, new AbortController().signal),
    ).rejects.toThrow('Only approved');
    expect(request).not.toHaveBeenCalled();
  });
  it('restores work without restarting jobs or losing valid card identifiers', () => {
    const f = sampleFinding();
    f.noteId = 42;
    const s = {
      id: 'review',
      created: '2026-11-22',
      capture: {
        text: source,
        start: 7,
        end: 12,
        selected: source,
        file: 'Book.md',
        book: 'Book',
        vault: 'Test',
        mode: 'editor',
      },
      summary: 'One correction.',
      findings: [f],
      phase: 'exporting',
      analysed: true,
      deck: 'Writing',
    };
    const restored = restoreWritingSessions([s]);
    expect(restored[0]!.phase).toBe('idle');
    expect(restored[0]!.findings[0]!.noteId).toBe(42);
    f.selected = false;
    expect(restoreWritingSessions([s])[0]!.findings[0]!.selected).toBe(false);
    expect(restoreWritingSessions([{ ...s, capture: {} }])).toEqual([]);
  });
  it('restores valid corrections when one saved finding is damaged, retaining choices and repairing duplicate ids', () => {
    const f = sampleFinding();
    f.noteId = 42;
    const second = { ...sampleFinding(), id: f.id, before: 'have', after: 'had', selected: false };
    const s = {
      id: 'saved',
      capture: { selected: source, file: 'Book.md', vault: 'Test' },
      summary: '',
      findings: [f, null, second],
      analysed: true,
    };
    const restored = restoreWritingSessions([s]);
    expect(restored).toHaveLength(1);
    expect(restored[0]!.findings).toHaveLength(2);
    expect(restored[0]!.findings[0]!.noteId).toBe(42);
    expect(restored[0]!.findings[1]!.selected).toBe(false);
    expect(restored[0]!.findings[1]!.id).not.toBe(f.id);
    second.id = '';
    expect(restoreWritingSessions([s])[0]!.findings[1]!.selected).toBe(false);
  });
});
