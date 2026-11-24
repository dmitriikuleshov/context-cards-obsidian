import { afterEach, describe, expect, it, vi } from 'vitest';
import { Anki } from '../../src/anki';
import { Ollama } from '../../src/ollama';
import { content, capture, deferred, draft, pluginFixture } from './fixtures';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('vocabulary controller guards and failures', () => {
  it('retains the previous export error through retries and clears it only after success', async () => {
    const { plugin, d } = pluginFixture();
    const previous = 'Cannot connect to 127.0.0.1:8765. Start the local server and try again.';
    d.error = previous;
    const failed = deferred<number>();
    const add = vi
      .spyOn(Anki.prototype, 'add')
      .mockReturnValueOnce(failed.promise)
      .mockResolvedValueOnce(42);
    const first = plugin.approve(d);
    expect(d.phase).toBe('sending');
    expect(d.error).toBe(previous);
    await plugin.approve(d);
    await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    failed.reject(new Error(previous));
    await first;
    expect(d.phase).toBe('editing');
    expect(d.error).toBe(previous);
    await plugin.approve(d);
    expect(add).toHaveBeenCalledTimes(2);
    expect(d.phase).toBe('saved');
    expect(d.error).toBe('');
  });
  it.each([6001, 12000])(
    'generates a vocabulary draft with %i context characters',
    async (length) => {
      const { plugin, d } = pluginFixture();
      d.context = 'word' + 'x'.repeat(length - 4);
      d.answer = 'word';
      d.answerStart = 0;
      const api = vi
        .spyOn(Ollama.prototype, 'generate')
        .mockResolvedValue({ content: content(), seconds: 1 });
      await plugin.generate(d);
      expect(api).toHaveBeenCalledWith('word', d.context, expect.any(AbortSignal));
      expect(d.phase).toBe('editing');
      expect(d.error).toBe('');
    },
  );
  it('expands vocabulary context beyond 6000 up to 12000 without losing the answer', () => {
    const { plugin, d } = pluginFixture();
    d.capture.text = 'x'.repeat(8000) + 'word' + 'x'.repeat(8000);
    d.capture.start = 8000;
    d.capture.end = 8004;
    d.context = d.capture.text.slice(4000, 12000);
    d.answer = 'word';
    d.answerStart = 4000;
    plugin.expandContext(d);
    expect(d.context).toHaveLength(12000);
    expect(d.context.slice(d.answerStart, d.answerStart + d.answer.length)).toBe('word');
    const before = d.context;
    plugin.expandContext(d);
    expect(d.context).toBe(before);
  });
  for (const method of ['generate', 'generateGeneralMeaning', 'generateWordFormation'] as const) {
    for (const phase of ['sending', 'saved'] as const)
      it(`${method} leaves ${phase} drafts intact`, async () => {
        const { plugin, d, refresh } = pluginFixture();
        d.phase = phase;
        const before = structuredClone(d);
        await plugin[method](d);
        expect(d).toEqual(before);
        expect(refresh).not.toHaveBeenCalled();
      });
    it(`${method} rejects concurrent generation on the same draft`, async () => {
      const { plugin, d } = pluginFixture(),
        work = deferred<any>();
      const api = vi
        .spyOn(
          Ollama.prototype,
          method === 'generate'
            ? 'generate'
            : method === 'generateGeneralMeaning'
              ? 'generalMeaning'
              : 'wordFormation',
        )
        .mockReturnValue(work.promise);
      const running = plugin[method](d);
      await plugin[method](d);
      expect(api).toHaveBeenCalledOnce();
      work.resolve(method === 'generate' ? { content: content(), seconds: 1 } : 'A definition.');
      await running;
      expect(d.phase).toBe('editing');
    });
    for (const error of [new Error('Offline'), 'Unavailable'])
      it(`${method} preserves draft content after ${String(error)}`, async () => {
        const { plugin, d, persist } = pluginFixture(),
          before = structuredClone(d);
        vi.spyOn(
          Ollama.prototype,
          method === 'generate'
            ? 'generate'
            : method === 'generateGeneralMeaning'
              ? 'generalMeaning'
              : 'wordFormation',
        ).mockRejectedValue(error);
        await plugin[method](d);
        expect(d.meaning).toBe(before.meaning);
        expect(d.error).toMatch(/Offline|Unavailable/);
        expect(d.phase).toBe('editing');
        expect(persist).toHaveBeenCalled();
      });
  }
  it('refuses an invalid answer and an oversized context before calling the model', async () => {
    const { plugin, d } = pluginFixture();
    const api = vi.spyOn(Ollama.prototype, 'generate');
    d.answerStart = -1;
    await plugin.generate(d);
    d.answerStart = 4;
    d.context += 'x'.repeat(12001);
    await plugin.generate(d);
    expect(api).not.toHaveBeenCalled();
  });
  for (const [method, api, field] of [
    ['generateGeneralMeaning', 'generalMeaning', 'generalMeaning'],
    ['generateWordFormation', 'wordFormation', 'wordFormation'],
  ] as const) {
    it(`${method} treats a rejected canceled request as cancellation rather than a draft error`, async () => {
      const { plugin, d } = pluginFixture(),
        work = deferred<string>();
      vi.spyOn(Ollama.prototype, api).mockReturnValue(work.promise);
      const task = plugin[method](d);
      plugin.cancel(d);
      work.reject(new Error('Aborted'));
      await task;
      expect(d.error).toBe('');
      expect(d.phase).toBe('editing');
    });
    it(`${method} does nothing for an empty entry`, async () => {
      const { plugin, d } = pluginFixture();
      d.expression = '  ';
      const call = vi.spyOn(Ollama.prototype, api);
      await plugin[method](d);
      expect(call).not.toHaveBeenCalled();
    });
    for (const changed of ['expression', 'partOfSpeech', field] as const)
      it(`${method} keeps changes to ${changed} made while waiting`, async () => {
        const { plugin, d } = pluginFixture(),
          work = deferred<string>();
        vi.spyOn(Ollama.prototype, api).mockReturnValue(work.promise);
        const running = plugin[method](d);
        d[changed] = 'Manual edit';
        work.resolve('Model output');
        await running;
        expect(d[changed]).toBe('Manual edit');
        expect(d[field]).not.toBe('Model output');
        expect(d.error).toContain('edits have been kept');
      });
    for (const stop of ['cancel', 'unload'] as const)
      it(`${method} ignores late success after ${stop}`, async () => {
        const { plugin, d } = pluginFixture(),
          before = d[field],
          work = deferred<string>();
        vi.spyOn(Ollama.prototype, api).mockReturnValue(work.promise);
        const running = plugin[method](d);
        if (stop === 'cancel') plugin.cancel(d);
        else plugin.onunload();
        work.resolve('Late output');
        await running;
        expect(d[field]).toBe(before);
      });
  }
  it('uses the original entry if the model cannot identify the word', async () => {
    const { plugin, d } = pluginFixture();
    d.meaning = '';
    d.explanation = '';
    d.generalMeaning = '';
    vi.spyOn(Ollama.prototype, 'generate').mockResolvedValue({
      content: content({ status: 'unknown', expression: '' }),
      seconds: 2,
    });
    await plugin.generate(d);
    expect(d.expression).toBe('brush off');
    expect(d.status).toBe('unknown');
  });
  it('ignores late complete content after unloading', async () => {
    const { plugin, d } = pluginFixture(),
      work = deferred<any>();
    const before = structuredClone(d);
    vi.spyOn(Ollama.prototype, 'generate').mockReturnValue(work.promise);
    const running = plugin.generate(d);
    plugin.onunload();
    work.resolve({ content: content({ meaning: 'late' }), seconds: 1 });
    await running;
    expect(d.meaning).toBe(before.meaning);
  });
});
describe('vocabulary persistence and export', () => {
  it('keeps the exporting draft visible when clear is requested and allows clearing afterwards', async () => {
    const { plugin, d, flush } = pluginFixture(),
      work = deferred<number>();
    const add = vi.spyOn(Anki.prototype, 'add').mockReturnValue(work.promise);
    const sending = plugin.approve(d);
    await vi.waitFor(() => expect(add).toHaveBeenCalledOnce());
    await plugin.clearDrafts();
    expect(plugin.drafts).toEqual([d]);
    expect(d.phase).toBe('sending');
    work.resolve(42);
    await sending;
    expect(plugin.drafts[0]?.noteId).toBe(42);
    await plugin.clearDrafts();
    expect(plugin.drafts).toEqual([]);
    expect(flush).toHaveBeenCalledTimes(3);
  });
  it('allows another export after an earlier queued export failed', async () => {
    const { plugin, d } = pluginFixture(),
      next = draft();
    plugin.drafts.push(next);
    const add = vi
      .spyOn(Anki.prototype, 'add')
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(43);
    await plugin.approve(d);
    await plugin.approve(next);
    expect(d.phase).toBe('editing');
    expect(d.error).toBe('Offline');
    expect(next.noteId).toBe(43);
    expect(add).toHaveBeenCalledTimes(2);
  });
  it('refuses export when saving the retry key fails', async () => {
    const { plugin, d, flush } = pluginFixture();
    flush.mockRejectedValue(new Error('Disk full'));
    const add = vi.spyOn(Anki.prototype, 'add');
    await plugin.approve(d);
    expect(add).not.toHaveBeenCalled();
    expect(d.phase).toBe('editing');
    expect(d.error).toBe('Disk full');
  });
  it('does not send a saved note again when the final persistence fails', async () => {
    const { plugin, d, flush } = pluginFixture();
    flush.mockResolvedValueOnce().mockRejectedValueOnce('Disk error');
    const add = vi.spyOn(Anki.prototype, 'add').mockResolvedValue(42);
    await plugin.approve(d);
    await plugin.approve(d);
    expect(add).toHaveBeenCalledOnce();
    expect(d.phase).toBe('saved');
    expect(d.noteId).toBe(42);
    expect(d.error).toBe('Disk error');
  });
  it('exports a snapshot while retaining later edits in the local draft', async () => {
    const { plugin, d, flush } = pluginFixture(),
      work = deferred<void>();
    flush.mockReturnValueOnce(work.promise);
    const before = structuredClone(d),
      add = vi.spyOn(Anki.prototype, 'add').mockResolvedValue(42);
    const task = plugin.approve(d);
    d.meaning = 'Later';
    plugin.settings.model = 'Changed';
    work.resolve();
    await task;
    expect(add.mock.calls[0]![0].meaning).toBe(before.meaning);
    expect(d.meaning).toBe('Later');
  });
  it('finishes an approved export after unload without changing book defaults', async () => {
    const { plugin, d } = pluginFixture(),
      work = deferred<number>();
    const add = vi.spyOn(Anki.prototype, 'add').mockReturnValue(work.promise);
    const task = plugin.approve(d);
    await vi.waitFor(() => expect(add).toHaveBeenCalled());
    plugin.onunload();
    work.resolve(42);
    await task;
    expect(d.phase).toBe('saved');
    expect(plugin.settings.bookDecks).toEqual({});
  });
  it('serializes immutable disk snapshots and recovers after a rejected save', async () => {
    const { plugin, d, flush } = pluginFixture();
    flush.mockRestore();
    const work = deferred<void>();
    const save = vi
      .spyOn(plugin, 'saveData')
      .mockReturnValueOnce(work.promise)
      .mockResolvedValueOnce();
    const first = plugin.flush();
    d.meaning = 'Second';
    const second = plugin.flush();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect((save.mock.calls[0]![0] as any).drafts[0].meaning).not.toBe('Second');
    const failed = expect(first).rejects.toThrow('Disk');
    work.reject(new Error('Disk'));
    await failed;
    await second;
    expect((save.mock.calls[1]![0] as any).drafts[0].meaning).toBe('Second');
  });
  it('does not persist either mode drafts when restoration is off', async () => {
    const { plugin, flush } = pluginFixture();
    flush.mockRestore();
    plugin.settings.restoreDrafts = false;
    const save = vi.spyOn(plugin, 'saveData');
    await plugin.flush();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ drafts: [], writingSessions: [] }));
  });
  it('debounces writes, reports failures and stops scheduling after unload', async () => {
    vi.useFakeTimers();
    const { plugin, persist, flush } = pluginFixture();
    persist.mockRestore();
    flush.mockRejectedValue(new Error('Disk'));
    plugin.persist();
    plugin.persist();
    await vi.advanceTimersByTimeAsync(249);
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledOnce();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    plugin.onunload();
    await Promise.resolve();
    expect(log).toHaveBeenCalled();
    plugin.persist();
    await vi.advanceTimersByTimeAsync(1000);
    expect(flush).toHaveBeenCalledTimes(2);
  });
  it('reports clear failures while leaving the local list empty', async () => {
    const { plugin, flush } = pluginFixture();
    flush.mockRejectedValue('Disk');
    await plugin.clearDrafts();
    expect(plugin.drafts).toEqual([]);
  });
  it('protects a sending draft from individual discard', () => {
    const { plugin, d } = pluginFixture();
    d.phase = 'sending';
    plugin.discard(d);
    expect(plugin.drafts).toContain(d);
    d.phase = 'editing';
    plugin.discard(d);
    expect(plugin.drafts).toEqual([]);
  });
});
describe('vocabulary navigation and source capture', () => {
  it('evicts an idle draft instead of losing the oldest in-flight Anki export', async () => {
    const { plugin, d } = pluginFixture();
    d.phase = 'sending';
    const idle = draft(),
      other = [draft({ phase: 'sending' }), draft({ phase: 'sending' })];
    plugin.drafts = [d, idle, ...other];
    vi.spyOn(plugin, 'openPanel').mockResolvedValue({ show: vi.fn() } as any);
    vi.spyOn(plugin, 'generate').mockResolvedValue();
    const cancel = vi.spyOn(plugin, 'cancel');
    await plugin.capture(capture({ file: 'New.md' }));
    expect(plugin.drafts).toHaveLength(4);
    expect(plugin.drafts).toContain(d);
    expect(plugin.drafts).not.toContain(idle);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(idle);
    expect(plugin.drafts.at(-1)?.capture.file).toBe('New.md');
  });
  it('refuses a fifth capture before touching source text when every draft is exporting', async () => {
    const { plugin, workspace, vault } = pluginFixture();
    plugin.drafts = Array.from({ length: 4 }, () => draft({ phase: 'sending' }));
    plugin.settings.markSourceWord = true;
    workspace.getActiveViewOfType.mockReturnValue({
      file: { path: 'New.md' },
      getMode: () => 'preview',
    });
    const open = vi.spyOn(plugin, 'openPanel');
    await plugin.capture(capture({ file: 'New.md' }));
    expect(plugin.drafts).toHaveLength(4);
    expect(vault.process).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it('rechecks capacity after asynchronous source marking and preserves active exports', async () => {
    const { plugin, d, workspace, vault } = pluginFixture(),
      work = deferred<void>();
    plugin.settings.markSourceWord = true;
    workspace.getActiveViewOfType.mockReturnValue({
      file: { path: 'New.md' },
      getMode: () => 'preview',
    });
    vault.process.mockReturnValue(work.promise);
    const open = vi.spyOn(plugin, 'openPanel');
    const capturing = plugin.capture(capture({ file: 'New.md' }));
    plugin.drafts = [d, draft(), draft(), draft()];
    for (const item of plugin.drafts) item.phase = 'sending';
    work.resolve();
    await capturing;
    expect(plugin.drafts).toHaveLength(4);
    expect(plugin.drafts.every((item) => item.phase === 'sending')).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });
  it('can reopen an existing draft even when all four exports are active', async () => {
    const { plugin, d } = pluginFixture();
    plugin.drafts = [d, draft(), draft(), draft()];
    for (const item of plugin.drafts) item.phase = 'sending';
    const show = vi.fn();
    vi.spyOn(plugin, 'openPanel').mockResolvedValue({ show } as any);
    await plugin.capture(d.capture);
    expect(show).toHaveBeenCalledExactlyOnceWith(d);
    expect(plugin.drafts).toHaveLength(4);
  });
  it('expands a unique matching excerpt even when the original selection was outside it', () => {
    const { plugin, d } = pluginFixture();
    d.capture.text = 'First. A word. Later.';
    d.capture.start = 0;
    d.capture.end = 5;
    d.context = 'A word.';
    d.answer = 'word';
    d.answerStart = 2;
    plugin.expandContext(d);
    expect(d.context).toBe('First. A word. Later.');
    expect(d.answerStart).toBe(9);
  });
  it('refuses expansion when the answer selection is no longer valid', () => {
    const { plugin, d, persist } = pluginFixture();
    d.answerStart = -1;
    plugin.expandContext(d);
    expect(persist).not.toHaveBeenCalled();
  });
  it.each(['', 'x'.repeat(241)])('refuses invalid selection %s', async (selected) => {
    const { plugin } = pluginFixture();
    const open = vi.spyOn(plugin, 'openPanel');
    await plugin.capture(capture({ selected, start: 0, end: selected.length, text: selected }));
    expect(open).not.toHaveBeenCalled();
  });
  it('does not capture after unloading', async () => {
    const { plugin } = pluginFixture();
    plugin.onunload();
    const open = vi.spyOn(plugin, 'openPanel');
    await plugin.capture(capture());
    expect(open).not.toHaveBeenCalled();
  });
  it('opens a new source tab only when no source pane already exists', async () => {
    const { plugin, d, workspace, vault, file } = pluginFixture(),
      leaf = { openFile: vi.fn().mockResolvedValue(undefined) };
    workspace.getLeaf.mockReturnValue(leaf);
    await plugin.openSource(d);
    expect(leaf.openFile).toHaveBeenCalledWith(file);
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    vault.getFileByPath.mockReturnValue(null);
    await plugin.openSource(d);
    expect(leaf.openFile).toHaveBeenCalledOnce();
  });
  it('refreshes only vocabulary panes and does not render after unload', () => {
    const { plugin, workspace, refresh } = pluginFixture();
    refresh.mockRestore();
    const render = vi.fn();
    workspace.getLeavesOfType.mockReturnValue([{ view: { render } }]);
    plugin.refresh();
    plugin.refreshWriting();
    expect(render).toHaveBeenCalledTimes(2);
    plugin.onunload();
    plugin.refresh();
    plugin.refreshWriting();
    expect(render).toHaveBeenCalledTimes(2);
  });
  it('supports settings navigation when available and when absent', () => {
    const { plugin, app } = pluginFixture();
    plugin.openSettings();
    expect(app.setting.openTabById).toHaveBeenCalledWith('context-cards');
    delete app.setting;
    expect(() => plugin.openSettings()).not.toThrow();
  });
  it('opens Anki and handles both string and Error failures', async () => {
    const { plugin } = pluginFixture();
    const open = vi
      .spyOn(Anki.prototype, 'open')
      .mockResolvedValueOnce()
      .mockRejectedValueOnce('Offline')
      .mockRejectedValueOnce(new Error('Closed'));
    await plugin.openAnki([42]);
    await plugin.openAnki([42]);
    await plugin.openAnki([42]);
    expect(open).toHaveBeenCalledTimes(3);
  });
  it('keeps the cached deck list if refreshing fails', async () => {
    const { plugin } = pluginFixture();
    const decks = vi
      .spyOn(Anki.prototype, 'decks')
      .mockResolvedValueOnce(['English'])
      .mockRejectedValueOnce('Offline')
      .mockRejectedValueOnce(new Error('Closed'));
    await plugin.refreshDecks();
    await plugin.refreshDecks();
    await plugin.refreshDecks();
    expect(plugin.deckNames).toEqual(['English']);
    expect(decks).toHaveBeenCalledTimes(3);
  });
  for (const model of ['installed', 'missing', 'offline'])
    for (const anki of ['online', 'offline'])
      it(`checks connections independently: model ${model}, Anki ${anki}`, async () => {
        const { plugin } = pluginFixture();
        plugin.deckNames = ['Cached'];
        const models = vi.spyOn(Ollama.prototype, 'models');
        if (model === 'offline') models.mockRejectedValue('Offline');
        else models.mockResolvedValue(model === 'installed' ? [plugin.settings.model] : []);
        const decks = vi.spyOn(Anki.prototype, 'decks');
        if (anki === 'online') decks.mockResolvedValue(['New']);
        else decks.mockRejectedValue('Closed');
        await plugin.checkConnections();
        expect(plugin.deckNames).toEqual(anki === 'online' ? ['New'] : ['Cached']);
      });
  it.each(['saved', 'sending'] as const)('does not expand a %s context', (phase) => {
    const { plugin, d, persist } = pluginFixture();
    d.phase = phase;
    plugin.expandContext(d);
    expect(persist).not.toHaveBeenCalled();
  });
  it('does not change a context already containing all available text', () => {
    const { plugin, d, persist } = pluginFixture();
    plugin.expandContext(d);
    expect(persist).not.toHaveBeenCalled();
  });
});
