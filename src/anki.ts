import { endpoint, jsonRequest } from './http';
import {
  FIELDS,
  CARD_CSS,
  TEMPLATES,
  noteFields,
  metadataHtml,
  generalMeaningHtml,
  wordFormationHtml,
  optionalFieldBlocks,
} from './templates';
import { htmlText, parseTags } from './text';
import type { Draft, Settings } from './types';

export interface AnkiNote {
  noteId: number;
  fields: Record<string, { value: string }>;
  cards: number[];
}
export function searchQuote(value: string): string {
  return `"${value.replace(/[\\"*_]/g, '\\$&')}"`;
}
export class DuplicateError extends Error {
  constructor(public ids: number[]) {
    super(
      'This expression is already in Anki. Review the existing notes or allow a different sense.',
    );
  }
}
export class Anki {
  private settings: Settings;
  constructor(settings: Settings) {
    this.settings = { ...settings, noteType: settings.noteType.trim() };
  }
  async action<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const response = await jsonRequest<{ result: T; error: string | null }>(
      endpoint(this.settings.ankiUrl),
      {
        action,
        version: 6,
        params,
        ...(this.settings.ankiKey ? { key: this.settings.ankiKey } : {}),
      },
      undefined,
      12000,
    );
    if (
      !response ||
      !Object.hasOwn(response, 'result') ||
      !Object.hasOwn(response, 'error') ||
      response.error
    )
      throw new Error(response?.error || 'Invalid response from AnkiConnect.');
    return response.result;
  }
  async decks(): Promise<string[]> {
    return this.action('deckNames');
  }
  async ensureModel(): Promise<void> {
    const names = await this.action<string[]>('modelNames');
    if (!names.includes(this.settings.noteType)) {
      await this.action('createModel', {
        modelName: this.settings.noteType,
        inOrderFields: FIELDS,
        css: CARD_CSS,
        cardTemplates: TEMPLATES,
      });
      return;
    }
    const fields = await this.action<string[]>('modelFieldNames', {
      modelName: this.settings.noteType,
    });
    const addedFields = ['PartOfSpeech', 'AmericanIPA', 'GeneralMeaning', 'WordFormation'];
    if (
      fields[0] !== 'Key' ||
      FIELDS.filter((f) => !addedFields.includes(f)).some((field) => !fields.includes(field))
    )
      throw new Error(
        `The note type “${this.settings.noteType}” has incompatible fields. Keep Key as the first field, or choose a new name in settings.`,
      );
    const templates = await this.action<Record<string, { Front: string; Back: string }>>(
      'modelTemplates',
      {
        modelName: this.settings.noteType,
      },
    );
    if (
      Object.keys(templates).length !== 2 ||
      !templates.Recognition ||
      !templates.Recall ||
      Object.values(templates).some(
        (t) => typeof t.Front !== 'string' || typeof t.Back !== 'string',
      )
    )
      throw new Error(
        'This note type does not have the expected two card templates. Choose a new note type name.',
      );
    // Add fields without removing notes, changing field order, or touching schedules.
    for (const fieldName of addedFields)
      if (!fields.includes(fieldName))
        await this.action('modelFieldAdd', { modelName: this.settings.noteType, fieldName });
    const updates: Record<string, { Front: string; Back: string }> = {};
    for (const [name, template] of Object.entries(templates)) {
      const grammar = !template.Back.includes('{{PartOfSpeech}}'),
        ipa = !template.Back.includes('{{AmericanIPA}}');
      let back = template.Back;
      if (grammar || ipa) back = metadataHtml(grammar, ipa) + back;
      if (!back.includes('{{GeneralMeaning}}')) {
        const explanation = '<div>{{Explanation}}</div>';
        back = back.includes(explanation)
          ? back.replace(
              explanation,
              generalMeaningHtml() + '<div class="cc-label">Explanation</div>' + explanation,
            )
          : back + generalMeaningHtml();
      }
      if (!back.includes('{{WordFormation}}')) {
        const marker = '{{/GeneralMeaning}}';
        back = back.includes(marker)
          ? back.replace(marker, marker + wordFormationHtml())
          : back + wordFormationHtml();
      }
      back = optionalFieldBlocks(back);
      const front = optionalFieldBlocks(template.Front);
      if (back !== template.Back || front !== template.Front)
        updates[name] = { Front: front, Back: back };
    }
    if (Object.keys(updates).length)
      await this.action('updateModelTemplates', {
        model: { name: this.settings.noteType, templates: updates },
      });
  }
  async byKey(key: string): Promise<number[]> {
    return this.action('findNotes', {
      query: `note:${searchQuote(this.settings.noteType)} Key:${searchQuote(key)}`,
    });
  }
  async duplicates(expression: string): Promise<number[]> {
    const ids = await this.action<number[]>('findNotes', {
      query: `note:${searchQuote(this.settings.noteType)} Expression:${searchQuote(htmlText(expression.trim()))}`,
    });
    // Restrict the search first, then verify literal values before warning about duplicates.
    const matches: number[] = [];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const notes = await this.action<AnkiNote[]>('notesInfo', {
        notes: ids.slice(offset, offset + 500),
      });
      const normalized = htmlText(expression.trim()).toLocaleLowerCase('en');
      for (const note of notes)
        if (note.fields.Expression?.value.trim().toLocaleLowerCase('en') === normalized)
          matches.push(note.noteId);
    }
    return matches;
  }
  async add(draft: Draft): Promise<number> {
    if (!this.settings.noteType.trim())
      throw new Error('Choose an Anki note type name in Context Cards settings.');
    // An immutable draft key makes retries safe even if a previous add timed out.
    let found = await this.byKey(draft.id);
    if (found.length) return found[0]!;
    await this.ensureModel();
    const duplicates = await this.duplicates(draft.expression);
    if (duplicates.length && !draft.allowDuplicate) throw new DuplicateError(duplicates);
    await this.action('createDeck', { deck: draft.deck });
    try {
      const id = await this.action<number>('addNote', {
        note: {
          deckName: draft.deck,
          modelName: this.settings.noteType,
          fields: noteFields(draft, this.settings),
          tags: parseTags(draft.tags),
          options: { allowDuplicate: false },
        },
      });
      if (!id) throw new Error('Anki did not return a note ID.');
      return id;
    } catch (error) {
      try {
        found = await this.byKey(draft.id);
        if (found.length) return found[0]!;
      } catch {
        /* preserve original error */
      }
      throw error;
    }
  }
  async open(ids: number[]): Promise<void> {
    await this.action('guiBrowse', { query: ids.map((id) => `nid:${id}`).join(' or ') });
  }
}
