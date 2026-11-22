import { vi } from 'vitest';
import ContextCardsPlugin from '../../src/main';
import { createDraft } from '../../src/text';
import { DEFAULTS, type Capture, type Content, type Draft } from '../../src/types';
export const SOURCE = 'She brushed off the warning.';
export function capture(overrides: Partial<Capture> = {}): Capture {
  return {
    text: SOURCE,
    selected: 'brushed off',
    start: 4,
    end: 15,
    file: 'Books/Book.md',
    book: 'Book',
    vault: 'Test',
    mode: 'editor',
    ...overrides,
  };
}
export function content(overrides: Partial<Content> = {}): Content {
  return {
    status: 'ready',
    expression: 'brush off',
    partOfSpeech: 'phrasal verb',
    americanIpa: '/bɹʌʃ ɔf/',
    meaning: 'Dismiss something without consideration.',
    generalMeaning: 'To dismiss or ignore. It can describe refusing attention.',
    wordFormation: 'brush — To sweep lightly.',
    explanation: 'The warning was dismissed.',
    examples: [
      'He brushed off my advice.',
      'She brushed off the complaint.',
      'They brushed off our concerns.',
      'We brushed off the criticism.',
      'He brushed off the suggestion.',
    ],
    notes: ['brush off a warning'],
    question: '',
    ...overrides,
  };
}
export function draft(overrides: Partial<Draft> = {}): Draft {
  return { ...createDraft(capture(), structuredClone(DEFAULTS)), ...content(), ...overrides };
}
export function rawContent(overrides: Record<string, unknown> = {}) {
  const c = content();
  return {
    status: 'ready',
    lemma: c.expression,
    target_is_single_item: true,
    target_source_form: 'brushed off',
    part_of_speech: c.partOfSpeech,
    american_ipa: c.americanIpa,
    meaning: c.meaning,
    explanation: c.explanation,
    examples: c.examples,
    notes: c.notes,
    clarification_question: '',
    ...overrides,
  };
}
export const response = (value: unknown) => ({ message: { content: JSON.stringify(value) } });
export function pluginFixture() {
  const file = { path: 'Books/Book.md', basename: 'Book' };
  const workspace: any = {
    getLeavesOfType: vi.fn(() => []),
    getActiveViewOfType: vi.fn(() => null),
    getLeaf: vi.fn(),
    getRightLeaf: vi.fn(),
    revealLeaf: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => ({})),
  };
  const vault: any = { getName: () => 'Test', getFileByPath: vi.fn(() => file), process: vi.fn() };
  const app: any = { workspace, vault, setting: { open: vi.fn(), openTabById: vi.fn() } };
  const plugin = new ContextCardsPlugin(app, {} as any),
    d = draft();
  plugin.drafts = [d];
  const persist = vi.spyOn(plugin, 'persist').mockImplementation(() => {}),
    flush = vi.spyOn(plugin, 'flush').mockResolvedValue();
  const refresh = vi.spyOn(plugin, 'refresh').mockImplementation(() => {});
  return { plugin, d, app, workspace, vault, file, persist, flush, refresh };
}
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
