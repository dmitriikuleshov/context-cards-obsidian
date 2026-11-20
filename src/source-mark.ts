import type { Capture } from './types';
const normalize = (s: string) => s.replace(/[`*_#>\[\]~]/g, '').replace(/\s+/g, ' ');
/** Find the exact source occurrence, refusing ambiguous matches or existing code. */
export function sourceMarkRange(
  text: string,
  capture: Capture,
  preferredStart?: number,
): { start: number; end: number } | null {
  const word = capture.selected;
  if (!word || /[`\r\n]/.test(word)) return null;
  const before = normalize(capture.text.slice(0, capture.start)).slice(-100);
  const after = normalize(capture.text.slice(capture.end)).slice(0, 100);
  const candidates: { start: number; end: number; score: number }[] = [];
  for (let start = text.indexOf(word); start !== -1; start = text.indexOf(word, start + 1)) {
    if (preferredStart !== undefined && start !== preferredStart) continue;
    const end = start + word.length;
    if (/[\p{L}\p{N}]/u.test(word[0]!) && /[\p{L}\p{N}]/u.test(text[start - 1] ?? '')) continue;
    if (/[\p{L}\p{N}]/u.test(word.at(-1)!) && /[\p{L}\p{N}]/u.test(text[end] ?? '')) continue;
    const left = normalize(text.slice(Math.max(0, start - 300), start));
    const right = normalize(text.slice(end, end + 300));
    let a = 0,
      b = 0;
    while (a < before.length && a < left.length && before.at(-a - 1) === left.at(-a - 1)) a++;
    while (b < after.length && b < right.length && after[b] === right[b]) b++;
    candidates.push({ start, end, score: a + b });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || (candidates.length > 1 && (best.score < 12 || best.score === candidates[1]!.score)))
    return null;
  // Do not wrap text already inside inline code or fenced code blocks.
  const code = /(`+|~{3,})[\s\S]*?\1/g;
  for (const match of text.matchAll(code))
    if (match.index! <= best.start && match.index! + match[0].length >= best.end) return null;
  return { start: best.start, end: best.end };
}
