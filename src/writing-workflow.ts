import type { WritingFinding } from './writing';

/** Prefer precise learning targets over broader optional suggestions at the same location. */
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
  const priority = (id: string) => {
    const f = findings.find((f) => f.id === id)!;
    return f.kind === 'grammar' || f.kind === 'vocabulary' ? 0 : 1;
  };
  candidates.sort(
    (a, b) =>
      priority(a.id) - priority(b.id) || a.end - a.start - (b.end - b.start) || a.start - b.start,
  );
  const chosen: typeof candidates = [];
  for (const range of candidates)
    if (!chosen.some((other) => range.start < other.end && range.end > other.start))
      chosen.push(range);
  return chosen.sort((a, b) => a.start - b.start);
}
