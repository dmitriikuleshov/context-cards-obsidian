// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderedSelection, readCapture } from '../src/capture';
import type { App, MarkdownView } from 'obsidian';
describe('Reading Mode DOM ranges', () => {
  it('captures an expression across inline formatting without Markdown markers', () => {
    document.body.innerHTML =
      '<div id="root"><p>She <strong>brushed</strong> off the warning.</p><p>Then she left.</p></div>';
    const root = document.querySelector('#root')!;
    const strong = root.querySelector('strong')!.firstChild!;
    const tail = root.querySelector('strong')!.nextSibling!;
    const range = document.createRange();
    range.setStart(strong, 0);
    range.setEnd(tail, 4);
    const result = renderedSelection(Array.from(root.children), range)!;
    expect(result.text.slice(result.start, result.end)).toBe('brushed off');
    expect(result.text).toContain('\nThen she left.');
  });
  it('maps repeated words to the actual selected text node', () => {
    document.body.innerHTML = '<p>bank <em>bank</em> bank</p>';
    const p = document.querySelector('p')!,
      range = document.createRange();
    range.selectNodeContents(p.querySelector('em')!);
    const result = renderedSelection([p], range)!;
    expect(result.start).toBe(5);
    expect(result.end).toBe(9);
  });
  it('preserves paragraph boundaries for selections spanning paragraphs', () => {
    document.body.innerHTML = '<div><p>First word.</p><p>Second word.</p></div>';
    const paragraphs = document.querySelectorAll('p'),
      range = document.createRange();
    range.setStart(paragraphs[0]!.firstChild!, 6);
    range.setEnd(paragraphs[1]!.firstChild!, 6);
    const result = renderedSelection(Array.from(document.querySelector('div')!.children), range)!;
    expect(result.text.slice(result.start, result.end)).toBe('word.\nSecond');
  });
  it('ignores code copy controls and other injected buttons', () => {
    document.body.innerHTML = '<pre>word<button>Copy</button> context</pre>';
    const pre = document.querySelector('pre')!,
      range = document.createRange();
    range.setStart(pre.firstChild!, 0);
    range.setEnd(pre.firstChild!, 4);
    expect(renderedSelection([pre], range)!.text).not.toContain('Copy');
  });
});
describe('capture through the Obsidian view/editor interfaces', () => {
  const app = { vault: { getName: () => 'Test vault' } } as unknown as App;
  const file = { path: 'Books/Book.md', basename: 'Book' };
  it('uses editor offsets for the actual occurrence in Live Preview, including UTF-16 text', () => {
    const text = '📖 A bank stood by the bank.',
      start = text.lastIndexOf('bank');
    const view = {
      file,
      getMode: () => 'source',
      editor: {
        getSelection: () => 'bank',
        getValue: () => text,
        getCursor: (side: string) => ({ offset: side === 'from' ? start : start + 4 }),
        posToOffset: (position: { offset: number }) => position.offset,
      },
    } as unknown as MarkdownView;
    const capture = readCapture(app, view)!;
    expect(capture.start).toBe(start);
    expect(capture.mode).toBe('editor');
    expect(capture.text.slice(capture.start, capture.end)).toBe(capture.selected);
  });
  it('limits the saved snapshot instead of retaining the whole book', () => {
    const text = 'before '.repeat(10000) + 'target' + ' after'.repeat(10000),
      start = text.indexOf('target');
    const view = {
      file,
      getMode: () => 'source',
      editor: {
        getSelection: () => 'target',
        getValue: () => text,
        getCursor: (side: string) => ({ offset: side === 'from' ? start : start + 6 }),
        posToOffset: (position: { offset: number }) => position.offset,
      },
    } as unknown as MarkdownView;
    const capture = readCapture(app, view)!;
    expect(capture.text.length).toBe(24006);
    expect(capture.text.slice(capture.start, capture.end)).toBe('target');
  });
  it('captures Reading Mode text within the current Markdown view', () => {
    document.body.innerHTML =
      '<div id="view"><div class="markdown-preview-section"><div><p>A bank was closed.</p></div><div><p>She <strong>brushed</strong> off the warning.</p></div><div><p>Then she left.</p></div></div></div>';
    const contentEl = document.querySelector<HTMLElement>('#view')!,
      strong = contentEl.querySelector('strong')!;
    const range = document.createRange();
    range.setStart(strong.firstChild!, 0);
    range.setEnd(strong.nextSibling!, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const view = { file, contentEl, getMode: () => 'preview' } as unknown as MarkdownView;
    const capture = readCapture(app, view)!;
    expect(capture.mode).toBe('reading');
    expect(capture.selected).toBe('brushed off');
    expect(capture.text).toContain('Then she left.');
    expect(capture.text.slice(capture.start, capture.end)).toBe(capture.selected);
    expect(capture.file).toBe(file.path);
  });
  it('ignores a selection outside the active book', () => {
    document.body.innerHTML =
      '<div id="view"><div class="markdown-preview-section"><p>Book text.</p></div></div><div id="elsewhere">Other text.</div>';
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#elsewhere')!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const view = {
      file,
      contentEl: document.querySelector('#view'),
      getMode: () => 'preview',
    } as unknown as MarkdownView;
    expect(readCapture(app, view)).toBeNull();
  });
  it('does not create a capture from an empty editor selection', () => {
    const view = {
      file,
      getMode: () => 'source',
      editor: { getSelection: () => '' },
    } as unknown as MarkdownView;
    expect(readCapture(app, view)).toBeNull();
  });
});
