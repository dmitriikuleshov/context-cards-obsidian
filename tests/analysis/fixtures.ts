import type { WritingCard, WritingFinding, WritingSession } from '../../src/writing';
export const SOURCE = 'I have wrote three stories.';
export function rawFinding(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'grammar',
    title: 'Past participle',
    original_sentence: SOURCE,
    target_before: 'wrote',
    target_after: 'written',
    explanation: 'Use a past participle after have.',
    tip: 'write → wrote → written',
    pattern: 'present perfect',
    recommended_format: 'correction',
    ...overrides,
  };
}
export function finding(overrides: Partial<WritingFinding> = {}): WritingFinding {
  return {
    id: 'finding-1',
    kind: 'grammar',
    title: 'Past participle',
    original: SOURCE,
    before: 'wrote',
    after: 'written',
    explanation: 'Use a past participle after have.',
    tip: 'write → wrote → written',
    pattern: 'present perfect',
    format: 'correction',
    selected: true,
    ...overrides,
  };
}
export function card(overrides: Partial<WritingCard> = {}): WritingCard {
  return {
    kind: 'correction',
    question: SOURCE,
    target: 'wrote',
    answer: 'written',
    corrected: 'I have written three stories.',
    hint: 'Use write.',
    explanation: 'Use a past participle after have.',
    tip: 'write → wrote → written',
    ...overrides,
  };
}
export function session(overrides: Partial<WritingSession> = {}): WritingSession {
  return {
    id: 'session-1',
    created: '2026-11-22T12:00:00Z',
    capture: {
      text: SOURCE,
      selected: SOURCE,
      start: 0,
      end: SOURCE.length,
      file: 'Essay.md',
      book: 'Essay',
      vault: 'Test',
      mode: 'editor',
    },
    findings: [finding()],
    summary: 'One correction.',
    phase: 'idle',
    analysed: true,
    error: '',
    deck: 'English::Writing mistakes',
    ...overrides,
  };
}
export const analysisJSON = (items: unknown[] = [rawFinding()]) =>
  JSON.stringify({ summary: 'Feedback.', findings: items });
/** Network fixture for the correction-first protocol (gold never enters production requests). */
export function proofreadingJSON(items: any[] = [rawFinding()], source?: string) {
  source ??= [...new Set(items.map((item) => item.original_sentence))].join(' ') || SOURCE;
  const sentences = Array.from(
    new Intl.Segmenter('en', { granularity: 'sentence' }).segment(source),
    (part, i) => {
      const original = part.segment.trim();
      let corrected = original;
      const edits = items
        .filter((item) => item.original_sentence === original)
        .map((item) => ({
          start: original.indexOf(item.target_before),
          before: item.target_before,
          after: item.target_after,
        }))
        .sort((a, b) => b.start - a.start);
      for (const edit of edits)
        corrected =
          corrected.slice(0, edit.start) +
          edit.after +
          corrected.slice(edit.start + edit.before.length);
      return { id: String(i + 1), corrected };
    },
  );
  return JSON.stringify({ sentences });
}
export const cardJSON = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    ...card(),
    corrected_sentence: card().corrected,
    ...overrides,
  });
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
