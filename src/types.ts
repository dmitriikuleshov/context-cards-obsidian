import type { WritingSession } from './writing';
export interface CardFields {
  grammar: boolean;
  ipa: 'american' | 'british' | 'off';
  meaningSentences: number;
  generalMeaningSentences: number;
  wordFormation: boolean;
  context: boolean;
  explanationSentences: number;
  examples: boolean;
  maxUsages: number;
  examplesPerUsage: number;
}
export const DEFAULT_FIELDS: CardFields = {
  grammar: true,
  ipa: 'american',
  meaningSentences: 2,
  generalMeaningSentences: 2,
  wordFormation: true,
  context: true,
  explanationSentences: 2,
  examples: true,
  maxUsages: 5,
  examplesPerUsage: 2,
};
export function cardFields(settings?: Partial<Settings>): CardFields {
  return { ...DEFAULT_FIELDS, ...settings?.fields };
}
export interface WritingOptions {
  variant: 'both' | 'american' | 'british';
  grammar: boolean;
  vocabulary: boolean;
  spelling: boolean;
  exercise: 'ai' | 'correction' | 'gap';
}
export const DEFAULT_WRITING: WritingOptions = {
  variant: 'both',
  grammar: true,
  vocabulary: true,
  spelling: true,
  exercise: 'ai',
};
export function writingOptions(settings?: Partial<Settings>): WritingOptions {
  const value = settings?.writing;
  const options = { ...DEFAULT_WRITING };
  if (!value || typeof value !== 'object') return options;
  if (['both', 'american', 'british'].includes(value.variant)) options.variant = value.variant;
  if (['ai', 'correction', 'gap'].includes(value.exercise)) options.exercise = value.exercise;
  for (const key of ['grammar', 'vocabulary', 'spelling'] as const)
    if (typeof value[key] === 'boolean') options[key] = value[key];
  return options;
}
export interface Settings {
  fields: CardFields;
  writing: WritingOptions;
  writingDeck: string;
  writingReviewFolder: string;
  writingNoteType: string;
  ollamaUrl: string;
  model: string;
  temperature: number;
  contextSize: number;
  timeoutSeconds: number;
  ankiUrl: string;
  ankiKey: string;
  rootDeck: string;
  noteType: string;
  defaultTags: string;
  decksByBook: boolean;
  floatingButton: boolean;
  markSourceWord: boolean;
  restoreDrafts: boolean;
  bookDecks: Record<string, string>;
}
export const DEFAULTS: Settings = {
  fields: { ...DEFAULT_FIELDS },
  writing: { ...DEFAULT_WRITING },
  writingDeck: 'English::Writing mistakes',
  writingReviewFolder: 'English/Writing reviews',
  writingNoteType: 'Context Cards Writing',
  ollamaUrl: 'http://127.0.0.1:11434',
  model: 'qwen3.5:9b-q4_K_M',
  temperature: 0.2,
  contextSize: 1800,
  timeoutSeconds: 60,
  ankiUrl: 'http://127.0.0.1:8765',
  ankiKey: '',
  rootDeck: 'English::Books',
  noteType: 'Context Cards',
  defaultTags: 'context-cards',
  decksByBook: true,
  floatingButton: true,
  markSourceWord: false,
  restoreDrafts: true,
  bookDecks: {},
};
export interface Capture {
  text: string;
  start: number;
  end: number;
  selected: string;
  file: string;
  book: string;
  vault: string;
  mode: 'reading' | 'editor' | 'manual';
}
export const EXAMPLE_COUNT = 5;
// Node timers use a signed 32-bit millisecond delay.
export const MAX_TIMEOUT_SECONDS = Math.floor(2_147_483_647 / 1000);
export function validTimeoutSeconds(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_TIMEOUT_SECONDS
  );
}
export const MAX_DRAFTS = 4;
export interface Content {
  status: 'ready' | 'ambiguous' | 'unknown';
  expression: string;
  partOfSpeech: string;
  americanIpa: string;
  ipaVariant?: 'american' | 'british';
  meaning: string;
  generalMeaning?: string;
  wordFormation?: string;
  explanation: string;
  exampleGroups?: { meaning: string; examples: string[] }[];
  examples: string[];
  notes: string[];
  question: string;
}
export interface Draft extends Content {
  id: string;
  created: string;
  capture: Capture;
  context: string;
  answer: string;
  answerStart: number;
  deck: string;
  tags: string;
  phase: 'editing' | 'generating' | 'sending' | 'saved';
  error: string;
  seconds?: number;
  noteId?: number;
  duplicates?: number[];
  allowDuplicate: boolean;
  revision: number;
  pendingContent?: Content;
  pendingSource?: { context: string; answer: string };
}
export interface StoredData {
  settings: Settings;
  drafts: Draft[];
  writingSessions?: WritingSession[];
}
export function emptyContent(): Content {
  return {
    status: 'ready',
    expression: '',
    partOfSpeech: '',
    americanIpa: '',
    meaning: '',
    explanation: '',
    examples: Array(EXAMPLE_COUNT).fill(''),
    notes: [],
    question: '',
  };
}
