import type { Capture } from './types';
import { htmlText } from './text';

export const WRITING_LIMIT = 6000;
export type FindingKind = 'grammar' | 'vocabulary' | 'style' | 'unclear' | 'typo';
export type PracticeKind = 'correction' | 'gap';
export interface WritingCard {
  kind: PracticeKind;
  question: string;
  target: string;
  answer: string;
  corrected: string;
  hint: string;
  explanation: string;
  tip: string;
}
export interface WritingFinding {
  id: string;
  kind: FindingKind;
  title: string;
  original: string;
  before: string;
  after: string;
  explanation: string;
  tip: string;
  pattern: string;
  selected: boolean;
  dismissed?: boolean;
  format: PracticeKind;
  card?: WritingCard;
  noteId?: number;
  reused?: boolean;
}
export interface WritingSession {
  id: string;
  created: string;
  capture: Capture;
  findings: WritingFinding[];
  summary: string;
  phase: 'idle' | 'analysing' | 'generating' | 'saving' | 'exporting';
  analysed: boolean;
  error: string;
  reviewPath?: string;
  deck: string;
}
const kinds: FindingKind[] = ['grammar', 'vocabulary', 'style', 'unclear', 'typo'];
export const canPractise = (f: WritingFinding) =>
  !f.dismissed && (f.kind === 'grammar' || f.kind === 'vocabulary');
const str = (value: unknown, name: string, max = 2000): string => {
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`Invalid writing ${name}. Try again.`);
  return value.trim();
};
const fragment = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.length > 300) throw new Error(`Invalid writing ${name}.`);
  return value;
};
const unique = (text: string, fragment: string) =>
  !!fragment &&
  text.indexOf(fragment) >= 0 &&
  text.indexOf(fragment, text.indexOf(fragment) + 1) < 0;
