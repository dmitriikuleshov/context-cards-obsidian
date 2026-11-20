import {
  DEFAULTS,
  DEFAULT_FIELDS,
  EXAMPLE_COUNT,
  MAX_DRAFTS,
  emptyContent,
  type Capture,
  type Content,
  type Draft,
  type Settings,
  type StoredData,
} from './types';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function content(value: Record<string, unknown>): Content {
  const result = emptyContent();
  for (const key of [
    'expression',
    'partOfSpeech',
    'americanIpa',
    'meaning',
    'explanation',
    'question',
  ] as const)
    if (typeof value[key] === 'string') result[key] = value[key];
  if (['ready', 'ambiguous', 'unknown'].includes(String(value.status)))
    result.status = value.status as Content['status'];
  if (typeof value.generalMeaning === 'string') result.generalMeaning = value.generalMeaning;
  if (value.ipaVariant === 'american' || value.ipaVariant === 'british')
    result.ipaVariant = value.ipaVariant;
  if (typeof value.wordFormation === 'string') result.wordFormation = value.wordFormation;
  if (strings(value.examples)) {
    const examples = value.examples;
    result.examples = Array.from({ length: EXAMPLE_COUNT }, (_, i) => examples[i] ?? '');
  }
  if (
    Array.isArray(value.exampleGroups) &&
    value.exampleGroups.length >= 1 &&
    value.exampleGroups.length <= 5 &&
    value.exampleGroups.every(
      (g) =>
        record(g) &&
        typeof g.meaning === 'string' &&
        strings(g.examples) &&
        g.examples.length >= 1 &&
        g.examples.length <= 10,
    )
  ) {
    result.exampleGroups = value.exampleGroups.map((g: any) => ({
      meaning: g.meaning,
      examples: [...g.examples],
    }));
    result.examples = result.exampleGroups!.flatMap((g) => g.examples);
  }
  if (strings(value.notes)) result.notes = value.notes;
  return result;
}
function settings(value: unknown): Settings {
  const result = structuredClone(DEFAULTS);
  if (!record(value)) return result;
  for (const key of [
    'ollamaUrl',
    'model',
    'ankiUrl',
    'ankiKey',
    'rootDeck',
    'noteType',
    'defaultTags',
  ] as const)
    if (typeof value[key] === 'string') result[key] = value[key];
  for (const key of ['decksByBook', 'floatingButton', 'restoreDrafts', 'markSourceWord'] as const)
    if (typeof value[key] === 'boolean') result[key] = value[key];
  for (const [key, min, max] of [
    ['temperature', 0, 2],
    ['contextSize', 1000, 6000],
    ['timeoutSeconds', 10, 300],
  ] as const)
    if (finite(value[key]) && value[key] >= min && value[key] <= max) result[key] = value[key];
  if (record(value.fields)) {
    const f = value.fields;
    for (const key of ['grammar', 'wordFormation', 'context', 'examples'] as const)
      if (typeof f[key] === 'boolean') result.fields[key] = f[key];
    if (['american', 'british', 'off'].includes(String(f.ipa)))
      result.fields.ipa = f.ipa as typeof DEFAULT_FIELDS.ipa;
    for (const key of [
      'meaningSentences',
      'generalMeaningSentences',
      'explanationSentences',
      'maxUsages',
      'examplesPerUsage',
    ] as const) {
      const min = key.endsWith('Sentences') ? 0 : 1;
      const max = key === 'maxUsages' ? 5 : 10;
      if (finite(f[key]) && Number.isInteger(f[key]) && f[key] >= min && f[key] <= max)
        result.fields[key] = f[key];
    }
  }
  if (record(value.bookDecks))
    result.bookDecks = Object.fromEntries(
      Object.entries(value.bookDecks).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim(),
      ),
    );
  return result;
}
function capture(value: unknown): value is Capture {
  return (
    record(value) &&
    ['text', 'selected', 'file', 'book', 'vault'].every((k) => typeof value[k] === 'string') &&
    finite(value.start) &&
    finite(value.end) &&
    Number.isInteger(value.start) &&
    Number.isInteger(value.end) &&
    value.start >= 0 &&
    value.end > value.start &&
    value.end <= (value.text as string).length &&
    (value.text as string).slice(value.start, value.end) === value.selected
  );
}
/** Restore only valid local data. Network work is never resumed automatically on startup. */
export function restoreData(value: unknown): StoredData & { skipped: number } {
  const raw = record(value) ? value : {},
    config = settings(raw.settings),
    drafts: Draft[] = [];
  let skipped = 0;
  if (config.restoreDrafts && Array.isArray(raw.drafts))
    for (const item of raw.drafts) {
      if (
        !record(item) ||
        typeof item.id !== 'string' ||
        !item.id ||
        typeof item.context !== 'string' ||
        typeof item.answer !== 'string' ||
        !capture(item.capture)
      ) {
        skipped++;
        continue;
      }
      const source = {
        ...item.capture,
        mode: ['reading', 'editor', 'manual'].includes(item.capture.mode)
          ? item.capture.mode
          : 'manual',
      } as Capture;
      const d: Draft = {
        ...content(item),
        id: item.id,
        created: typeof item.created === 'string' ? item.created : new Date().toISOString(),
        capture: source,
        context: item.context,
        answer: item.answer,
        answerStart:
          finite(item.answerStart) && Number.isInteger(item.answerStart) ? item.answerStart : -1,
        deck: typeof item.deck === 'string' ? item.deck : config.rootDeck,
        tags: typeof item.tags === 'string' ? item.tags : config.defaultTags,
        phase:
          item.phase === 'saved' && finite(item.noteId) && item.noteId > 0 ? 'saved' : 'editing',
        error: '',
        allowDuplicate: item.allowDuplicate === true,
        revision: finite(item.revision) ? item.revision : 0,
      };
      if (finite(item.noteId) && item.noteId > 0) d.noteId = item.noteId;
      if (finite(item.seconds)) d.seconds = item.seconds;
      if (record(item.pendingContent)) d.pendingContent = content(item.pendingContent);
      drafts.push(d);
    }
  return { settings: config, drafts: drafts.slice(-MAX_DRAFTS), skipped };
}
