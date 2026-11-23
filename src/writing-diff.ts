import { minimalCorrection } from './writing';

/** Extract local edits from corrected prose; the model never supplies offsets or targets. */
export function writingEdits(original: string, corrected: string) {
  const tokenize = (value: string) =>
    Array.from(value.matchAll(/\s+|[\p{L}\p{N}]+(?:['’][\p{L}]+)*|[^\s]/gu), (m) => ({
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
    }));
  const a = tokenize(original),
    b = tokenize(corrected);
  let prefix = 0,
    endA = a.length,
    endB = b.length;
  while (prefix < endA && prefix < endB && a[prefix]!.text === b[prefix]!.text) prefix++;
  while (endA > prefix && endB > prefix && a[endA - 1]!.text === b[endB - 1]!.text) {
    endA--;
    endB--;
  }
  const n = endA - prefix,
    m = endB - prefix;
  // Bound both memory and work when a model rewrites a long sentence wholesale.
  if ((n + 1) * (m + 1) > 1_000_000)
    throw new Error(
      'Too many changes in one sentence. Preserve the source or check a shorter passage.',
    );
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i]![j] =
        a[prefix + i]!.text === b[prefix + j]!.text
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  let i = 0,
    j = 0;
  const edits: { before: string; after: string }[] = [];
  while (i < n || j < m) {
    if (i < n && j < m && a[prefix + i]!.text === b[prefix + j]!.text) {
      i++;
      j++;
      continue;
    }
    const startA = a[prefix + i]?.start ?? original.length;
    const startB = b[prefix + j]?.start ?? corrected.length;
    while (i < n || j < m) {
      if (i < n && j < m && a[prefix + i]!.text === b[prefix + j]!.text) break;
      if (i < n && (j === m || table[i + 1]![j]! >= table[i]![j + 1]!)) i++;
      else j++;
    }
    const finishA = a[prefix + i]?.start ?? original.length;
    const finishB = b[prefix + j]?.start ?? corrected.length;
    const removed = original.slice(startA, finishA),
      added = corrected.slice(startB, finishB);
    if (!removed.trim() && !added.trim()) continue; // Formatting alone is not a learning target.
    const local = original.slice(0, startA) + added + original.slice(finishA);
    const edit = minimalCorrection(original, local);
    // At this stage hyphenation alone is treated as editorial style, not a practice error.
    // Apostrophes are deliberately excluded: its/it's is a real grammar distinction.
    if (edit.before.replaceAll('-', '') === edit.after.replaceAll('-', '')) continue;
    if (edit.before.length > 300 || edit.after.length > 300)
      throw new Error('The model rewrote too much text. Return only short local corrections.');
    edits.push(edit);
  }
  return edits;
}
