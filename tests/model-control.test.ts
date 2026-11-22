// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ModelControl } from '../src/model-control';
import { DEFAULTS } from '../src/types';
import { installDomHelpers } from './dom';
import { deferred } from './vocabulary/fixtures';
beforeAll(installDomHelpers);
const controls: ModelControl[] = [];
afterEach(() => {
  for (const control of controls.splice(0)) control.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function setup() {
  const row = document.createElement('div');
  row.className = 'setting-item';
  row.innerHTML =
    '<div class="setting-item-name">Model</div><div class="setting-item-description"></div><div class="setting-item-control"></div>';
  document.body.append(row);
  const root = row.querySelector<HTMLElement>('.setting-item-control')!,
    description = row.querySelector<HTMLElement>('.setting-item-description')!;
  const settings = structuredClone(DEFAULTS),
    persist = vi.fn();
  const read = vi
    .fn<
      (snapshot: { model: string; ollamaUrl: string }, signal: AbortSignal) => Promise<string[]>
    >()
    .mockResolvedValue([settings.model, 'qwen3:14b-q4_K_M']);
  const control = new ModelControl(
    root,
    settings,
    persist,
    (text) => (description.textContent = text),
    read,
  );
  controls.push(control);
  const select = () => root.querySelector<HTMLSelectElement>('select')!;
  const button = () => root.querySelector<HTMLButtonElement>('.cc-select-button')!;
  const refresh = () =>
    root.querySelector<HTMLButtonElement>('[aria-label="Refresh installed models"]')!;
  const change = (value: string) => {
    select().value = value;
    select().dispatchEvent(new Event('change'));
  };
  return { root, settings, description, persist, read, control, select, button, refresh, change };
}
describe('installed Ollama model picker', () => {
  it('loads a themed list while preserving the current choice until the user changes it', async () => {
    const f = setup(),
      work = deferred<string[]>();
    f.read.mockReturnValueOnce(work.promise);
    const running = f.control.load();
    expect(f.button().disabled).toBe(true);
    expect(f.refresh().disabled).toBe(true);
    expect(f.button().textContent).toBe(f.settings.model);
    work.resolve([f.settings.model, 'qwen3:14b-q4_K_M']);
    await running;
    expect(f.button().disabled).toBe(false);
    expect(f.refresh().disabled).toBe(false);
    expect(f.persist).not.toHaveBeenCalled();
    f.change('qwen3:14b-q4_K_M');
    expect(f.settings.model).toBe('qwen3:14b-q4_K_M');
    expect(f.persist).toHaveBeenCalledOnce();
    f.change('not-installed');
    expect(f.persist).toHaveBeenCalledOnce();
  });
  it('refreshes after a model is installed without adding duplicate controls', async () => {
    const f = setup();
    await f.control.load();
    f.read.mockResolvedValue([f.settings.model, 'new:model']);
    f.refresh().click();
    await vi.waitFor(() => expect(f.select().options.length).toBe(2));
    expect(Array.from(f.select().options).map((o) => o.value)).toContain('new:model');
    expect(f.root.querySelectorAll('.cc-select-button')).toHaveLength(1);
    expect(f.root.querySelectorAll('[aria-label="Refresh installed models"]')).toHaveLength(1);
    expect(f.persist).not.toHaveBeenCalled();
  });
  it('keeps a missing current model as a disabled entry and never silently selects the first model', async () => {
    const f = setup(),
      previous = f.settings.model;
    f.read.mockResolvedValue(['other:model']);
    await f.control.load();
    expect(f.button().textContent).toContain(`${previous} · not installed`);
    expect(f.select().selectedOptions[0]?.disabled).toBe(true);
    expect(f.button().disabled).toBe(false);
    expect(f.settings.model).toBe(previous);
    expect(f.persist).not.toHaveBeenCalled();
    f.change('other:model');
    expect(f.settings.model).toBe('other:model');
    expect(f.description.textContent).not.toContain('not installed');
  });
  it('recognizes :latest aliases and whitespace from earlier manually entered settings', async () => {
    const f = setup();
    f.settings.model = ' qwen3 ';
    f.read.mockResolvedValue(['qwen3:latest']);
    await f.control.load();
    expect(f.button().textContent).toBe('qwen3:latest');
    expect(f.settings.model).toBe(' qwen3 ');
    expect(f.persist).not.toHaveBeenCalled();
  });
  it('offers an explicit choice when no model was previously configured', async () => {
    const f = setup();
    f.settings.model = '';
    await f.control.load();
    expect(f.button().textContent).toBe('Choose a model');
    expect(f.button().disabled).toBe(false);
    expect(f.settings.model).toBe('');
  });
  it('explains an empty installed list without clearing the saved name', async () => {
    const f = setup(),
      previous = f.settings.model;
    f.read.mockResolvedValue([]);
    await f.control.load();
    expect(f.button().disabled).toBe(true);
    expect(f.refresh().disabled).toBe(false);
    expect(f.description.textContent).toContain('No models installed');
    f.change(previous);
    expect(f.persist).not.toHaveBeenCalled();
    expect(f.settings.model).toBe(previous);
  });
  it('preserves a choice on connection failure and recovers with Refresh', async () => {
    const f = setup(),
      previous = f.settings.model;
    f.read.mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce('Unreachable');
    await f.control.load();
    expect(f.description.textContent).toContain('Offline');
    expect(f.button().textContent).toBe(previous);
    expect(f.button().disabled).toBe(true);
    expect(f.settings.model).toBe(previous);
    expect(f.persist).not.toHaveBeenCalled();
    await f.control.load();
    expect(f.description.textContent).toContain('Unreachable');
    await f.control.load();
    expect(f.button().disabled).toBe(false);
  });
  it('debounces server edits and discards a late response from the old server', async () => {
    vi.useFakeTimers();
    const f = setup(),
      old = deferred<string[]>();
    f.read.mockReturnValueOnce(old.promise);
    const first = f.control.load();
    f.settings.ollamaUrl = 'http://new-server:11434';
    f.control.schedule();
    f.control.schedule();
    expect(f.read.mock.calls[0]?.[1].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(349);
    expect(f.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.read.mock.calls[1]?.[0].ollamaUrl).toBe('http://new-server:11434');
    old.resolve(['wrong:model']);
    await first;
    expect(Array.from(f.select().options).map((o) => o.value)).not.toContain('wrong:model');
  });
  it('ignores late failures and preserves focus outside this setting', async () => {
    const f = setup(),
      old = deferred<string[]>();
    f.read.mockReturnValueOnce(old.promise);
    const first = f.control.load();
    const other = document.createElement('input');
    document.body.append(other);
    other.focus();
    await f.control.load();
    old.reject(new Error('Old failure'));
    await first;
    expect(f.description.textContent).not.toContain('Old failure');
    expect(document.activeElement).toBe(other);
  });
  it('cancels pending work when settings close and does not schedule work after disposal', async () => {
    vi.useFakeTimers();
    const f = setup(),
      work = deferred<string[]>();
    f.read.mockReturnValueOnce(work.promise);
    const running = f.control.load();
    f.control.schedule();
    f.control.destroy();
    work.resolve(['late:model']);
    await running;
    await vi.runAllTimersAsync();
    await f.control.load();
    f.control.schedule();
    await vi.runAllTimersAsync();
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.root.textContent).not.toContain('late:model');
  });
});
