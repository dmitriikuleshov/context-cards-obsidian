const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const doForms = new Set(['do', 'does', 'did']);
// Identity of common irregular verb forms is used only for alignment. No spelling
// or grammatical correction is produced from this table.
const irregular: Record<string, string> = {
  went: 'go',
  gone: 'go',
  knew: 'know',
  known: 'know',
  understood: 'understand',
  wrote: 'write',
  written: 'write',
  had: 'have',
  saw: 'see',
  seen: 'see',
  took: 'take',
  taken: 'take',
  came: 'come',
  got: 'get',
  gotten: 'get',
  gave: 'give',
  given: 'give',
  made: 'make',
  said: 'say',
  spoke: 'speak',
  spoken: 'speak',
  thought: 'think',
  bought: 'buy',
  brought: 'bring',
  found: 'find',
  felt: 'feel',
  left: 'leave',
  met: 'meet',
  ran: 'run',
  stood: 'stand',
  kept: 'keep',
  paid: 'pay',
  heard: 'hear',
  wore: 'wear',
  worn: 'wear',
  won: 'win',
  lost: 'lose',
  held: 'hold',
};
const subjects: Record<string, string> = {
  me: 'i',
  him: 'he',
  her: 'she',
  us: 'we',
  them: 'they',
  you: 'you',
};
function inflections(word: string) {
  return new Set(
    [
      word,
      irregular[word] ?? word,
      word.replace(/(?:s|es|ed|ing)$/, ''),
      word.replace(/d$/, ''),
      word.replace(/(?:ies|ied)$/, 'y'),
    ].filter((w) => w.length >= 3),
  );
}
function sameVerbForm(a: string, b: string) {
  const candidates = inflections(b);
  return [...inflections(a)].some((word) => candidates.has(word));
}

/** Recognize one bounded grammatical restructuring, rather than unrelated fixes. */
export function linkedWritingEdit(before: string, after: string) {
  const a = words(before),
    b = words(after);
  if (before.length > 120 || after.length > 120 || a.length > 10 || b.length > 10) return false;
  // Relocating existing words (including a preposition inserted to place a receiver).
  const plainA = a.filter((w) => w !== 'to'),
    plainB = b.filter((w) => w !== 'to');
  if (
    plainA.length >= 2 &&
    plainA.length === plainB.length &&
    [...plainA].sort().join('|') === [...plainB].sort().join('|') &&
    plainA.join('|') !== plainB.join('|')
  )
    return true;
  // Do-support and the corresponding verb inflection form one question/inversion rule.
  const coreA = a.filter((w) => !doForms.has(w)),
    coreB = b.filter((w) => !doForms.has(w));
  if (
    a.length - coreA.length !== b.length - coreB.length &&
    coreA.length &&
    coreA.length === coreB.length
  ) {
    const available = [...coreB];
    let changes = 0;
    for (const word of coreA) {
      let at = available.indexOf(word);
      if (at < 0) {
        at = available.findIndex((other) => sameVerbForm(word, other));
        changes++;
      }
      if (at < 0 || changes > 1) return false;
      available.splice(at, 1);
    }
    return true;
  }
  return (
    a.length === 2 && b.length === 2 && a[1] === 'to' && b[0] === 'that' && subjects[a[0]!] === b[1]
  );
}
