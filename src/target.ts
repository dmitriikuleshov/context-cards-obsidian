import type { Capture, Draft } from './types';

export const MAX_TARGET_LENGTH = 240;
export const MAX_VOCABULARY_SELECTION = 6000;

/** A reason to ask, never a linguistic rule rejecting long idioms or constructions. */
export function reviewTarget(text: string): boolean {
  text = text.trim();
  const words = [...new Intl.Segmenter('en', { granularity: 'word' }).segment(text)].filter(
    (part) => part.isWordLike,
  ).length;
  return (
    text.length > MAX_TARGET_LENGTH ||
    words > 8 ||
    /\S\s*\n\s*\S/u.test(text) ||
    (words > 3 &&
      [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)].filter((part) =>
        /[\p{L}\p{N}]/u.test(part.segment),
      ).length > 1)
  );
}

/** Retain the book snapshot and the exact occurrence, including repeated words. */
export function narrowTarget(capture: Capture, start: number, end: number): Capture | null {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > capture.selected.length ||
    end <= start
  )
    return null;
  const raw = capture.selected.slice(start, end),
    selected = raw.trim();
  if (!selected || selected.length > MAX_TARGET_LENGTH) return null;
  const offset = capture.start + start + raw.length - raw.trimStart().length;
  return { ...capture, selected, start: offset, end: offset + selected.length };
}

export class TargetSelectionError extends Error {
  constructor(passage = false) {
    super(
      passage
        ? 'This selection looks like a passage rather than one word or expression. Choose the part you want to learn.'
        : 'The model did not analyse the whole selected expression. Choose the word or phrase you want to learn, or try generating again.',
    );
  }
}

/** Older passage drafts also need confirmation before they can reach Anki. */
export function needsTargetValidation(
  draft: Pick<Draft, 'answer' | 'targetNeedsReview' | 'targetValidated'>,
): boolean {
  return (
    !!draft.targetNeedsReview ||
    (draft.targetValidated !== draft.answer && reviewTarget(draft.answer))
  );
}

/** Verify the model's quoted learning target before accepting any definitions. */
export function verifyTarget(target: string, raw: Record<string, unknown>): void {
  if (raw.target_is_single_item === false) throw new TargetSelectionError(true);
  if (raw.status !== 'ready') return;
  const normalized = (value: string) => value.trim().replace(/\s+/gu, ' ');
  if (
    raw.target_is_single_item !== true ||
    typeof raw.target_source_form !== 'string' ||
    normalized(raw.target_source_form) !== normalized(target)
  )
    throw new TargetSelectionError();
}
