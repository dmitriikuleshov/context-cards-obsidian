import { afterEach, it, expect, vi } from 'vitest';
import { Anki } from '../src/anki';
import { WritingAnki } from '../src/writing-anki';
import { DEFAULTS } from '../src/types';
import { parseWritingAnalysis } from '../src/writing';
function finding() {
  const original = 'I have wrote stories.';
  const f = parseWritingAnalysis(
    JSON.stringify({
      summary: '',
      findings: [
        {
          kind: 'grammar',
          title: 'Participle',
          original_sentence: original,
          target_before: 'wrote',
          target_after: 'written',
          explanation: 'Use the participle.',
          tip: '',
          pattern: 'perfect',
          recommended_format: 'correction',
        },
      ],
    }),
    original,
  ).findings[0]!;
  f.card = {
    kind: 'correction',
    question: original,
    target: 'wrote',
    answer: 'written',
    corrected: 'I have written stories.',
    hint: '',
    explanation: f.explanation,
    tip: '',
  };
  return f;
}
afterEach(() => vi.restoreAllMocks());
it('creates a separate one-template model and reuses matching practice', async () => {
  let stored = false;
  const calls: any[] = [];
  vi.spyOn(Anki.prototype, 'action').mockImplementation(async (action, params) => {
    calls.push({ action, params });
    if (action === 'findNotes') return (stored ? [99] : []) as any;
    if (action === 'modelNames') return [] as any;
    if (action === 'addNote') {
      stored = true;
      return 99 as any;
    }
    return null as any;
  });
  const api = new WritingAnki(structuredClone(DEFAULTS)),
    f = finding();
  expect(await api.add(f, 'English::Writing mistakes', 'obsidian://open')).toEqual({
    noteId: 99,
    existing: false,
  });
  f.id = 'another-id';
  expect(await api.add(f, 'English::Writing mistakes', 'obsidian://open')).toEqual({
    noteId: 99,
    existing: true,
  });
  expect(calls.filter((c) => c.action === 'addNote')).toHaveLength(1);
  expect(calls.find((c) => c.action === 'createModel').params.cardTemplates).toHaveLength(1);
  expect(calls.find((c) => c.action === 'createModel').params.modelName).toBe(
    'Context Cards Writing',
  );
});
it('recovers the note ID after a lost add response', async () => {
  let stored = false;
  vi.spyOn(Anki.prototype, 'action').mockImplementation(async (action) => {
    if (action === 'findNotes') return (stored ? [100] : []) as any;
    if (action === 'modelNames') return [] as any;
    if (action === 'addNote') {
      stored = true;
      throw new Error('Connection lost');
    }
    return null as any;
  });
  expect(
    (await new WritingAnki(DEFAULTS).add(finding(), 'Writing', 'obsidian://open')).noteId,
  ).toBe(100);
});