export function correctedSentence(f: WritingFinding): string {
  if (!unique(f.original, f.before))
    throw new Error('The highlighted mistake must occur exactly once in its sentence.');
  if (f.before === f.after) throw new Error('The correction must change the highlighted text.');
  return f.original.replace(f.before, () => f.after);
}
/** A label derived from the actual edit cannot inherit an unrelated model-generated lesson title. */
export function writingCorrectionTitle(f: WritingFinding): string {
  const short = (value: string) => (value.length > 60 ? value.slice(0, 57) + '…' : value);
  return `${short(f.before.trim())} → ${short(f.after.trim()) || '(remove)'}`;
}
/** Reject whole-sentence inventions and multiple separate edits in a one-target exercise. */
export function validateWritingTarget(f: WritingFinding) {
  const corrected = correctedSentence(f);
  const words = (text: string) => text.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
  const a = words(f.original),
    b = words(corrected);
  // Word-level edit alignment counts independent changed runs, including case-only changes.
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  let i = 0,
    j = 0,
    runs = 0,
    changing = false,
    shared = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      shared++;
      changing = false;
      i++;
      j++;
    } else {
      if (!changing) {
        runs++;
        changing = true;
      }
      if (i < a.length && (j === b.length || table[i + 1]![j]! >= table[i]![j + 1]!)) i++;
      else j++;
    }
  }
  if (runs > 1)
    throw new Error(
      'A correction changes multiple separate targets. Keep only one issue per finding and recheck the selection.',
    );
  if (a.length >= 3 && shared === 0)
    throw new Error(
      'A correction replaces the entire sentence with unrelated wording. Recheck the selection.',
    );
}
export function minimalCorrection(
  original: string,
  corrected: string,
): { before: string; after: string } {
  let start = 0;
  while (
    start < original.length &&
    start < corrected.length &&
    original[start] === corrected[start]
  )
    start++;
  let endOld = original.length,
    endNew = corrected.length;
  while (endOld > start && endNew > start && original[endOld - 1] === corrected[endNew - 1]) {
    endOld--;
    endNew--;
  }
  while (
    start > 0 &&
    /[\p{L}\p{N}]/u.test(original[start - 1]!) &&
    /[\p{L}\p{N}]/u.test(original[start] ?? corrected[start] ?? '')
  )
    start--;
  while (
    endOld < original.length &&
    endNew < corrected.length &&
    /[\p{L}\p{N}]/u.test(original[endOld]!) &&
    original[endOld] === corrected[endNew]
  ) {
    endOld++;
    endNew++;
  }
  // Insertion-only corrections need a visible original anchor.
  if (start === endOld) {
    while (endOld < original.length && /[\p{L}\p{N}]/u.test(original[endOld]!)) {
      endOld++;
      endNew++;
    }
  }
  if (start === endOld && start > 0) {
    start--;
    while (start > 0 && /[\p{L}\p{N}]/u.test(original[start - 1]!)) start--;
  }
  while (!unique(original, original.slice(start, endOld))) {
    if (start > 0) {
      start--;
      while (start > 0 && /[\p{L}\p{N}]/u.test(original[start - 1]!)) start--;
    } else if (endOld < original.length) {
      endOld++;
      endNew++;
      while (endOld < original.length && /[\p{L}\p{N}]/u.test(original[endOld]!)) {
        endOld++;
        endNew++;
      }
    } else break;
  }
  return { before: original.slice(start, endOld), after: corrected.slice(start, endNew) };
}
export function isolatedQuestion(finding: WritingFinding, others: WritingFinding[]): string {
  const ownStart = finding.original.indexOf(finding.before),
    ownEnd = ownStart + finding.before.length;
  const edits = others
    .filter(
      (f) =>
        f.id !== finding.id &&
        !f.dismissed &&
        canPractise(f) &&
        f.original === finding.original &&
        unique(f.original, f.before),
    )
    .map((f) => ({
      start: f.original.indexOf(f.before),
      end: f.original.indexOf(f.before) + f.before.length,
      after: f.after,
    }))
    .filter((e) => e.end <= ownStart || e.start >= ownEnd)
    .sort((a, b) => b.start - a.start);
  let result = finding.original,
    limit = result.length;
  for (const edit of edits) {
    if (edit.end > limit) continue;
    result = result.slice(0, edit.start) + edit.after + result.slice(edit.end);
    limit = edit.start;
  }
  if (!unique(result, finding.before))
    throw new Error('This exercise needs a more precise highlighted target.');
  return result;
}
export function parseWritingAnalysis(
  raw: string,
  source: string,
  strict = false,
): { summary: string; findings: WritingFinding[] } {
  const data = JSON.parse(raw);
  if (!data || !Array.isArray(data.findings) || data.findings.length > 10)
    throw new Error('Invalid writing analysis. Try a shorter selection.');
  const seen = new Set<string>();
  const findings: WritingFinding[] = [];
  for (const item of data.findings) {
    if (!item || !kinds.includes(item.kind)) throw new Error('Invalid writing finding category.');
    const f: WritingFinding = {
      id: crypto.randomUUID(),
      kind: item.kind,
      title: str(item.title, 'title', 120),
      original: str(item.original_sentence, 'source sentence'),
      before: fragment(item.target_before, 'target'),
      after: fragment(item.target_after, 'correction'),
      explanation: str(item.explanation, 'explanation'),
      tip: str(item.tip, 'tip', 500),
      pattern: str(item.pattern, 'pattern', 300),
      selected: item.kind === 'grammar' || item.kind === 'vocabulary',
      format: item.recommended_format === 'gap' ? 'gap' : 'correction',
    };
    if (!f.title || !f.original || !source.includes(f.original) || !f.explanation)
      throw new Error(
        'A finding does not match the selected text. No unverified findings were accepted; try again.',
      );
    if (f.kind !== 'unclear' && typeof item.corrected_sentence === 'string') {
      const corrected = str(item.corrected_sentence, 'corrected sentence');
      if (corrected === f.original)
        throw new Error('The suggested correction does not change the source.');
      if (strict && (!unique(f.original, f.before) || correctedSentence(f) !== corrected))
        throw new Error(
          'The target replacement and corrected_sentence disagree. Describe exactly one correction without changing other words.',
        );
      const delta = minimalCorrection(f.original, corrected);
      if (!delta.before || delta.before.length > 300 || delta.after.length > 300)
        throw new Error('The correction needs a clearer single target.');
      f.before = delta.before;
      f.after = delta.after;
    }
    if (f.kind !== 'unclear') correctedSentence(f);
    else if (!unique(f.original, f.before))
      throw new Error('The unclear fragment does not match its source sentence.');
    if (strict && f.kind !== 'unclear') validateWritingTarget(f);
    if (strict && f.before !== f.after && f.before.toLowerCase() === f.after.toLowerCase()) {
      f.kind = 'grammar';
      f.selected = true;
    }
    const key = JSON.stringify([f.original, f.before, f.after]);
    if (!seen.has(key)) {
      findings.push(f);
      seen.add(key);
    } else if (f.kind === 'grammar' || f.kind === 'vocabulary') {
      const index = findings.findIndex(
        (old) => old.original === f.original && old.before === f.before && old.after === f.after,
      );
      if (index >= 0 && (findings[index]!.kind === 'style' || findings[index]!.kind === 'typo'))
        findings[index] = f;
    }
  }
  return { summary: str(data.summary, 'summary'), findings };
}
export function parseWritingCard(raw: string, finding: WritingFinding): WritingCard {
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object') throw new Error('Invalid practice card.');
  const card: WritingCard = {
    kind: finding.format,
    question: str(data.question, 'question'),
    target: fragment(data.target, 'target'),
    answer: fragment(data.answer, 'answer'),
    corrected: str(data.corrected_sentence, 'corrected sentence'),
    hint: str(data.hint, 'hint', 500),
    explanation: str(data.explanation, 'explanation'),
    tip: str(data.tip, 'tip', 500),
  };
  if (
    !card.question ||
    (card.kind === 'gap' && !card.answer) ||
    !card.corrected ||
    !card.explanation
  )
    throw new Error('The practice card has empty required fields.');
  if (card.kind === 'gap') {
    if (
      !unique(card.question, '[[gap]]') ||
      card.question.replace('[[gap]]', () => card.answer) !== card.corrected
    )
      throw new Error(
        'The gap and its answer do not reproduce the corrected sentence. Try generating again.',
      );
    if (/[\r\n]/.test(card.answer))
      throw new Error('The typed answer must be a single short expression.');
  } else if (
    card.target !== finding.before ||
    card.answer !== finding.after ||
    !unique(card.question, card.target) ||
    card.question.replace(card.target, () => card.answer) !== card.corrected
  ) {
    throw new Error(
      'The correction card does not test the approved correction. Try generating again.',
    );
  }
  return card;
}
/** Restore snapshots, never restart network operations after a reload. */
export function restoreWritingSessions(value: unknown): WritingSession[] {
  if (!Array.isArray(value)) return [];
  const sessions: WritingSession[] = [];
  for (const s of value.slice(-4)) {
    try {
      if (
        !s ||
        typeof s.id !== 'string' ||
        !s.id ||
        !s.capture ||
        typeof s.capture.selected !== 'string' ||
        !s.capture.selected.trim() ||
        s.capture.selected.length > WRITING_LIMIT ||
        typeof s.capture.file !== 'string' ||
        typeof s.capture.vault !== 'string' ||
        !Array.isArray(s.findings)
      )
        continue;
      const mapped = s.findings.map((f: WritingFinding) => ({
        kind: f.kind,
        title: f.title,
        original_sentence: f.original,
        target_before: f.before,
        target_after: f.after,
        explanation: f.explanation,
        tip: f.tip,
        pattern: f.pattern,
        recommended_format: f.format,
      }));
      const result = parseWritingAnalysis(
        JSON.stringify({ summary: s.summary ?? '', findings: mapped }),
        s.capture.selected,
      );
      result.findings.forEach((f, i) => {
        const old = s.findings.find(
          (old: WritingFinding) =>
            old.original === f.original &&
            old.before === f.before &&
            old.after === f.after &&
            old.kind === f.kind &&
            old.pattern === f.pattern,
        );
        if (!old || typeof old.id !== 'string') return;
        f.id = old.id;
        f.dismissed = old.dismissed === true;
        f.selected = canPractise(f) && old.selected === true;
        if (old.card) {
          try {
            f.card = parseWritingCard(
              JSON.stringify({ ...old.card, corrected_sentence: old.card.corrected }),
              f,
            );
          } catch {
            /* Keep correction, discard an invalid exercise. */
          }
        }
        if (Number.isSafeInteger(old.noteId) && old.noteId > 0) {
          f.noteId = old.noteId;
          f.reused = old.reused === true;
        }
      });
      sessions.push({
        id: s.id,
        created: typeof s.created === 'string' ? s.created : new Date().toISOString(),
        capture: s.capture,
        findings: result.findings,
        summary: result.summary,
        phase: 'idle',
        analysed: s.analysed === true,
        error: '',
        deck: typeof s.deck === 'string' ? s.deck : 'English::Writing mistakes',
        reviewPath: typeof s.reviewPath === 'string' ? s.reviewPath : undefined,
      });
    } catch {
      /* Leave other valid sessions available. */
    }
  }
  return sessions;
}

export function writingPracticeFields(f: WritingFinding): Record<string, string> {
  validateWritingTarget(f);
  if (!f.card) throw new Error('Generate and review the exercise first.');
  const c = parseWritingCard(
    JSON.stringify({ ...f.card, corrected_sentence: f.card.corrected }),
    f,
  );
  const target = c.kind === 'gap' ? '[[gap]]' : c.target;
  const index = c.question.indexOf(target);
  const question =
    htmlText(c.question.slice(0, index)) +
    (c.kind === 'gap' ? '<span class="cc-gap">[…]</span>' : `<mark>${htmlText(target)}</mark>`) +
    htmlText(c.question.slice(index + target.length));
  return {
    Question:
      question +
      (c.hint
        ? `<details class="cc-details"><summary>Hint</summary><div>${htmlText(c.hint)}</div></details>`
        : ''),
    Answer: htmlText(c.answer),
    Corrected: htmlText(c.corrected),
    Explanation: htmlText(c.explanation),
    Tip: htmlText(c.tip),
    Typed: c.kind === 'gap' ? 'yes' : '',
  };
}
