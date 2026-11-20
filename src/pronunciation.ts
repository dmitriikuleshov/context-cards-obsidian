// CMUdict US pronunciations, converted to broad IPA. See data/CMUDICT-LICENSE.txt.
import raw from '../data/cmudict.json';
const dictionary = raw as Record<string, string[]>;
const phones: Record<string, string> = {
  AA: 'ɑ',
  AE: 'æ',
  AH: 'ʌ',
  AO: 'ɔ',
  AW: 'aʊ',
  AY: 'aɪ',
  B: 'b',
  CH: 'tʃ',
  D: 'd',
  DH: 'ð',
  EH: 'ɛ',
  ER: 'ɝ',
  EY: 'eɪ',
  F: 'f',
  G: 'ɡ',
  HH: 'h',
  IH: 'ɪ',
  IY: 'iː',
  JH: 'dʒ',
  K: 'k',
  L: 'l',
  M: 'm',
  N: 'n',
  NG: 'ŋ',
  OW: 'oʊ',
  OY: 'ɔɪ',
  P: 'p',
  R: 'ɹ',
  S: 's',
  SH: 'ʃ',
  T: 't',
  TH: 'θ',
  UH: 'ʊ',
  UW: 'uː',
  V: 'v',
  W: 'w',
  Y: 'j',
  Z: 'z',
  ZH: 'ʒ',
};
const onsets = new Set([
  'B L',
  'B R',
  'D R',
  'F L',
  'F R',
  'G L',
  'G R',
  'K L',
  'K R',
  'K W',
  'P L',
  'P R',
  'T R',
  'T W',
  'TH R',
  'SH R',
  'S K',
  'S L',
  'S M',
  'S N',
  'S P',
  'S T',
  'S W',
  'S K L',
  'S K R',
  'S K W',
  'S P L',
  'S P R',
  'S T R',
  'K Y',
  'G Y',
  'P Y',
  'B Y',
  'F Y',
  'V Y',
  'M Y',
  'HH Y',
  'S K Y',
]);
export function arpabetToIpa(value: string): string {
  const tokens = value.split(/\s+/),
    vowels = tokens.filter((t) => /\d$/.test(t)).length;
  const marks = new Map<number, string>();
  if (vowels > 1)
    for (let i = 0; i < tokens.length; i++) {
      const stress = tokens[i]!.at(-1);
      if (stress !== '1' && stress !== '2') continue;
      let first = i;
      while (first > 0 && !/\d$/.test(tokens[first - 1]!)) first--;
      let start = i;
      for (let j = first; j < i; j++)
        if ((i - j === 1 && tokens[j] !== 'NG') || onsets.has(tokens.slice(j, i).join(' '))) {
          start = j;
          break;
        }
      marks.set(start, stress === '1' ? 'ˈ' : 'ˌ');
    }
  return tokens
    .map((token, i) => {
      const base = token.replace(/\d$/, '');
      const sound =
        token === 'AH0' ? 'ə' : token === 'ER0' ? 'ɚ' : token === 'IY0' ? 'i' : phones[base];
      if (!sound) throw new Error(`Unsupported pronunciation phone: ${token}`);
      return (marks.get(i) ?? '') + sound;
    })
    .join('');
}
export function americanPronunciations(expression: string): string[] {
  const words = expression.toLowerCase().replace(/[’]/g, "'").trim().split(/\s+/);
  if (words.length > 12) return [];
  let combinations = [''];
  for (const word of words) {
    const entries = Object.hasOwn(dictionary, word) ? dictionary[word] : undefined;
    if (!entries?.length) return [];
    const variants = [...new Set(entries.map(arpabetToIpa))];
    combinations = combinations
      .flatMap((prefix) => variants.map((v) => `${prefix} ${v}`.trim()))
      .slice(0, 8);
  }
  return [...new Set(combinations)].map((v) => `/${v}/`);
}
