import { afterEach, describe, expect, it, vi } from 'vitest';
import ContextCardsPlugin from '../src/main';
import { Ollama } from '../src/ollama';
import { Anki, DuplicateError } from '../src/anki';
import { createDraft } from '../src/text';
import { DEFAULTS, type Content, type Draft } from '../src/types';

const content: Content = {
  status: 'ready',
  expression: 'brush off',
  partOfSpeech: 'phrasal verb',
  americanIpa: '/bɹʌʃ ɔf/',
  meaning: 'dismiss without considering',
  explanation: 'She dismissed the warning.',
  examples: [
    'He brushed off my advice.',
    'They brushed off the complaint.',
    'She brushed off the criticism.',
    'We brushed off his suggestion.',
    'They brushed off our complaints.',
  ],
  notes: [],
  question: '',
};
function setup() {
  const plugin = new ContextCardsPlugin(
    { workspace: { getLeavesOfType: () => [] } } as any,
    {} as any,
  );
  plugin.settings = structuredClone(DEFAULTS);
  const draft = createDraft(
    {
      text: 'She brushed off the warning.',
      start: 4,
      end: 15,
      selected: 'brushed off',
      file: 'Book.md',
      book: 'Book',
      vault: 'Test',
      mode: 'editor',
    },
    plugin.settings,
  );
  plugin.drafts = [draft];
  vi.spyOn(plugin, 'persist').mockImplementation(() => {});
  return { plugin, draft };
}
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
afterEach(() => vi.restoreAllMocks());
describe('draft state and asynchronous operations', () => {
  it('does not restore cleared drafts when source marking completes later', async () => {
    const { plugin, draft } = setup(),
      work = deferred<void>();
    plugin.drafts = [];
    plugin.settings.markSourceWord = true;
    (plugin.app.workspace as any).getActiveViewOfType = () => ({
      file: { path: draft.capture.file },
      getMode: () => 'preview',
    });
    plugin.app.vault = { process: () => work.promise } as any;
    const open = vi.spyOn(plugin, 'openPanel');
    const generate = vi.spyOn(plugin, 'generate');
    const running = plugin.capture({ ...draft.capture, mode: 'reading' });
    await plugin.clearDrafts();
    work.resolve();
    await running;
    expect(plugin.drafts).toEqual([]);
    expect(open).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
  it('deduplicates overlapping captures that await source marking', async () => {
    const { plugin, draft } = setup(),
      work = deferred<void>();
    plugin.drafts = [];
    plugin.settings.markSourceWord = true;
    (plugin.app.workspace as any).getActiveViewOfType = () => ({
      file: { path: draft.capture.file },
      getMode: () => 'preview',
    });
    plugin.app.vault = { process: () => work.promise } as any;
    vi.spyOn(plugin, 'openPanel').mockResolvedValue({ show: vi.fn() } as any);
    const generate = vi.spyOn(plugin, 'generate').mockResolvedValue();
    const first = plugin.capture({ ...draft.capture, mode: 'reading' });
    const second = plugin.capture({ ...draft.capture, mode: 'reading' });
    work.resolve();
    await Promise.all([first, second]);
    expect(plugin.drafts).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('fills only general meaning for an existing draft without changing its contextual meaning', async () => {
    const { plugin, draft } = setup();
    Object.assign(draft, structuredClone(content));
    const before = structuredClone(draft);
    vi.spyOn(Ollama.prototype, 'generalMeaning').mockResolvedValue(
      'A general definition. It applies across situations.',
    );
    await plugin.generateGeneralMeaning(draft);
    expect(draft.generalMeaning).toBe('A general definition. It applies across situations.');
    for (const key of ['meaning', 'explanation', 'context', 'answer', 'examples', 'notes'] as const)
      expect(draft[key]).toEqual(before[key]);
  });
  it('fills only word formation without changing existing learning fields', async () => {
    const { plugin, draft } = setup();
    Object.assign(draft, structuredClone(content), { generalMeaning: 'Existing general meaning.' });
    const before = structuredClone(draft);
    vi.spyOn(Ollama.prototype, 'wordFormation').mockResolvedValue('conceive — To form an idea.');
    await plugin.generateWordFormation(draft);
    expect(draft.wordFormation).toBe('conceive — To form an idea.');
    for (const key of [
      'generalMeaning',
      'meaning',
      'explanation',
      'context',
      'answer',
      'examples',
      'notes',
    ] as const)
      expect(draft[key]).toEqual(before[key]);
  });
  it('clears all drafts, cancels generation and immediately persists the empty list', async () => {
    const { plugin, draft } = setup();
    let signal!: AbortSignal;
    vi.spyOn(Ollama.prototype, 'generate').mockImplementation((_a, _b, s) => {
      signal = s;
      return new Promise((_resolve, reject) =>
        s.addEventListener('abort', () => reject(new Error('Cancelled.'))),
      );
    });
    const save = vi.spyOn(plugin, 'saveData');
    const add = vi.spyOn(Anki.prototype, 'add');
    const running = plugin.generate(draft);
    plugin.drafts.push({
      ...structuredClone(draft),
      id: crypto.randomUUID(),
      phase: 'saved',
      noteId: 99,
    });
    await plugin.clearDrafts();
    await running;
    expect(signal.aborted).toBe(true);
    expect(plugin.drafts).toEqual([]);
    expect(save.mock.calls.at(-1)![0]).toMatchObject({ drafts: [], settings: plugin.settings });
    expect(add).not.toHaveBeenCalled();
  });
  it('does not restore cleared drafts when an already approved Anki export finishes', async () => {
    const { plugin, draft } = setup(),
      work = deferred<number>();
    Object.assign(draft, structuredClone(content));
    const add = vi.spyOn(Anki.prototype, 'add').mockReturnValue(work.promise);
    const exportTask = plugin.approve(draft);
    await vi.waitFor(() => expect(add).toHaveBeenCalledOnce());
    await plugin.clearDrafts();
    work.resolve(42);
    await exportTask;
    expect(plugin.drafts).toEqual([]);
    expect(draft.noteId).toBe(42);
  });
  it('keeps the last four captures and cancels generation for the evicted draft', async () => {
    const { plugin, draft } = setup();
    let signal!: AbortSignal;
    vi.spyOn(Ollama.prototype, 'generate').mockImplementation((_target, _source, s) => {
      signal = s;
      return new Promise((_resolve, reject) =>
        s.addEventListener('abort', () => reject(new Error('Cancelled.'))),
      );
    });
    const running = plugin.generate(draft);
    vi.spyOn(plugin, 'generate').mockResolvedValue();
    vi.spyOn(plugin, 'openPanel').mockResolvedValue({ show: vi.fn() } as any);
    for (let i = 1; i <= 4; i++) {
      await plugin.capture({ ...draft.capture, file: `Book${i}.md` });
      if (i === 1) plugin.drafts.at(-1)!.phase = 'saved';
    }
    await running;
    expect(signal.aborted).toBe(true);
    expect(plugin.drafts.map((d) => d.capture.file)).toEqual([
      'Book1.md',
      'Book2.md',
      'Book3.md',
      'Book4.md',
    ]);
  });
  it('does not start a delayed generation for a capture already removed from the recent list', async () => {
    const { plugin, draft } = setup();
    plugin.drafts = [];
    vi.spyOn(plugin, 'openPanel').mockResolvedValue({ show: vi.fn() } as any);
    const generate = vi.spyOn(plugin, 'generate').mockResolvedValue();
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        plugin.capture({ ...draft.capture, file: `Book${i}.md` }),
      ),
    );
    expect(plugin.drafts).toHaveLength(4);
    expect(generate).toHaveBeenCalledTimes(4);
    expect(generate.mock.calls.every(([d]) => plugin.drafts.includes(d))).toBe(true);
  });
  it('preserves a newly selected answer when expanding its source context', () => {
    const { plugin } = setup();
    const text =
      'Earlier, she was at home. She packed a bag. She brushed off the warning. Then she left. Later, it rained. She came back at night.';
    const start = text.indexOf('brushed off');
    const d = createDraft(
      {
        text,
        start,
        end: start + 11,
        selected: 'brushed off',
        file: 'Book.md',
        book: 'Book',
        vault: 'Test',
        mode: 'editor',
      },
      plugin.settings,
    );
    d.answer = 'warning';
    d.answerStart = d.context.indexOf('warning');
    plugin.expandContext(d);
    expect(d.answer).toBe('warning');
    expect(d.context).toBe(text);
    expect(d.context.slice(d.answerStart, d.answerStart + 7)).toBe('warning');
  });
  it('does not replace a manually rewritten context when more source text is requested', () => {
    const { plugin, draft } = setup();
    draft.context = 'Yesterday, she brushed off the warning.';
    draft.answerStart = draft.context.indexOf(draft.answer);
    const edited = draft.context;
    plugin.expandContext(draft);
    expect(draft.context).toBe(edited);
  });
  it('returns to an existing book without reopening it or disturbing the reading position', async () => {
    const { plugin, draft } = setup(),
      file = { path: draft.capture.file };
    const existing = { view: { file }, openFile: vi.fn() },
      reveal = vi.fn();
    plugin.app = {
      vault: { getFileByPath: () => file },
      workspace: { getLeavesOfType: () => [existing], revealLeaf: reveal, getLeaf: vi.fn() },
    } as any;
    await plugin.openSource(draft);
    expect(reveal).toHaveBeenCalledWith(existing);
    expect(existing.openFile).not.toHaveBeenCalled();
  });
  it('never replaces edits made while a generation is running', async () => {
    const { plugin, draft } = setup(),
      work = deferred<{ content: Content; seconds: number }>();
    vi.spyOn(Ollama.prototype, 'generate').mockReturnValue(work.promise);
    const generation = plugin.generate(draft);
    draft.meaning = 'My carefully edited meaning';
    draft.revision++;
    work.resolve({ content, seconds: 2 });
    await generation;
    expect(draft.meaning).toBe('My carefully edited meaning');
    expect(draft.pendingContent).toEqual(content);
    expect(draft.phase).toBe('editing');
  });
  it('preserves the current version on regeneration even without further edits', async () => {
    const { plugin, draft } = setup();
    Object.assign(draft, content, { meaning: 'Existing version' });
    vi.spyOn(Ollama.prototype, 'generate').mockResolvedValue({ content, seconds: 2 });
    await plugin.generate(draft);
    expect(draft.meaning).toBe('Existing version');
    expect(draft.pendingContent).toEqual(content);
  });
  it('discards a response for an old source passage', async () => {
    const { plugin, draft } = setup(),
      work = deferred<{ content: Content; seconds: number }>();
    vi.spyOn(Ollama.prototype, 'generate').mockReturnValue(work.promise);
    const generation = plugin.generate(draft);
    draft.context = 'A completely different passage.';
    work.resolve({ content, seconds: 2 });
    await generation;
    expect(draft.meaning).toBe('');
    expect(draft.pendingContent).toBeUndefined();
    expect(draft.error).toContain('changed while generating');
  });
  it('cancels a request without discarding the draft', async () => {
    const { plugin, draft } = setup();
    vi.spyOn(Ollama.prototype, 'generate').mockImplementation(
      (_a, _b, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Cancelled.')));
        }),
    );
    const generation = plugin.generate(draft);
    plugin.cancel(draft);
    await generation;
    expect(draft.phase).toBe('editing');
    expect(draft.error).toBe('');
    expect(plugin.drafts).toContain(draft);
  });
  it('makes no Anki call during capture generation or before a complete draft is approved', async () => {
    const { plugin, draft } = setup();
    const add = vi.spyOn(Anki.prototype, 'add').mockResolvedValue(42);
    vi.spyOn(Ollama.prototype, 'generate').mockResolvedValue({ content, seconds: 2 });
    await plugin.approve(draft);
    expect(add).not.toHaveBeenCalled();
    await plugin.generate(draft);
    expect(add).not.toHaveBeenCalled();
    await plugin.approve(draft);
    expect(add).toHaveBeenCalledOnce();
    expect(draft.phase).toBe('saved');
    expect(draft.noteId).toBe(42);
  });
  it('guards a double click and serializes exports from different drafts', async () => {
    const { plugin, draft } = setup(),
      work = deferred<number>();
    Object.assign(draft, structuredClone(content));
    const second = { ...structuredClone(draft), id: crypto.randomUUID() } as Draft;
    plugin.drafts.push(second);
    const add = vi
      .spyOn(Anki.prototype, 'add')
      .mockReturnValueOnce(work.promise)
      .mockResolvedValueOnce(43);
    const first = plugin.approve(draft);
    await plugin.approve(draft);
    const other = plugin.approve(second);
    await vi.waitFor(() => expect(add).toHaveBeenCalledOnce());
    work.resolve(42);
    await Promise.all([first, other]);
    expect(add).toHaveBeenCalledTimes(2);
    expect(draft.noteId).toBe(42);
    expect(second.noteId).toBe(43);
  });
  it('retains the editable draft and exposes existing notes on duplicate detection', async () => {
    const { plugin, draft } = setup();
    Object.assign(draft, structuredClone(content));
    vi.spyOn(Anki.prototype, 'add').mockRejectedValue(new DuplicateError([99]));
    await plugin.approve(draft);
    expect(draft.phase).toBe('editing');
    expect(draft.meaning).toBe(content.meaning);
    expect(draft.duplicates).toEqual([99]);
  });
  it('requires a choice about a pending regeneration before export', async () => {
    const { plugin, draft } = setup();
    Object.assign(draft, structuredClone(content));
    draft.pendingContent = content;
    const add = vi.spyOn(Anki.prototype, 'add');
    await plugin.approve(draft);
    expect(add).not.toHaveBeenCalled();
  });
});
