import { minimalCorrection } from './writing';
import { linkedWritingEdit } from './writing-edit-relation';

/** Extract local edits from corrected prose; the model never supplies offsets or targets. */
export function writingEdits(original: string, corrected: string) {
  const tokenize = (value: string) =>
    Array.from(value.matchAll(/\s+|[\p{L}\p{N}]+(?:['’][\p{L}]+)*|[^\s]/gu), (m) => ({
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
      word: /^[\p{L}\p{N}]+$/u.test(m[0]),
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
  // Affix changes anchor a word even next to a moved word ("is she becaus" →
  // "she is because"). They remain explicit substitutions, not equal tokens.
  const near = (i: number, j: number) => {
    const left = a[prefix + i]!,
      right = b[prefix + j]!;
    return (
      left.word &&
      right.word &&
      Math.min(left.text.length, right.text.length) >= 3 &&
      Math.abs(left.text.length - right.text.length) <= 3 &&
      (left.text.startsWith(right.text) || right.text.startsWith(left.text))
    );
  };
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i]![j] = Math.max(
        table[i + 1]![j]!,
        table[i]![j + 1]!,
        a[prefix + i]!.text === b[prefix + j]!.text
          ? table[i + 1]![j + 1]! + 3
          : near(i, j)
            ? table[i + 1]![j + 1]! + 1
            : 0,
      );
  let i = 0,
    j = 0;
  const hunks: { startA: number; finishA: number; startB: number; finishB: number }[] = [];
  while (i < n || j < m) {
    if (i < n && j < m && a[prefix + i]!.text === b[prefix + j]!.text) {
      i++;
      j++;
      continue;
    }
    if (i < n && j < m && near(i, j) && table[i]![j] === table[i + 1]![j + 1]! + 1) {
      const left = a[prefix + i]!,
        right = b[prefix + j]!;
      hunks.push({
        startA: left.start,
        finishA: left.end,
        startB: right.start,
        finishB: right.end,
      });
      i++;
      j++;
      continue;
    }
    const startA = a[prefix + i]?.start ?? original.length;
    const startB = b[prefix + j]?.start ?? corrected.length;
    while (i < n || j < m) {
      if (
        i < n &&
        j < m &&
        (a[prefix + i]!.text === b[prefix + j]!.text ||
          (near(i, j) && table[i]![j] === table[i + 1]![j + 1]! + 1))
      )
        break;
      if (i < n && (j === m || table[i + 1]![j]! >= table[i]![j + 1]!)) i++;
      else j++;
    }
    const finishA = a[prefix + i]?.start ?? original.length;
    const finishB = b[prefix + j]?.start ?? corrected.length;
    hunks.push({ startA, finishA, startB, finishB });
  }
  const edits: { before: string; after: string }[] = [];
  for (let index = 0; index < hunks.length; index++) {
    const { startA, startB } = hunks[index]!;
    let { finishA, finishB } = hunks[index]!;
    let last = index;
    for (let next = index + 1; next < Math.min(index + 5, hunks.length); next++) {
      const end = hunks[next]!;
      if (
        linkedWritingEdit(original.slice(startA, end.finishA), corrected.slice(startB, end.finishB))
      ) {
        last = next;
        finishA = end.finishA;
        finishB = end.finishB;
      }
    }
    index = last;
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
