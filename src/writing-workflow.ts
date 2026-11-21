import type { WritingFinding } from './writing';

/** Only annotate exact captured quotes. Overlapping findings remain reachable through navigation. */
export function writingHighlights(source: string, findings: WritingFinding[]) {
  const candidates: Array<{ start: number; end: number; id: string }> = [];
  for (const f of findings) {
    if (!f.original || !f.before) continue;
    const offset = f.original.indexOf(f.before);
    if (offset < 0) continue;
    let at = source.indexOf(f.original);
    while (at >= 0) {
      candidates.push({ start: at + offset, end: at + offset + f.before.length, id: f.id });
      at = source.indexOf(f.original, at + f.original.length);
    }
  }
  candidates.sort((a, b) => a.start - b.start || a.end - b.end);
  let end = 0;
  return candidates.filter((range) => {
    if (range.start < end) return false;
    end = range.end;
    return true;
  });
}
