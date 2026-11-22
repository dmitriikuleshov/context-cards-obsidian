// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installDomHelpers } from '../dom';
import { TargetPicker } from '../../src/target-picker';
import { ReviewView } from '../../src/view';
import { capture, pluginFixture } from './fixtures';
beforeAll(installDomHelpers);
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const stop of cleanups.splice(0)) stop();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
function setup(selected = 'This is a passage. It contains a word worth learning.') {
  const c = capture({ text: selected, selected, start: 0, end: selected.length }),
    complete = vi.fn(),
    picker = new TargetPicker({} as any, c, complete);
  picker.open();
  cleanups.push(() => picker.close());
  const text = picker.contentEl.querySelector('textarea')!,
    buttons = [...picker.contentEl.querySelectorAll('button')];
  const button = (label: string) => buttons.find((b) => b.textContent === label)!;
  const choose = (value: string) => {
    const start = text.value.lastIndexOf(value);
    text.setSelectionRange(start, start + value.length);
    text.dispatchEvent(new Event('select'));
  };
  return { c, complete, picker, text, button, choose };
}
describe('target picker accessibility and actions', () => {
  it('makes the text read-only and enables creation only after a valid selection', () => {
    const f = setup();
    expect(f.text.getAttribute('aria-readonly')).toBe('true');
    const input = new Event('beforeinput', { cancelable: true });
    f.text.dispatchEvent(input);
    expect(input.defaultPrevented).toBe(true);
    f.text.value = 'Changed';
    f.text.dispatchEvent(new Event('input'));
    expect(f.text.value).toBe(f.c.selected);
    expect(f.button('Create cards').disabled).toBe(true);
    f.choose('word');
    expect(f.button('Create cards').disabled).toBe(false);
    expect(f.picker.contentEl.querySelector('[role=status]')!.textContent).toBe('word');
    f.button('Create cards').click();
    expect(f.complete).toHaveBeenCalledOnce();
    expect(f.complete.mock.calls[0]![0].selected).toBe('word');
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });
  it('allows a complete long idiom and resolves the modal exactly once', () => {
    const f = setup('You cannot have your cake and eat it too');
    f.button('Use whole phrase').click();
    f.picker.close();
    expect(f.complete).toHaveBeenCalledOnce();
    expect(f.complete).toHaveBeenCalledWith(f.c);
  });
  it('does not offer to put a whole paragraph longer than the target bound on a card', () => {
    const f = setup('word '.repeat(100));
    expect(f.button('Use whole phrase')).toBeUndefined();
    f.text.setSelectionRange(0, f.text.value.length);
    f.text.dispatchEvent(new Event('select'));
    expect(f.button('Create cards').disabled).toBe(true);
    expect(f.picker.contentEl.querySelector('[role=status]')!.textContent).toContain('shorter');
    f.choose('word');
    f.button('Create cards').click();
    expect(f.complete.mock.calls[0]![0].selected).toBe('word');
  });
  it('cancels without choosing a target and clears the dialog', () => {
    const f = setup();
    f.button('Cancel').click();
    expect(f.complete).toHaveBeenCalledOnce();
    expect(f.complete).toHaveBeenCalledWith(null);
  });
  it('supports selection changes by keyboard and Escape cancellation', () => {
    const f = setup();
    f.text.setSelectionRange(0, 4);
    f.text.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
    expect(f.button('Create cards').disabled).toBe(false);
    f.text.setSelectionRange(0, 0);
    f.text.dispatchEvent(new MouseEvent('mouseup'));
    expect(f.button('Create cards').disabled).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(f.complete).toHaveBeenCalledWith(null);
  });
});
describe('plugin picker lifecycle and safe source marking', () => {
  it('cancels the previous choice when another opens and closes on clear or unload', async () => {
    const { plugin } = pluginFixture();
    const first = plugin.chooseTarget(capture()),
      second = plugin.chooseTarget(capture());
    expect(await first).toBeNull();
    await plugin.clearDrafts();
    expect(await second).toBeNull();
    const third = plugin.chooseTarget(capture());
    plugin.onunload();
    expect(await third).toBeNull();
  });
  it('marks only the confirmed word, even though the editor selection still spans the paragraph', async () => {
    const f = pluginFixture(),
      selected = 'First sentence. This is a long passage with a good word.',
      start = selected.indexOf('good'),
      c = capture({ text: selected, selected, start: 0, end: selected.length });
    f.plugin.drafts = [];
    f.plugin.settings.markSourceWord = true;
    vi.spyOn(f.plugin, 'chooseTarget').mockResolvedValue({
      ...c,
      selected: 'good',
      start,
      end: start + 4,
    });
    vi.spyOn(f.plugin, 'openPanel').mockResolvedValue({ show: vi.fn() } as any);
    vi.spyOn(f.plugin, 'generate').mockResolvedValue();
    const replaceRange = vi.fn();
    f.workspace.getActiveViewOfType.mockReturnValue({
      file: f.file,
      getMode: () => 'source',
      editor: {
        getValue: () => selected,
        getSelection: () => selected,
        getCursor: () => ({ offset: 0 }),
        posToOffset: (pos: any) => pos.offset,
        offsetToPos: (offset: number) => ({ offset }),
        replaceRange,
      },
    });
    await f.plugin.capture(c);
    expect(replaceRange).toHaveBeenCalledWith('`good`', { offset: start }, { offset: start + 4 });
    expect(f.plugin.drafts[0]!.answer).toBe('good');
  });
  it('exposes recovery for an old passage draft and disables export until its target is verified', () => {
    const { plugin, d } = pluginFixture();
    d.answer = 'This is a full sentence. Another one follows.';
    d.context = d.answer;
    d.answerStart = 0;
    const refine = vi.spyOn(plugin, 'refineTarget').mockResolvedValue();
    const view = new ReviewView({} as any, plugin);
    view.show(d);
    document.body.append(view.contentEl);
    const buttons = [...view.contentEl.querySelectorAll('button')],
      choose = buttons.find((b) => b.textContent === 'Choose word or phrase')!;
    expect(choose).toBeDefined();
    expect(buttons.find((b) => b.textContent === 'Add to Anki')!.disabled).toBe(true);
    choose.click();
    expect(refine).toHaveBeenCalledWith(d);
    d.targetValidated = d.answer;
    view.render();
    expect(
      [...view.contentEl.querySelectorAll('button')].some(
        (b) => b.textContent === 'Choose word or phrase',
      ),
    ).toBe(false);
  });
});
