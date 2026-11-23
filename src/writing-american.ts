// Unambiguous regional spelling pairs. This is a policy check on an existing,
// grounded proposal, not a rule that searches/replaces arbitrary source text.
const spellings = new Map([
  ['colour', 'color'],
  ['colours', 'colors'],
  ['coloured', 'colored'],
  ['colouring', 'coloring'],
  ['favour', 'favor'],
  ['favours', 'favors'],
  ['favourite', 'favorite'],
  ['flavour', 'flavor'],
  ['flavours', 'flavors'],
  ['behaviour', 'behavior'],
  ['honour', 'honor'],
  ['labour', 'labor'],
  ['neighbour', 'neighbor'],
  ['neighbours', 'neighbors'],
  ['centre', 'center'],
  ['centres', 'centers'],
  ['metre', 'meter'],
  ['metres', 'meters'],
  ['defence', 'defense'],
  ['offence', 'offense'],
  ['licence', 'license'],
  ['licences', 'licenses'],
  ['practise', 'practice'],
  ['practises', 'practices'],
  ['practised', 'practiced'],
  ['practising', 'practicing'],
  ['analyse', 'analyze'],
  ['analysed', 'analyzed'],
  ['analysing', 'analyzing'],
  ['organise', 'organize'],
  ['organised', 'organized'],
  ['organising', 'organizing'],
]);

/** A regional preference is required under the app's American-English policy. */
export function americanSpellingPolicy(original: string, before: string, after: string) {
  if (spellings.get(after) === before && original.includes(before)) return 'preserve';
  if (spellings.get(before) !== after) return undefined;
  const index = original.indexOf(before);
  if (index < 0) return undefined;
  // Preserve literal mentions/identifiers. Capitalized names are excluded by the
  // case-sensitive spelling table rather than being silently renamed.
  const quotePairs: Record<string, string> = { "'": "'", '"': '"', '‘': '’', '“': '”' };
  const closing = quotePairs[original[index - 1]!];
  if (closing && original[index + before.length] === closing) return 'preserve';
  for (const code of original.matchAll(/`[^`]*`/g))
    if (index > code.index && index < code.index + code[0].length) return 'preserve';
  return 'normalize';
}
