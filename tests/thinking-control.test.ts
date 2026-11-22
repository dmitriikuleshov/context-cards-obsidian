// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ThinkingControl } from '../src/thinking-control';
import { DEFAULTS } from '../src/types';
import type { ThinkingSupport } from '../src/thinking-options';
import { installDomHelpers } from './dom';
import { deferred } from './vocabulary/fixtures';
beforeAll(installDomHelpers);
const controls: ThinkingControl[] = [];
afterEach(() => {
  for (const control of controls.splice(0)) control.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const toggle: ThinkingSupport = { known: true, values: [false, true], default: true };
function setup() {
  const row = document.createElement('div');
  row.className = 'setting-item';
  const name = row.createDiv({ cls: 'setting-item-name', text: 'Thinking' });
  const description = row.createDiv({ cls: 'setting-item-description' });
  const root = row.createDiv({ cls: 'setting-item-control' });
  document.body.append(row);
  const settings = structuredClone(DEFAULTS),
    persist = vi.fn(),
    modeChanged = vi.fn();
  const read = vi
    .fn<
      (
        settings: { model: string; ollamaUrl: string },
        signal: AbortSignal,
        force: boolean,
      ) => Promise<ThinkingSupport>
    >()
    .mockResolvedValue(toggle);
  const control = new ThinkingControl(
    root,
    settings,
    persist,
    (text) => (description.textContent = text),
    read,
    modeChanged,
  );
  controls.push(control);
  const select = () => root.querySelector<HTMLSelectElement>('select')!;
  const button = () => root.querySelector<HTMLButtonElement>('.cc-select-button')!;
  const change = (value: string) => {
    select().value = value;
    select().dispatchEvent(new Event('change'));
  };
  return {
    row,
    name,
    description,
    root,
    settings,
    persist,
    read,
    control,
    select,
    button,
    change,
    modeChanged,
  };
}
describe('adaptive Thinking setting', () => {
  it('shows loading, then a single themed control and persists the selected option', async () => {
    const f = setup(),
      work = deferred<ThinkingSupport>();
    f.read.mockReturnValueOnce(work.promise);
    const running = f.control.load();
    expect(f.root.querySelector('button')?.disabled).toBe(true);
    work.resolve(toggle);
    await running;
    expect(f.root.querySelectorAll('.cc-select-button')).toHaveLength(1);
    expect(f.button().textContent).toBe('Off');
    expect(f.modeChanged).toHaveBeenLastCalledWith(false);
    f.change('on');
    expect(f.settings.thinking).toBe('on');
    expect(f.modeChanged).toHaveBeenLastCalledWith(true);
    expect(f.persist).toHaveBeenCalledOnce();
    f.change('unavailable');
    expect(f.persist).toHaveBeenCalledOnce();
    await f.control.load(true);
    expect(f.read.mock.calls[1]?.[2]).toBe(true);
    expect(f.button().textContent).toBe('On');
    expect(f.root.querySelectorAll('.cc-select-button')).toHaveLength(1);
  });
  it('offers levels with no Off for levels-only models and chooses Model default', async () => {
    const f = setup();
    f.read.mockResolvedValue({ known: true, values: ['low', 'medium', 'high'], default: 'medium' });
    await f.control.load();
    expect(Array.from(f.select().options).map((o) => o.text)).toEqual([
      'Low',
      'Medium',
      'High',
      'Model default',
    ]);
    expect(f.settings.thinking).toBe('default');
    f.change('level:high');
    expect(f.settings.thinking).toBe('level:high');
  });
  it('disables unsupported or unknown controls without guessing support', async () => {
    const f = setup();
    f.settings.thinking = 'on';
    f.read
      .mockResolvedValueOnce({ known: true, values: [false], default: false })
      .mockResolvedValueOnce({ known: false, values: [] });
    await f.control.load();
    expect(f.settings.thinking).toBe('off');
    expect(f.button().disabled).toBe(true);
    expect(f.button().textContent).toBe('Not supported');
    f.change('on');
    expect(f.settings.thinking).toBe('off');
    await f.control.load(true);
    expect(f.settings.thinking).toBe('default');
    expect(f.button().disabled).toBe(true);
    expect(f.description.textContent).toContain('Support unknown');
  });
  it('preserves the saved preference on a temporary connection failure and can retry', async () => {
    const f = setup();
    f.settings.thinking = 'on';
    f.read.mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce('Unreachable');
    await f.control.load();
    expect(f.settings.thinking).toBe('on');
    expect(f.persist).not.toHaveBeenCalled();
    expect(f.button().disabled).toBe(true);
    expect(f.description.textContent).toContain('Offline');
    expect(f.button().textContent).toBe('Unavailable');
    await f.control.load(true);
    expect(f.description.textContent).toContain('Unreachable');
    await f.control.load(true);
    expect(f.button().disabled).toBe(false);
    expect(f.button().textContent).toBe('On');
  });
  it('debounces model edits, aborts the old lookup and ignores its late result', async () => {
    vi.useFakeTimers();
    const f = setup(),
      old = deferred<ThinkingSupport>();
    f.read.mockReturnValueOnce(old.promise);
    const first = f.control.load();
    f.settings.model = 'new:model';
    f.control.schedule();
    expect(f.read.mock.calls[0]?.[1].aborted).toBe(true);
    f.control.schedule();
    await vi.advanceTimersByTimeAsync(349);
    expect(f.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.read.mock.calls[1]?.[0].model).toBe('new:model');
    old.resolve({ known: true, values: [false] });
    await first;
    expect(f.button().disabled).toBe(false);
    expect(f.button().textContent).toBe('Off');
  });
  it('ignores late failures from the previous model and preserves other settings focus', async () => {
    const f = setup(),
      old = deferred<ThinkingSupport>();
    f.read.mockReturnValueOnce(old.promise);
    const first = f.control.load();
    const other = document.createElement('input');
    document.body.append(other);
    other.value = 'Still typing';
    other.focus();
    await f.control.load(true);
    old.reject(new Error('Old model failed'));
    await first;
    expect(f.description.textContent).not.toContain('Old model');
    expect(document.activeElement).toBe(other);
    expect(other.value).toBe('Still typing');
  });
  it('cancels lookups and scheduled checks when settings close', async () => {
    vi.useFakeTimers();
    const f = setup(),
      work = deferred<ThinkingSupport>();
    f.read.mockReturnValueOnce(work.promise);
    const running = f.control.load();
    f.control.schedule();
    f.control.destroy();
    work.resolve(toggle);
    await running;
    await vi.runAllTimersAsync();
    await f.control.load();
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.root.querySelector('select')).toBeNull();
  });
});
