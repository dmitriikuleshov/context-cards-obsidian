import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDraft } from '../../src/text';
import { restoreData } from '../../src/storage';
import { capture, deferred, pluginFixture, rawContent } from './fixtures';

const servers: Server[] = [];
async function server(handler: (body: any, res: ServerResponse) => void) {
  const s = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    handler(JSON.parse(raw), res);
  });
  servers.push(s);
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
function json(res: ServerResponse, value: unknown) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(value));
}
function modelResponse(body: any) {
  const props = body.format.properties;
  if (props.lemma)
    return rawContent({
      lemma: 'brush off',
      meaning: ['Dismiss something.', 'Treat it as unimportant.'],
      explanation: ['It often implies dismissal.', 'It can sound insensitive.'],
      examples: [],
    });
  if (props.general_meaning)
    return { general_meaning: ['To dismiss or ignore.', 'It also describes removing dust.'] };
  if (props.base_word) return { base_word: 'brush', base_meaning: 'To sweep lightly.' };
  return {
    examples: [
      { meaning: 'Dismiss', examples: ['She brushed off criticism.', 'He brushed off my advice.'] },
      { meaning: 'Remove dust', examples: ['Brush off the dust.', 'He brushed off his jacket.'] },
    ],
  };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

describe('vocabulary capture → HTTP model → editable draft → mock AnkiConnect', () => {
  it('creates two card templates from one approved note, preserving edits and all fields', async () => {
    const { plugin } = pluginFixture();
    plugin.drafts = [];
    plugin.settings.fields.ipa = 'off';
    const modelCalls: any[] = [],
      actions: any[] = [],
      notes: any[] = [];
    plugin.settings.ollamaUrl = await server((body, res) => {
      modelCalls.push(body);
      json(res, { message: { content: JSON.stringify(modelResponse(body)) } });
    });
    plugin.settings.ankiUrl = await server((body, res) => {
      actions.push(body);
      let result: any = null;
      if (body.action === 'findNotes') result = [];
      if (body.action === 'modelNames') result = [];
      if (body.action === 'addNote') {
        notes.push(body.params.note);
        result = 42;
      }
      json(res, { result, error: null });
    });
    const show = vi.fn();
    vi.spyOn(plugin, 'openPanel').mockResolvedValue({ show } as any);
    await plugin.capture(capture());
    const d = plugin.drafts[0]!;
    await vi.waitFor(() => expect(d.phase).toBe('editing'));
    expect(d.error).toBe('');
    expect(d.generalMeaning).toContain('removing dust');
    expect(d.wordFormation).toContain('brush —');
    expect(d.exampleGroups).toHaveLength(2);
    expect(modelCalls).toHaveLength(4);
    expect(actions).toEqual([]);
    d.meaning = 'My reviewed contextual definition.';
    await plugin.approve(d);
    expect(d.error).toBe('');
    expect(d.noteId).toBe(42);
    expect(d.phase).toBe('saved');
    expect(notes).toHaveLength(1);
    const fields = notes[0].fields;
    expect(fields.Meaning).toBe(d.meaning);
    expect(fields.SourceForm).toBe('brushed off');
    expect(fields.GapContext).not.toContain('brushed off');
    expect(fields.Context).toContain('<mark>brushed off</mark>');
    expect(fields.Examples).toContain('Remove dust');
    expect(fields.GeneralMeaning).toContain('removing dust');
    expect(fields.WordFormation).toContain('brush —');
    const model = actions.find((a) => a.action === 'createModel').params;
    expect(model.cardTemplates.map((t: any) => t.Name)).toEqual(['Recognition', 'Recall']);
    const restored = restoreData({ settings: plugin.settings, drafts: plugin.drafts }).drafts[0]!;
    expect(restored.phase).toBe('saved');
    expect(restored.noteId).toBe(42);
    expect(restored.exampleGroups).toEqual(d.exampleGroups);
    await plugin.approve(d);
    expect(notes).toHaveLength(1);
  });
  it('keeps the previous card after a supplemental HTTP error and offers a pending replacement on retry', async () => {
    const { plugin, d } = pluginFixture();
    plugin.settings.fields.ipa = 'off';
    let fail = true,
      calls = 0;
    plugin.settings.ollamaUrl = await server((body, res) => {
      calls++;
      if (body.format.properties.general_meaning && fail) {
        res.statusCode = 503;
        json(res, { error: 'Model unavailable' });
      } else json(res, { message: { content: JSON.stringify(modelResponse(body)) } });
    });
    const old = structuredClone(d);
    await plugin.generate(d);
    expect(d.error).toContain('503');
    expect(d.meaning).toBe(old.meaning);
    expect(d.pendingContent).toBeUndefined();
    expect(calls).toBe(2);
    fail = false;
    await plugin.generate(d);
    expect(d.error).toBe('');
    expect(d.meaning).toBe(old.meaning);
    expect(d.pendingContent!.meaning).toBe('Dismiss something. Treat it as unimportant.');
    expect(d.pendingSource).toEqual({ context: old.context, answer: old.answer });
  });
  it('cancels an actual HTTP request without replacing content or starting follow-ups', async () => {
    const { plugin, d } = pluginFixture(),
      started = deferred<void>();
    let held: ServerResponse | undefined,
      calls = 0;
    plugin.settings.ollamaUrl = await server((_body, res) => {
      calls++;
      held = res;
      started.resolve();
    });
    const before = structuredClone(d),
      running = plugin.generate(d);
    await started.promise;
    plugin.cancel(d);
    await running;
    held?.end();
    expect(d.phase).toBe('editing');
    expect(d.error).toBe('');
    expect(d.meaning).toBe(before.meaning);
    expect(calls).toBe(1);
  });
  it('keeps one settings snapshot across all model HTTP requests', async () => {
    const { plugin } = pluginFixture(),
      started = deferred<void>(),
      release = deferred<void>(),
      models: string[] = [];
    plugin.settings.fields.ipa = 'off';
    plugin.settings.model = 'original';
    const d = createDraft(capture(), plugin.settings);
    plugin.drafts = [d];
    plugin.settings.ollamaUrl = await server((body, res) => {
      models.push(body.model);
      if (models.length === 1) {
        started.resolve();
        void release.promise.then(() =>
          json(res, { message: { content: JSON.stringify(modelResponse(body)) } }),
        );
      } else json(res, { message: { content: JSON.stringify(modelResponse(body)) } });
    });
    const running = plugin.generate(d);
    await started.promise;
    plugin.settings.model = 'changed';
    plugin.settings.fields.examples = false;
    release.resolve();
    await running;
    expect(d.error).toBe('');
    expect(models).toEqual(['original', 'original', 'original', 'original']);
    expect(d.exampleGroups).toHaveLength(2);
  });
  it('recovers a committed note through its key after a failed addNote response', async () => {
    const { plugin, d } = pluginFixture();
    let stored = false,
      adds = 0;
    plugin.settings.ankiUrl = await server((body, res) => {
      if (body.action === 'addNote') {
        stored = true;
        adds++;
        json(res, { result: null, error: 'Response lost after commit' });
        return;
      }
      const result =
        body.action === 'findNotes'
          ? stored
            ? [99]
            : []
          : body.action === 'modelNames'
            ? []
            : null;
      json(res, { result, error: null });
    });
    await plugin.approve(d);
    expect(d.phase).toBe('saved');
    expect(d.noteId).toBe(99);
    expect(d.error).toBe('');
    expect(adds).toBe(1);
  });
});
