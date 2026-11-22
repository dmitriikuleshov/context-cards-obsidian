// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownView } from 'obsidian';
import ContextCardsPlugin from '../src/main';

let plugin: ContextCardsPlugin;
beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 100, top: 200, width: 90, height: 20 }),
  });
});
afterEach(() => {
  plugin?.onunload();
  (plugin as any)?.dispose();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
describe('selection to draft through the plugin entry points', () => {
  for (const mode of ['preview', 'source'])
    it(`captures from the selection button in ${mode === 'preview' ? 'Reading Mode' : 'Live Preview'}`, async () => {
      const text = 'She brushed off the warning.';
      document.body.innerHTML = `<div id="view"><div class="markdown-preview-section"><p>${text}</p></div></div>`;
      const contentEl = document.querySelector<HTMLElement>('#view')!,
        node = contentEl.querySelector('p')!.firstChild!;
      const range = document.createRange();
      range.setStart(node, 4);
      range.setEnd(node, 15);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const view = Object.assign(new MarkdownView({} as any), {
        file: { path: 'Books/Book.md', basename: 'Book' },
        contentEl,
        getMode: () => mode,
        editor: {
          getSelection: () => (mode === 'source' ? 'brushed off' : ''),
          getValue: () => text,
          getCursor: (which: string) => ({ offset: which === 'from' ? 4 : 15 }),
          posToOffset: (position: { offset: number }) => position.offset,
        },
      });
      const events = new Map<string, (...args: any[]) => void>();
      const app = {
        vault: { getName: () => 'Test' },
        workspace: {
          getActiveViewOfType: () => view,
          getLeavesOfType: () => [],
          on: (name: string, callback: (...args: any[]) => void) => {
            events.set(name, callback);
            return {};
          },
        },
      };
      plugin = new ContextCardsPlugin(app as any, {} as any);
      const show = vi.fn();
      vi.spyOn(plugin, 'openPanel').mockResolvedValue({ show } as any);
      const generate = vi.spyOn(plugin, 'generate').mockResolvedValue();
      const writing = vi.spyOn(plugin.writing, 'start').mockResolvedValue();
      await plugin.onload();
      contentEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      const button = document.querySelector<HTMLButtonElement>(
        '.cc-floating > button[aria-label="Explain word / phrase"]',
      )!;
      expect(button.hidden).toBe(false);
      expect(button.textContent).toBe('Explain word / phrase');
      expect(button.parentElement!.hidden).toBe(false);
      const down = new Event('pointerdown', { cancelable: true, bubbles: true });
      button.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      button.click();
      await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
      expect(plugin.drafts).toHaveLength(1);
      expect(plugin.drafts[0]!.answer).toBe('brushed off');
      expect(plugin.drafts[0]!.capture.mode).toBe(mode === 'preview' ? 'reading' : 'editor');
      expect(show).toHaveBeenCalledWith(plugin.drafts[0]);
      contentEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      const writingButton = document.querySelector<HTMLButtonElement>(
        '[aria-label="Find mistakes"]',
      )!;
      expect(writingButton.textContent).toBe('Find mistakes');
      writingButton.click();
      expect(writing).toHaveBeenCalledWith(expect.objectContaining({ selected: 'brushed off' }));
      // Opening a palette or clicking the ribbon can collapse the DOM selection.
      selection.removeAllRanges();
      if (mode === 'source') view.editor.getSelection = () => '';
      const framework = plugin as any;
      framework.ribbon();
      await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(2));
      framework.commands.get('create-from-selection').callback();
      await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(3));
      expect(plugin.drafts).toHaveLength(1);
      expect(generate).toHaveBeenCalledOnce();
      events.get('file-open')!({ path: 'Another book.md' });
      framework.ribbon();
      expect(plugin.drafts).toHaveLength(1);
    });
});
