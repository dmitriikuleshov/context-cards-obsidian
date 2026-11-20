import { MarkdownView, type App } from 'obsidian';
import type { Capture } from './types';

const BLOCK = /^(P|DIV|LI|BLOCKQUOTE|PRE|H[1-6]|TR|SECTION)$/;
/** Map DOM text endpoints to a rendered text snapshot, preserving block boundaries. */
export function renderedSelection(
  roots: Node[],
  range: Range,
): { text: string; start: number; end: number } | null {
  let text = '';
  const starts = new Map<Node, number>();
  const boundaries = new Map<Node, number[]>();
  const newline = () => {
    if (text && !text.endsWith('\n')) text += '\n';
  };
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      starts.set(node, text.length);
      text += node.nodeValue ?? '';
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const element = node.nodeType === 1 ? (node as Element) : null;
    if (
      element?.matches(
        'script,style,button,.metadata-container,.frontmatter,.cc-floating,.copy-code-button',
      )
    )
      return;
    if (element?.tagName === 'BR') {
      text += '\n';
      return;
    }
    const block = element && BLOCK.test(element.tagName);
    if (block) newline();
    starts.set(node, text.length);
    const positions: number[] = [];
    for (const child of Array.from(node.childNodes)) {
      positions.push(text.length);
      visit(child);
    }
    positions.push(text.length);
    boundaries.set(node, positions);
    if (block) newline();
  };
  for (const root of roots) visit(root);
  const offset = (node: Node, index: number) =>
    node.nodeType === 3
      ? starts.has(node)
        ? starts.get(node)! + index
        : undefined
      : boundaries.get(node)?.[index];
  const start = offset(range.startContainer, range.startOffset);
  const end = offset(range.endContainer, range.endOffset);
  if (start === undefined || end === undefined || end <= start) return null;
  return { text, start, end };
}

function topChild(root: Element, node: Node): Element | null {
  let child = node.nodeType === 1 ? (node as Element) : node.parentElement;
  while (child && child.parentElement !== root) child = child.parentElement;
  return child;
}
export function readCapture(app: App, view: MarkdownView, limit = 12000): Capture | null {
  if (!view.file) return null;
  const shared = { file: view.file.path, book: view.file.basename, vault: app.vault.getName() };
  if (view.getMode() !== 'preview') {
    const selected = view.editor.getSelection();
    if (!selected.trim()) return null;
    const whole = view.editor.getValue();
    const start = view.editor.posToOffset(view.editor.getCursor('from'));
    const end = view.editor.posToOffset(view.editor.getCursor('to'));
    const left = Math.max(0, start - limit);
    const right = Math.min(whole.length, end + limit);
    return {
      ...shared,
      text: whole.slice(left, right),
      start: start - left,
      end: end - left,
      selected,
      mode: 'editor',
    };
  }
  const selection = view.contentEl.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const startEl =
    range.startContainer.nodeType === 1
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  const endEl =
    range.endContainer.nodeType === 1
      ? (range.endContainer as Element)
      : range.endContainer.parentElement;
  const root = startEl?.closest('.markdown-preview-section, .markdown-rendered');
  if (!root || !view.contentEl.contains(root) || !endEl || !root.contains(endEl)) return null;
  const first = topChild(root, range.startContainer),
    last = topChild(root, range.endContainer);
  let roots: Node[];
  if (first && last) {
    const children = Array.from(root.children);
    const a = children.indexOf(first),
      b = children.indexOf(last);
    if (a < 0 || b < a) return null;
    roots = children.slice(Math.max(0, a - 2), Math.min(children.length, b + 3));
  } else roots = [root];
  const mapped = renderedSelection(roots, range);
  if (!mapped) return null;
  const left = Math.max(0, mapped.start - limit),
    right = Math.min(mapped.text.length, mapped.end + limit);
  const selected = mapped.text.slice(mapped.start, mapped.end);
  if (!selected.trim()) return null;
  return {
    ...shared,
    text: mapped.text.slice(left, right),
    start: mapped.start - left,
    end: mapped.end - left,
    selected,
    mode: 'reading',
  };
}

export function activeCapture(app: App): Capture | null {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  return view ? readCapture(app, view) : null;
}
