import { afterEach, describe, expect, it, vi } from 'vitest';
import { Anki, DuplicateError, searchQuote } from '../../src/anki';
import { FIELDS, TEMPLATES } from '../../src/templates';
import { DEFAULTS } from '../../src/types';
import * as http from '../../src/http';
import { draft } from './fixtures';

afterEach(() => vi.restoreAllMocks());
const api = () => new Anki(structuredClone(DEFAULTS));
const templates = () =>
  Object.fromEntries(TEMPLATES.map((t) => [t.Name, { Front: t.Front, Back: t.Back }]));
describe('AnkiConnect vocabulary contract', () => {
  for (const bad of [
    null,
    {},
    [],
    { result: 1 },
    { error: null },
    { result: 1, error: 'Access denied' },
  ])
    it(`rejects malformed or failed action: ${JSON.stringify(bad)}`, async () => {
      vi.spyOn(http, 'jsonRequest').mockResolvedValue(bad);
      await expect(api().decks()).rejects.toThrow();
    });
  it('uses protocol version 6, an optional key and a finite timeout', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValue({ result: ['English'], error: null });
    const settings = { ...structuredClone(DEFAULTS), ankiKey: 'secret' };
    expect(await new Anki(settings).decks()).toEqual(['English']);
    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      { action: 'deckNames', version: 6, params: {}, key: 'secret' },
      undefined,
      12000,
    );
    await api().decks();
    expect(request.mock.calls[1]![1]).not.toHaveProperty('key');
  });
  it('escapes query wildcards, quotes and backslashes literally', () => {
    expect(searchQuote('a* _ "b" \\')).toBe('"a\\* \\_ \\"b\\" \\\\"');
  });
  it('does not load note information for an empty duplicate search', async () => {
    const anki = api(),
      action = vi.spyOn(anki, 'action').mockResolvedValue([]);
    expect(await anki.duplicates('word')).toEqual([]);
    expect(action).toHaveBeenCalledOnce();
  });
  it('batches duplicate candidates and compares literal escaped values', async () => {
    const anki = api(),
      ids = Array.from({ length: 1001 }, (_, i) => i + 1);
    let batch = 0;
    const action = vi.spyOn(anki, 'action').mockImplementation(async (name) => {
      if (name === 'findNotes') return ids;
      batch++;
      return [
        {
          noteId: batch,
          fields: {
            Expression: {
              value: batch === 1 ? '  A &amp; B  ' : batch === 2 ? 'a & b' : 'a &amp; b extra',
            },
          },
          cards: [],
        },
        { noteId: 99, fields: {}, cards: [] },
      ];
    });
    expect(await anki.duplicates('A & B')).toEqual([1]);
    expect(
      action.mock.calls
        .filter(([name]) => name === 'notesInfo')
        .map(([, p]) => (p!.notes as number[]).length),
    ).toEqual([500, 500, 1]);
  });
  it('opens only the requested note IDs', async () => {
    const anki = api(),
      action = vi.spyOn(anki, 'action').mockResolvedValue(null);
    await anki.open([42, 43]);
    expect(action).toHaveBeenCalledWith('guiBrowse', { query: 'nid:42 or nid:43' });
  });
});
describe('safe note model migration', () => {
  it('leaves an up-to-date model completely unchanged', async () => {
    const anki = api(),
      action = vi
        .spyOn(anki, 'action')
        .mockResolvedValueOnce([DEFAULTS.noteType])
        .mockResolvedValueOnce([...FIELDS])
        .mockResolvedValueOnce(templates());
    await anki.ensureModel();
    expect(action.mock.calls.map(([name]) => name)).toEqual([
      'modelNames',
      'modelFieldNames',
      'modelTemplates',
    ]);
  });
  for (const fields of [
    FIELDS.filter((f) => f !== 'Key'),
    ['Expression', ...FIELDS.filter((f) => f !== 'Expression')],
    FIELDS.filter((f) => f !== 'GapContext'),
  ])
    it(`refuses incompatible fields with first field ${fields[0]} and ${fields.length} fields`, async () => {
      const anki = api(),
        action = vi
          .spyOn(anki, 'action')
          .mockResolvedValueOnce([DEFAULTS.noteType])
          .mockResolvedValueOnce(fields);
      await expect(anki.ensureModel()).rejects.toThrow('incompatible fields');
      expect(action).toHaveBeenCalledTimes(2);
    });
  for (const value of [
    {},
    { Recognition: { Front: 'x', Back: 'y' } },
    { ...templates(), Third: { Front: 'x', Back: 'y' } },
    { ...templates(), Recall: { Front: 3, Back: 'x' } },
    { ...templates(), Recognition: { Front: 'x', Back: null } },
  ])
    it(`refuses incompatible card templates ${JSON.stringify(value).slice(0, 50)}`, async () => {
      const anki = api(),
        action = vi
          .spyOn(anki, 'action')
          .mockResolvedValueOnce([DEFAULTS.noteType])
          .mockResolvedValueOnce([...FIELDS])
          .mockResolvedValueOnce(value);
      await expect(anki.ensureModel()).rejects.toThrow('expected two card templates');
      expect(action).toHaveBeenCalledTimes(3);
    });
  for (const back of [
    '<div>{{Explanation}}</div>',
    'Custom back',
    '{{#GeneralMeaning}}{{GeneralMeaning}}{{/GeneralMeaning}}',
  ])
    it(`preserves custom content while adding missing metadata to ${back}`, async () => {
      const anki = api(),
        old = {
          Recognition: { Front: 'Custom front', Back: back },
          Recall: { Front: 'Recall front', Back: back },
        };
      const action = vi
        .spyOn(anki, 'action')
        .mockResolvedValueOnce([DEFAULTS.noteType])
        .mockResolvedValueOnce(
          FIELDS.filter(
            (f) => !['PartOfSpeech', 'AmericanIPA', 'GeneralMeaning', 'WordFormation'].includes(f),
          ),
        )
        .mockResolvedValueOnce(old)
        .mockResolvedValue(null);
      await anki.ensureModel();
      expect(action.mock.calls.filter(([name]) => name === 'modelFieldAdd')).toHaveLength(4);
      const update = action.mock.calls.find(([name]) => name === 'updateModelTemplates')![1] as any;
      expect(update.model.templates.Recognition.Front).toBe('Custom front');
      for (const field of ['PartOfSpeech', 'AmericanIPA', 'GeneralMeaning', 'WordFormation'])
        expect(update.model.templates.Recall.Back).toContain(`{{${field}}}`);
      expect(
        action.mock.calls.some(([name]) =>
          ['deleteNotes', 'changeDeck', 'setDueDate'].includes(name),
        ),
      ).toBe(false);
    });
  it.each(['PartOfSpeech', 'AmericanIPA'])(
    'adds only the missing %s metadata without duplicating the other',
    async (missing) => {
      const anki = api(),
        original = templates();
      for (const t of Object.values(original)) t.Back = t.Back.replaceAll(`{{${missing}}}`, '');
      const action = vi
        .spyOn(anki, 'action')
        .mockResolvedValueOnce([DEFAULTS.noteType])
        .mockResolvedValueOnce([...FIELDS])
        .mockResolvedValueOnce(original)
        .mockResolvedValue(null);
      await anki.ensureModel();
      const update = action.mock.calls.at(-1)![1] as any;
      const other = missing === 'PartOfSpeech' ? 'AmericanIPA' : 'PartOfSpeech';
      expect(update.model.templates.Recall.Back.split(`{{${other}}}`).length - 1).toBe(1);
    },
  );
});
describe('vocabulary export retry safety', () => {
  function setup() {
    const anki = api(),
      d = draft();
    vi.spyOn(anki, 'ensureModel').mockResolvedValue();
    vi.spyOn(anki, 'duplicates').mockResolvedValue([]);
    const key = vi.spyOn(anki, 'byKey').mockResolvedValue([]),
      action = vi.spyOn(anki, 'action').mockResolvedValue(null);
    return { anki, d, key, action };
  }
  it('rejects an empty note type before any request', async () => {
    const anki = new Anki({ ...structuredClone(DEFAULTS), noteType: '  ' }),
      action = vi.spyOn(anki, 'action');
    await expect(anki.add(draft())).rejects.toThrow('note type name');
    expect(action).not.toHaveBeenCalled();
  });
  it('recovers by immutable draft key before inspecting models or duplicates', async () => {
    const { anki, d, key, action } = setup();
    key.mockResolvedValue([42]);
    expect(await anki.add(d)).toBe(42);
    expect(action).not.toHaveBeenCalled();
    expect(anki.ensureModel).not.toHaveBeenCalled();
  });
  it('rejects duplicates before creating a deck unless explicitly allowed', async () => {
    const { anki, d, action } = setup();
    vi.mocked(anki.duplicates).mockResolvedValue([99]);
    await expect(anki.add(d)).rejects.toBeInstanceOf(DuplicateError);
    expect(action).not.toHaveBeenCalled();
    d.allowDuplicate = true;
    action.mockResolvedValueOnce(null).mockResolvedValueOnce(42);
    expect(await anki.add(d)).toBe(42);
    const params = action.mock.calls.at(-1)![1] as any;
    expect(params.note.options.allowDuplicate).toBe(false);
    expect(params.note.fields.Key).toBe(d.id);
  });
  it('preserves the original export failure if the recovery lookup also fails', async () => {
    const { anki, d, key, action } = setup();
    key.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Lookup failed'));
    action.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Export failed'));
    await expect(anki.add(d)).rejects.toThrow('Export failed');
  });
  it('recovers a committed note when addNote reports a failure', async () => {
    const { anki, d, key, action } = setup();
    key.mockResolvedValueOnce([]).mockResolvedValueOnce([42]);
    action.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Lost response'));
    expect(await anki.add(d)).toBe(42);
  });
  for (const id of [null, 0, -1, 1.5, '42', Number.MAX_SAFE_INTEGER + 1])
    it(`rejects an invalid note ID ${String(id)} rather than marking a draft saved`, async () => {
      const { anki, d, action } = setup();
      action.mockResolvedValueOnce(null).mockResolvedValueOnce(id);
      await expect(anki.add(d)).rejects.toThrow('note ID');
    });
});
