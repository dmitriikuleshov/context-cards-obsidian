// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderedSelection, readCapture, activeCapture } from '../../src/capture';
import { capture, pluginFixture } from './fixtures';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});
describe('rendered source safety and boundary cases', () => {
  const app = { vault: { getName: () => 'Test' } } as any;
  function view() {
    return {
      file: { path: 'Book.md', basename: 'Book' },
      contentEl: document.body,
      getMode: () => 'preview',
    } as any;
  }
  function select(start: Node, a: number, end: Node, b: number) {
    const range = document.createRange();
    range.setStart(start, a);
    range.setEnd(end, b);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(range);
    return range;
  }
  it('returns no selection without a source, range or active Markdown view', () => {
    expect(readCapture(app, { file: null } as any)).toBeNull();
    expect(readCapture(app, view())).toBeNull();
    expect(activeCapture({ ...app, workspace: { getActiveViewOfType: () => null } })).toBeNull();
  });
  it('preserves line breaks, nested inline content and document fragments while excluding injected markup', () => {
    const fragment = document.createDocumentFragment(),
      p = document.createElement('p');
    p.innerHTML =
      'A<br><span>word</span><!--comment--><script>bad</script><style>bad</style><span class="frontmatter">bad</span>';
    fragment.append(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    const result = renderedSelection([fragment], range)!;
    expect(result.text).toBe('A\nword\n');
    expect(result.text.slice(result.start, result.end)).toBe('A\nword');
  });
  it('rejects endpoints outside roots and inside ignored controls', () => {
    document.body.innerHTML = '<p>word<button>Ignore</button></p><i>Other</i>';
    const p = document.querySelector('p')!,
      button = p.querySelector('button')!,
      other = document.querySelector('i')!;
    const r = document.createRange();
    r.selectNodeContents(button);
    expect(renderedSelection([p], r)).toBeNull();
    r.selectNodeContents(other);
    expect(renderedSelection([p], r)).toBeNull();
    r.selectNodeContents(p);
    r.collapse();
    expect(renderedSelection([p], r)).toBeNull();
  });
  it('supports a root element endpoint and captures a bounded surrounding snapshot', () => {
    document.body.innerHTML = '<div class="markdown-rendered">Before <b>word</b> after.</div>';
    const root = document.querySelector('div')!;
    select(root, 0, root, 3);
    const c = readCapture(app, view(), 3)!;
    expect(c.selected).toBe('Before word after.');
    expect(c.start).toBe(0);
    select(root.querySelector('b')!.firstChild!, 0, root.querySelector('b')!.firstChild!, 4);
    const bounded = readCapture(app, view(), 2)!;
    expect(bounded.text.length).toBe(8);
    expect(bounded.text.slice(bounded.start, bounded.end)).toBe('word');
  });
  it('refuses whitespace-only selection and a selection spanning different rendered roots', () => {
    document.body.innerHTML =
      '<div class="markdown-rendered"><p>   </p></div><div class="markdown-rendered"><p>Other</p></div>';
    const ps = document.querySelectorAll('p');
    select(ps[0]!.firstChild!, 0, ps[0]!.firstChild!, 3);
    expect(readCapture(app, view())).toBeNull();
    select(ps[0]!.firstChild!, 0, ps[1]!.firstChild!, 4);
    expect(readCapture(app, view())).toBeNull();
  });
  it('does not capture injected code-copy controls even if selected', () => {
    document.body.innerHTML = '<div class="markdown-rendered"><button>Copy</button></div>';
    const button = document.querySelector('button')!;
    select(button.firstChild!, 0, button.firstChild!, 4);
    expect(readCapture(app, view())).toBeNull();
  });
});
describe('optional source marking through editor and reading mode APIs', () => {
  function setup(mode: string) {
    const f = pluginFixture();
    f.plugin.drafts = [];
    f.plugin.settings.markSourceWord = true;
    const editor = {
      getValue: vi.fn(() => f.d.capture.text),
      getSelection: vi.fn(() => f.d.capture.selected),
      getCursor: vi.fn(() => ({ offset: 4 })),
      posToOffset: vi.fn((pos: any) => pos.offset),
      offsetToPos: vi.fn((offset: number) => ({ offset })),
      replaceRange: vi.fn(),
    };
    f.workspace.getActiveViewOfType.mockReturnValue({ file: f.file, editor, getMode: () => mode });
    vi.spyOn(f.plugin, 'openPanel').mockResolvedValue({ show: vi.fn() } as any);
    const generate = vi.spyOn(f.plugin, 'generate').mockResolvedValue();
    return { ...f, editor, generate };
  }
  it('wraps only the selected editor range, accounting for surrounding selection spaces', async () => {
    const f = setup('source');
    f.editor.getSelection.mockReturnValue(' brushed off ');
    f.editor.getCursor.mockReturnValue({ offset: 3 });
    await f.plugin.capture(capture());
    expect(f.editor.replaceRange).toHaveBeenCalledWith(
      '`brushed off`',
      { offset: 4 },
      { offset: 15 },
    );
    expect(f.generate).toHaveBeenCalledOnce();
  });
  it('does not mark when the editor selection is stale or already marked', async () => {
    const f = setup('source');
    f.editor.getSelection.mockReturnValue('other');
    await f.plugin.capture(capture());
    expect(f.editor.replaceRange).not.toHaveBeenCalled();
    f.plugin.drafts = [];
    f.editor.getSelection.mockReturnValue('brushed off');
    f.editor.getValue.mockReturnValue('She `brushed off` the warning.');
    await f.plugin.capture(capture());
    expect(f.editor.replaceRange).not.toHaveBeenCalled();
  });
  it('processes reading-mode Markdown without modifying any real vault file', async () => {
    const f = setup('preview'),
      outputs: string[] = [];
    f.vault.process.mockImplementation(async (_file: any, fn: any) => {
      outputs.push(fn('She brushed off the warning.'));
      outputs.push(fn('She `brushed off` the warning.'));
    });
    await f.plugin.capture(capture({ mode: 'reading' }));
    expect(outputs).toEqual(['She `brushed off` the warning.', 'She `brushed off` the warning.']);
  });
  it('still creates cards if source marking fails', async () => {
    const f = setup('preview');
    f.vault.process.mockRejectedValue(new Error('Read only'));
    await f.plugin.capture(capture());
    expect(f.plugin.drafts).toHaveLength(1);
    expect(f.generate).toHaveBeenCalledOnce();
  });
  it('does not alter another open book', async () => {
    const f = setup('source');
    await f.plugin.capture(capture({ file: 'Other.md' }));
    expect(f.editor.replaceRange).not.toHaveBeenCalled();
    expect(f.vault.process).not.toHaveBeenCalled();
  });
});
