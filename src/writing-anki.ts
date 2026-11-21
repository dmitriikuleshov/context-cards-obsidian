import { createHash } from 'node:crypto';
import { Anki, searchQuote } from './anki';
import { CARD_CSS } from './templates';
import { escapeHtml, htmlText, parseTags } from './text';
import { writingPracticeFields, type WritingFinding } from './writing';
import type { Settings } from './types';

export const WRITING_FIELDS = [
  'Key',
  'PatternKey',
  'Question',
  'Answer',
  'Corrected',
  'Explanation',
  'Tip',
  'Source',
  'Typed',
];
export const WRITING_TEMPLATE = {
  Name: 'Practice',
  Front:
    '<div class="cc-card"><div class="cc-eyebrow">{{#Typed}}Complete the sentence{{/Typed}}{{^Typed}}Correct the highlighted part{{/Typed}}</div><div class="cc-context">{{Question}}</div>{{#Typed}}<div class="cc-label">Your answer</div>{{type:Answer}}{{/Typed}}</div>',
  Back: '{{FrontSide}}<hr id="answer"><div class="cc-card"><div class="cc-meaning">{{Answer}}</div><div class="cc-context">{{Corrected}}</div><div class="cc-label">Why</div><div>{{Explanation}}</div>{{#Tip}}<div class="cc-label">Remember</div><div>{{Tip}}</div>{{/Tip}}<div class="cc-source">{{Source}}</div></div>',
};
export function writingPatternKey(f: WritingFinding): string {
  return createHash('sha256')
    .update(
      [f.kind, f.pattern, f.before, f.after]
        .map((s) => s.toLowerCase().trim().replace(/\s+/g, ' '))
        .join('|'),
    )
    .digest('hex');
}
export function writingNoteFields(f: WritingFinding, reviewUri: string): Record<string, string> {
  const practice = writingPracticeFields(f);
  return {
    ...practice,
    Key: `writing-${f.id}`,
    PatternKey: writingPatternKey(f),
    Source: `<a href="${escapeHtml(reviewUri)}">Open writing review</a>`,
  };
}
export class WritingAnki {
  private api: Anki;
  constructor(private settings: Settings) {
    this.api = new Anki(settings);
  }
  async add(
    finding: WritingFinding,
    deck: string,
    uri: string,
  ): Promise<{ noteId: number; existing: boolean }> {
    const model = this.settings.writingNoteType.trim();
    if (!model || model === this.settings.noteType.trim())
      throw new Error(
        'Choose a separate writing note type, different from the vocabulary note type.',
      );
    const fields = writingNoteFields(finding, uri);
    const query = `note:${searchQuote(model)} (Key:${searchQuote(fields.Key!)} or PatternKey:${searchQuote(fields.PatternKey!)})`;
    const existing = () => this.api.action<number[]>('findNotes', { query });
    let found = await existing();
    if (found.length) return { noteId: found[0]!, existing: true };
    const names = await this.api.action<string[]>('modelNames');
    if (!names.includes(model))
      await this.api.action('createModel', {
        modelName: model,
        inOrderFields: WRITING_FIELDS,
        css: CARD_CSS,
        cardTemplates: [WRITING_TEMPLATE],
      });
    else {
      const stored = await this.api.action<string[]>('modelFieldNames', { modelName: model });
      const templates = await this.api.action<Record<string, unknown>>('modelTemplates', {
        modelName: model,
      });
      if (
        stored[0] !== 'Key' ||
        WRITING_FIELDS.some((f) => !stored.includes(f)) ||
        Object.keys(templates).length !== 1
      )
        throw new Error(
          'The writing note type is incompatible. Choose a new writing note type name in settings.',
        );
    }
    await this.api.action('createDeck', { deck });
    try {
      const noteId = await this.api.action<number>('addNote', {
        note: {
          deckName: deck,
          modelName: model,
          fields,
          tags: parseTags(`${this.settings.defaultTags} writing`),
          options: { allowDuplicate: false },
        },
      });
      if (!Number.isSafeInteger(noteId) || noteId <= 0)
        throw new Error('Anki did not return a writing note ID.');
      return { noteId, existing: false };
    } catch (error) {
      try {
        found = await existing();
        if (found.length) return { noteId: found[0]!, existing: true };
      } catch {
        /* Preserve original failure. */
      }
      throw error;
    }
  }
}
