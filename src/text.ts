import type { Capture, Draft, Settings } from './types';
import { cardFields, emptyContent, EXAMPLE_COUNT } from './types';

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
export function htmlText(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br>');
}
export function cleanDeck(value: string): string {
  return value
    .split('::')
    .map((p) => p.replace(/[\x00-\x1f\x7f]/g, '').trim())
    .filter(Boolean)
    .join('::');
}
export function bookDeck(settings: Settings, capture: Capture): string {
  const remembered = settings.bookDecks[capture.file];
  if (remembered) return cleanDeck(remembered);
  const root = cleanDeck(settings.rootDeck) || 'English::Books';
  return settings.decksByBook
    ? `${root}::${capture.book.replace(/:/g, ' — ').trim() || 'Reading'}`
    : root;
}
export function trimCapture(capture: Capture): Capture {
  const leading = capture.selected.length - capture.selected.trimStart().length;
  const selected = capture.selected.trim();
  return {
    ...capture,
    selected,
    start: capture.start + leading,
    end: capture.start + leading + selected.length,
  };
}
export function contextWindow(text: string, start: number, end: number, limit: number) {
  if (start < 0 || end <= start || end > text.length)
    throw new Error('Select a word or expression first.');
  const budget = Math.max(end - start, Math.min(12000, limit));
  const spare = budget - (end - start);
  let left = Math.max(0, start - Math.floor(spare * 0.5));
  let right = Math.min(text.length, left + budget);
  left = Math.max(0, Math.min(left, right - budget));
  // Prefer complete surrounding sentences; never trim into the selected range.
  const prefix = text.slice(left, start);
  const boundary = prefix.search(/(?:[.!?]["')\]]?\s+|\n\s*\n)/u);
  if (left > 0 && boundary >= 0) {
    const match = /(?:[.!?]["')\]]?\s+|\n\s*\n)/u.exec(prefix)!;
    left += match.index + match[0].length;
  }
  if (right < text.length) {
    const suffix = text.slice(end, right);
    const matches = [...suffix.matchAll(/[.!?]["')\]]?(?=\s|$)|\n\s*\n/gu)];
    const last = matches.at(-1);
    if (last) right = end + last.index! + last[0].length;
  }
  const raw = text.slice(left, right);
  const leading = raw.length - raw.trimStart().length;
  const context = raw.trim();
  return { context, answerStart: start - left - leading };
}
export function createDraft(capture: Capture, settings: Settings): Draft {
  capture = trimCapture(capture);
  let { context, answerStart } = contextWindow(
    capture.text,
    capture.start,
    capture.end,
    settings.contextSize,
  );
  // Start with the selected sentence and its immediate neighbours. Long book excerpts
  // make daily recall slow; the full captured surroundings remain available via More context.
  const sentences = Array.from(
    new Intl.Segmenter('en', { granularity: 'sentence' }).segment(context),
  );
  const first = sentences.findIndex((part) => part.index + part.segment.length > answerStart);
  const last = sentences.findIndex(
    (part) => part.index + part.segment.length >= answerStart + capture.selected.length,
  );
  if (first >= 0 && last >= 0) {
    const left = sentences[Math.max(0, first - 1)]!.index;
    const tail = sentences[Math.min(sentences.length - 1, last + 1)]!;
    const excerpt = context.slice(left, tail.index + tail.segment.length);
    const leading = excerpt.length - excerpt.trimStart().length;
    context = excerpt.trim();
    answerStart -= left + leading;
  }
  return {
    ...emptyContent(),
    id: crypto.randomUUID(),
    created: new Date().toISOString(),
    capture,
    context,
    answer: capture.selected,
    answerStart,
    expression: capture.selected,
    deck: bookDeck(settings, capture),
    tags: settings.defaultTags,
    phase: 'editing',
    error: '',
    allowDuplicate: false,
    revision: 0,
  };
}
export function answerValid(draft: Pick<Draft, 'context' | 'answer' | 'answerStart'>): boolean {
  return (
    draft.answer.trim().length > 0 &&
    draft.answerStart >= 0 &&
    draft.context.slice(draft.answerStart, draft.answerStart + draft.answer.length) === draft.answer
  );
}
export function updateContext(draft: Draft, context: string): void {
  const previous = draft.context;
  let common = 0;
  while (
    common < previous.length &&
    common < context.length &&
    previous[common] === context[common]
  )
    common++;
  let suffix = 0;
  while (
    suffix < previous.length - common &&
    suffix < context.length - common &&
    previous[previous.length - 1 - suffix] === context[context.length - 1 - suffix]
  )
    suffix++;
  const oldChangeEnd = previous.length - suffix;
  let proposed = draft.answerStart;
  if (oldChangeEnd <= draft.answerStart) proposed += context.length - previous.length;
  const unchanged =
    oldChangeEnd <= draft.answerStart || common >= draft.answerStart + draft.answer.length;
  draft.context = context;
  if (
    unchanged &&
    proposed >= 0 &&
    context.slice(proposed, proposed + draft.answer.length) === draft.answer
  ) {
    draft.answerStart = proposed;
  } else {
    const first = context.indexOf(draft.answer);
    draft.answerStart = first >= 0 && context.indexOf(draft.answer, first + 1) < 0 ? first : -1;
  }
}
/** Anki's native typed answer is one line; the source quote retains its original whitespace. */
export function typedAnswer(answer: string): string {
  return answer.replace(/\s+/gu, ' ').trim();
}
export function termRanges(context: string, answer: string): Array<[number, number]> {
  if (!answer) return [];
  const escaped = answer
    .trim()
    .split(/\s+/u)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu');
  return [...context.matchAll(pattern)].map((m) => [m.index!, m.index! + m[0].length]);
}
export function contextHtml(draft: Draft, blank = false): string {
  if (!answerValid(draft)) return htmlText(draft.context);
  let ranges = blank ? termRanges(draft.context, draft.answer) : [];
  if (!ranges.some(([a]) => a === draft.answerStart))
    ranges.push([draft.answerStart, draft.answerStart + draft.answer.length]);
  ranges = ranges.sort((a, b) => a[0] - b[0]);
  let html = '',
    cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    html += htmlText(draft.context.slice(cursor, start));
    html += blank
      ? '<span class="cc-gap">[…]</span>'
      : `<mark>${htmlText(draft.context.slice(start, end))}</mark>`;
    cursor = end;
  }
  return html + htmlText(draft.context.slice(cursor));
}
export function issues(draft: Draft, settings?: Partial<Settings>): string[] {
  const f = cardFields(settings);
  const result: string[] = [];
  if (!draft.expression.trim()) result.push('Enter a word or expression.');
  if (f.meaningSentences && !draft.meaning.trim())
    result.push('Add a short meaning for the hidden definition.');
  if (f.explanationSentences && !draft.explanation.trim()) result.push('Add an explanation.');
  if (f.examples && draft.exampleGroups) {
    if (
      draft.exampleGroups.length < 1 ||
      draft.exampleGroups.length > 5 ||
      draft.exampleGroups.some(
        (g) =>
          !g.meaning.trim() ||
          g.examples.length < 1 ||
          g.examples.length > 10 ||
          g.examples.some((v) => !v.trim()),
      )
    )
      result.push('Complete each meaning group and its examples.');
  } else if (
    f.examples &&
    (draft.examples.length !== EXAMPLE_COUNT || draft.examples.some((v) => !v.trim()))
  )
    result.push('Add five usage examples.');
  if (!answerValid(draft))
    result.push('Select the exact answer in the context, then click “Use selection as answer”.');
  if (!cleanDeck(draft.deck)) result.push('Choose an Anki deck.');
  return result;
}
export function sourceUri(capture: Capture): string {
  return `obsidian://open?vault=${encodeURIComponent(capture.vault)}&file=${encodeURIComponent(capture.file)}`;
}
export function parseTags(value: string): string[] {
  return [...new Set(value.trim().split(/\s+/).filter(Boolean))];
}
