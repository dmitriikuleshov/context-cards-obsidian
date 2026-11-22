// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownView } from 'obsidian';
import * as captures from '../../src/capture';
import { VIEW_TYPE } from '../../src/view';
import { WRITING_VIEW } from '../../src/writing-view';
import { capture, deferred, pluginFixture } from './fixtures';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});
async function setup() {
  const f = pluginFixture(),
    events = new Map<string, (...args: any[]) => any>();
  const view = Object.assign(new MarkdownView({} as any), {
    file: f.file,
    contentEl: document.createElement('div'),
  });
  document.body.append(view.contentEl);
  f.workspace.getActiveViewOfType.mockReturnValue(view);
  f.workspace.on.mockImplementation((name: string, cb: any) => {
    events.set(name, cb);
    return {};
  });
  const read = vi.spyOn(captures, 'readCapture').mockReturnValue(capture());
  const active = vi.spyOn(captures, 'activeCapture').mockReturnValue(capture());
  const start = vi.spyOn(f.plugin.writing, 'start').mockResolvedValue();
  const create = vi.spyOn(f.plugin, 'capture').mockResolvedValue();
  const open = vi.spyOn(f.plugin, 'openPanel').mockResolvedValue({ show: vi.fn() } as any);
  const writingPanel = vi.spyOn(f.plugin, 'openWritingPanel').mockResolvedValue({} as any);
  const connections = vi.spyOn(f.plugin, 'checkConnections').mockResolvedValue();
  await f.plugin.onload();
  cleanup.push(() => {
    (f.plugin as any).dispose();
  });
  const floating = document.querySelector<HTMLElement>('.cc-floating')!,
    buttons = floating.querySelectorAll('button');
  const rect = { left: 100, top: 100, bottom: 120, width: 50, height: 20 };
  const range = { getBoundingClientRect: () => rect };
  const selection = vi
    .spyOn(window, 'getSelection')
    .mockReturnValue({ rangeCount: 1, getRangeAt: () => range } as any);
  const update = () => view.contentEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  return {
    ...f,
    events,
    view,
    read,
    active,
    start,
    create,
    open,
    writingPanel,
    connections,
    floating,
    buttons,
    rect,
    selection,
    update,
  };
}
describe('vocabulary commands and floating selection toolbar', () => {
  it('does not restore writing sessions when draft persistence is disabled', async () => {
    const f = pluginFixture();
    vi.spyOn(f.plugin, 'loadData').mockResolvedValue({
      settings: { restoreDrafts: false },
      writingSessions: [],
    } as any);
    const restore = vi.spyOn(f.plugin.writing, 'restore');
    await f.plugin.onload();
    cleanup.push(() => (f.plugin as any).dispose());
    expect(restore).not.toHaveBeenCalled();
  });
  it('registers commands, settings, both view factories and restores valid drafts', async () => {
    const f = pluginFixture(),
      registry = vi.spyOn(f.plugin, 'registerView');
    vi.spyOn(f.plugin, 'loadData').mockResolvedValue({ drafts: [f.d, { bad: true }] } as any);
    await f.plugin.onload();
    cleanup.push(() => (f.plugin as any).dispose());
    expect(f.plugin.drafts).toHaveLength(1);
    expect(registry.mock.calls.map(([name]) => name)).toEqual([WRITING_VIEW, VIEW_TYPE]);
    for (const [, factory] of registry.mock.calls)
      expect((factory as any)({})).toHaveProperty('contentEl');
  });
  it('routes each command and the ribbon to the correct mode', async () => {
    const f = await setup(),
      mock = f.plugin as any;
    for (const name of [
      'check-writing',
      'open-writing',
      'create-from-selection',
      'open-review',
      'check-connections',
    ])
      mock.commands.get(name).callback();
    mock.ribbon();
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.writingPanel).toHaveBeenCalledOnce();
    expect(f.create).toHaveBeenCalledTimes(2);
    expect(f.open).toHaveBeenCalledOnce();
    expect(f.connections).toHaveBeenCalledOnce();
    f.active.mockReturnValue(null);
    mock.commands.get('check-writing').callback();
    mock.commands.get('create-from-selection').callback();
    mock.ribbon();
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.create).toHaveBeenCalledTimes(2);
    expect(f.open).toHaveBeenCalledTimes(2);
    f.update();
    mock.commands.get('check-writing').callback();
    expect(f.start).toHaveBeenCalledTimes(2);
  });
  it('offers context-menu actions for short selections and only writing for a long selection', async () => {
    const f = await setup(),
      items: any[] = [];
    const menu = {
      addItem: (fn: any) => {
        const item = {
          setTitle: vi.fn().mockReturnThis(),
          setIcon: vi.fn().mockReturnThis(),
          onClick: vi.fn().mockReturnThis(),
        };
        fn(item);
        items.push(item);
      },
    };
    f.events.get('editor-menu')!(menu, null, f.view);
    expect(items).toHaveLength(2);
    for (const item of items) item.onClick.mock.calls[0][0]();
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.create).toHaveBeenCalledOnce();
    items.length = 0;
    f.read.mockReturnValue(capture({ selected: 'x'.repeat(241) }));
    f.events.get('editor-menu')!(menu, null, {});
    expect(items).toHaveLength(1);
    items.length = 0;
    f.workspace.getActiveViewOfType.mockReturnValue(null);
    f.events.get('editor-menu')!(menu, null, {});
    expect(items).toHaveLength(0);
  });
  it('preserves selection on pointerdown, routes clicks and hides on escape and scroll', async () => {
    const f = await setup();
    f.buttons[0]!.click();
    f.buttons[1]!.click();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
    f.update();
    expect(f.floating.hidden).toBe(false);
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    f.buttons[0]!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    f.buttons[0]!.click();
    f.buttons[1]!.click();
    expect(f.create).toHaveBeenCalledWith(capture());
    expect(f.start).toHaveBeenCalledWith(capture());
    expect(f.floating.hidden).toBe(true);
    f.update();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(f.floating.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(f.floating.hidden).toBe(true);
    f.update();
    document.dispatchEvent(new Event('scroll'));
    expect(f.floating.hidden).toBe(true);
  });
  for (const reason of [
    'no-view',
    'other-document',
    'empty',
    'too-long',
    'disabled',
    'no-selection',
    'empty-range',
  ] as const)
    it(`hides the toolbar for ${reason}`, async () => {
      const f = await setup();
      f.update();
      expect(f.floating.hidden).toBe(false);
      if (reason === 'no-view') f.workspace.getActiveViewOfType.mockReturnValue(null);
      if (reason === 'other-document')
        f.workspace.getActiveViewOfType.mockReturnValue({
          contentEl: document.implementation.createHTMLDocument().body,
        });
      if (reason === 'empty') f.read.mockReturnValue(null);
      if (reason === 'too-long') f.read.mockReturnValue(capture({ selected: 'x'.repeat(6001) }));
      if (reason === 'disabled') f.plugin.settings.floatingButton = false;
      if (reason === 'no-selection') f.selection.mockReturnValue(null);
      if (reason === 'empty-range') Object.assign(f.rect, { width: 0, height: 0 });
      f.update();
      expect(f.floating.hidden).toBe(true);
    });
  it('shows only the writing button for a long text selection', async () => {
    const f = await setup();
    f.read.mockReturnValue(capture({ selected: 'x'.repeat(241) }));
    f.update();
    expect(f.floating.hidden).toBe(false);
    expect(f.buttons[0]!.hidden).toBe(true);
    expect(f.buttons[1]!.hidden).toBe(false);
  });
  it.each(['cc-panel', 'cc-floating', 'modal-container'])(
    'ignores clicks inside %s',
    async (className) => {
      const f = await setup(),
        target = document.createElement('div');
      target.className = className;
      document.body.append(target);
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      expect(f.read).not.toHaveBeenCalled();
    },
  );
  it('keeps toolbar geometry inside the viewport above a low selection', async () => {
    const f = await setup();
    Object.assign(f.rect, { left: 100000, top: 10000, bottom: 10020 });
    f.update();
    expect(parseFloat(f.floating.style.left)).toBeLessThan(window.innerWidth);
    expect(parseFloat(f.floating.style.top)).toBeLessThan(window.innerHeight);
    Object.assign(f.rect, { left: -100, top: 0, bottom: 10 });
    f.update();
    expect(f.floating.style.left).toBe('8px');
    expect(f.floating.style.top).toBe('20px');
  });
  it('clears cached selection when another file opens, retains it for the same file', async () => {
    const f = await setup();
    f.active.mockReturnValue(null);
    f.update();
    f.events.get('file-open')!(f.file);
    (f.plugin as any).ribbon();
    expect(f.create).toHaveBeenCalledOnce();
    f.events.get('file-open')!(null);
    (f.plugin as any).ribbon();
    expect(f.open).toHaveBeenCalledOnce();
    expect(f.floating.hidden).toBe(true);
  });
  it('manages detached-window toolbars without duplicates or leftovers', async () => {
    const f = await setup(),
      doc = document.implementation.createHTMLDocument();
    f.events.get('window-open')!(null, { document: doc });
    f.events.get('window-open')!(null, { document: doc });
    expect(doc.querySelectorAll('.cc-floating')).toHaveLength(1);
    f.events.get('window-close')!(null, { document: doc });
    f.events.get('window-close')!(null, { document: doc });
    expect(doc.querySelector('.cc-floating')).toBeNull();
    (f.plugin as any).dispose();
    expect(document.querySelector('.cc-floating')).toBeNull();
  });
});
describe('reusing panes safely', () => {
  for (const location of ['current', 'other', 'right', 'split'])
    it(`opens in the ${location} pane and removes old plugin panes`, async () => {
      const { plugin, workspace } = pluginFixture(),
        leaf = { view: {}, setViewState: vi.fn().mockResolvedValue(undefined), detach: vi.fn() },
        extra = { detach: vi.fn() };
      workspace.getLeavesOfType.mockImplementation((type: string) =>
        type === VIEW_TYPE
          ? location === 'current'
            ? [leaf, extra]
            : []
          : location === 'other'
            ? [leaf, extra]
            : [],
      );
      workspace.getRightLeaf.mockReturnValue(location === 'right' ? leaf : null);
      workspace.getLeaf.mockReturnValue(leaf);
      expect(await plugin.openPanel()).toBe(leaf.view);
      expect(leaf.setViewState).toHaveBeenCalledTimes(location === 'current' ? 0 : 1);
      expect(extra.detach).toHaveBeenCalledTimes(['current', 'other'].includes(location) ? 1 : 0);
      expect(leaf.detach).not.toHaveBeenCalled();
    });
  it('recovers from a failed pane operation and serializes mode changes', async () => {
    const { plugin, workspace } = pluginFixture(),
      work = deferred<void>(),
      leaf = {
        view: {},
        setViewState: vi
          .fn()
          .mockRejectedValueOnce(new Error('Pane closed'))
          .mockReturnValueOnce(work.promise)
          .mockResolvedValue(undefined),
      };
    workspace.getRightLeaf.mockReturnValue(leaf);
    await expect(plugin.openPanel()).rejects.toThrow('Pane closed');
    const first = plugin.openPanel(),
      second = plugin.openWritingPanel();
    await vi.waitFor(() => expect(leaf.setViewState).toHaveBeenCalledTimes(2));
    work.resolve();
    await Promise.all([first, second]);
    expect(leaf.setViewState.mock.calls[2]![0]).toEqual({ type: WRITING_VIEW, active: true });
  });
});
