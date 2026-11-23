/** Protect explicitly literal data without hiding ordinary dialogue or nearby prose. */
export function protectedWritingLiteral(original: string, before: string, after: string) {
  const at = original.indexOf(before);
  if (at < 0) return false;
  const literalContext =
    /\b(?:literals?|labels?|variables?|identifiers?|strings?|printed|code|test data)\b/i.test(
      original,
    );
  let prefix = 0,
    tail = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix++;
  while (
    tail < before.length - prefix &&
    tail < after.length - prefix &&
    before[before.length - tail - 1] === after[after.length - tail - 1]
  )
    tail++;
  const start = at + prefix,
    end = at + before.length - tail;
  const pattern =
    /`[^`]*`|(?<![\p{L}\p{N}])(['"])[\s\S]*?\1(?![\p{L}\p{N}])|“[\s\S]*?”(?![\p{L}\p{N}])|‘[\s\S]*?’(?![\p{L}\p{N}])/gu;
  for (const match of original.matchAll(pattern)) {
    const value = match[0];
    if (!value.startsWith('`') && !literalContext) continue;
    const left = match.index,
      right = left + value.length;
    if (start >= right || end <= left) continue;
    // A grammar target may span an unchanged identifier, e.g. a question about `foo`.
    if (before.includes(value) && after.split(value).length >= before.split(value).length) continue;
    return true;
  }
  return false;
}
