import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Anki, DuplicateError, searchQuote } from '../src/anki';
import { DEFAULTS, type Draft, type Settings } from '../src/types';
import { createDraft } from '../src/text';
import { FIELDS, TEMPLATES } from '../src/templates';

interface StoredNote {
  id: number;
  fields: Record<string, string>;
  deckName: string;
  modelName: string;
  tags: string[];
}
describe('AnkiConnect integration with an isolated HTTP server', () => {
  let server: Server,
    settings: Settings,
    notes: StoredNote[],
    calls: Array<{ action: string; params: any; key?: string }>,
    models: string[],
    loseResponse: boolean;
  let modelFields: string[], modelTemplates: Record<string, { Front: string; Back: string }>;
  function draft(): Draft {
    const d = createDraft(
      {
        text: 'She brushed off the warning.',
        start: 4,
        end: 15,
        selected: 'brushed off',
        file: 'Book.md',
        book: 'Book',
        vault: 'Test',
        mode: 'editor',
      },
      settings,
    );
    Object.assign(d, {
      expression: 'brush off',
      partOfSpeech: 'phrasal verb',
      americanIpa: '/bɹʌʃ ɔf/',
      meaning: 'dismiss something without considering it',
      generalMeaning: 'A general definition. A broader clarification.',
      explanation: 'She dismissed the warning.',
      examples: [
        'He brushed off my advice.',
        'They brushed off the complaint.',
        'She brushed off the criticism.',
        'We brushed off his suggestion.',
        'They brushed off our complaints.',
      ],
      tags: 'english books::test english',
    });
    return d;
  }
  beforeEach(async () => {
    notes = [];
    calls = [];
    models = [];
    modelFields = [...FIELDS];
    modelTemplates = Object.fromEntries(
      TEMPLATES.map((t) => [t.Name, { Front: t.Front, Back: t.Back }]),
    );
    loseResponse = false;
    server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const call = JSON.parse(body);
      calls.push(call);
      let result: any = null,
        error: string | null = null;
      const p = call.params;
      switch (call.action) {
        case 'modelNames':
          result = models;
          break;
        case 'createModel':
          models.push(p.modelName);
          result = {};
          break;
        case 'modelFieldNames':
          result = modelFields;
          break;
        case 'modelTemplates':
          result = modelTemplates;
          break;
        case 'modelFieldAdd':
          modelFields.push(p.fieldName);
          result = null;
          break;
        case 'updateModelTemplates':
          Object.assign(modelTemplates, p.model.templates);
          result = null;
          break;
        case 'createDeck':
          result = 1;
          break;
        case 'findNotes': {
          if (p.query.includes('Key:')) {
            const key = p.query.match(/Key:"([^"]+)"/)?.[1];
            result = notes.filter((n) => n.fields.Key === key).map((n) => n.id);
          } else result = notes.map((n) => n.id); // Deliberate over-match: the client must verify exact fields.
          break;
        }
        case 'notesInfo':
          result = notes
            .filter((n) => p.notes.includes(n.id))
            .map((n) => ({
              noteId: n.id,
              cards: [n.id + 1, n.id + 2],
              fields: Object.fromEntries(
                Object.entries(n.fields).map(([k, v]) => [k, { value: v }]),
              ),
            }));
          break;
        case 'addNote': {
          if (notes.some((n) => n.fields.Key === p.note.fields.Key))
            error = 'cannot create note because it is a duplicate';
          else {
            const id = 1000 + notes.length;
            notes.push({ ...p.note, id });
            result = id;
          }
          if (loseResponse) {
            req.socket.destroy();
            return;
          }
          break;
        }
        case 'guiBrowse':
          result = [];
          break;
        default:
          error = `Unexpected action: ${call.action}`;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ result, error }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    settings = {
      ...structuredClone(DEFAULTS),
      ankiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      ankiKey: 'local-test-key',
    };
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });
  it('adds metadata to an older note type without replacing custom templates or duplicating fields', async () => {
    models = [settings.noteType];
    modelFields = FIELDS.filter(
      (f) => !['PartOfSpeech', 'AmericanIPA', 'GeneralMeaning', 'WordFormation'].includes(f),
    );
    modelTemplates = {
      Recognition: { Front: 'custom front {{Expression}}', Back: 'custom answer {{Explanation}}' },
      Recall: { Front: 'custom gap {{GapContext}}', Back: 'custom recall {{SourceForm}}' },
    };
    const originalFront = modelTemplates.Recall!.Front;
    const client = new Anki(settings);
    await client.ensureModel();
    await client.ensureModel();
    expect(modelFields).toEqual(FIELDS);
    expect(modelTemplates.Recall!.Front).toBe(originalFront);
    expect(modelTemplates.Recall!.Back).toContain('custom recall {{SourceForm}}');
    expect(modelTemplates.Recall!.Back.match(/{{AmericanIPA}}/g)).toHaveLength(1);
    expect(calls.filter((c) => c.action === 'modelFieldAdd')).toHaveLength(4);
    expect(calls.filter((c) => c.action === 'updateModelTemplates')).toHaveLength(1);
    expect(notes).toHaveLength(0);
  });
  it('creates one note with both templates, exact source answer, destination and deduplicated tags', async () => {
    const d = draft();
    expect(await new Anki(settings).add(d)).toBe(1000);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.deckName).toBe('English::Books::Book');
    expect(notes[0]!.fields.SourceForm).toBe('brushed off');
    expect(notes[0]!.fields.Expression).toBe('brush off');
    expect(notes[0]!.fields.GeneralMeaning).toBe('A general definition. A broader clarification.');
    expect(notes[0]!.fields.PartOfSpeech).toBe('phrasal verb');
    expect(notes[0]!.fields.AmericanIPA).toBe('/bɹʌʃ ɔf/');
    expect(notes[0]!.fields.Examples!.match(/<li>/g)).toHaveLength(5);
    expect(notes[0]!.fields.GapContext).not.toContain('brushed off');
    expect(notes[0]!.tags).toEqual(['english', 'books::test']);
    expect(calls.find((c) => c.action === 'createModel')!.params.cardTemplates).toEqual(TEMPLATES);
    expect(calls.every((c) => c.key === 'local-test-key')).toBe(true);
  });
  it('does not add again when the same draft is retried', async () => {
    const d = draft(),
      client = new Anki(settings);
    expect(await client.add(d)).toBe(await client.add(d));
    expect(calls.filter((c) => c.action === 'addNote')).toHaveLength(1);
  });
  it('recovers the note ID if Anki wrote the note but the HTTP response was lost', async () => {
    loseResponse = true;
    expect(await new Anki(settings).add(draft())).toBe(1000);
    expect(notes).toHaveLength(1);
    expect(calls.filter((c) => c.action === 'addNote')).toHaveLength(1);
  });
  it('blocks the same expression but lets the user explicitly add a different sense', async () => {
    const client = new Anki(settings);
    await client.add(draft());
    const second = draft();
    second.expression = 'BRUSH OFF';
    await expect(client.add(second)).rejects.toBeInstanceOf(DuplicateError);
    expect(notes).toHaveLength(1);
    second.allowDuplicate = true;
    await client.add(second);
    expect(notes).toHaveLength(2);
  });
  it('does not treat a substring as a duplicate or overwrite an existing model', async () => {
    const client = new Anki(settings);
    await client.add(draft());
    const second = draft();
    second.expression = 'brush off criticism';
    await client.add(second);
    expect(notes).toHaveLength(2);
    expect(calls.filter((c) => c.action === 'createModel')).toHaveLength(1);
  });
  it('escapes wildcard characters and restricts duplicate searches to the expression field', async () => {
    const d = draft();
    d.expression = 'a*b_thing';
    await new Anki(settings).add(d);
    const query = calls.find(
      (c) => c.action === 'findNotes' && c.params.query.includes('Expression:'),
    )!.params.query;
    expect(query).toContain('Expression:"a\\*b\\_thing"');
    expect(searchQuote('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});
