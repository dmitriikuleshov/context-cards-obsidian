// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { modelChat } from '../src/model-chat';
import { Ollama } from '../src/ollama';
import { WritingModel } from '../src/writing-model';
import { restoreData } from '../src/storage';
import { DEFAULTS } from '../src/types';
import { Anki } from '../src/anki';
import { pluginFixture } from './vocabulary/fixtures';
import * as http from '../src/http';
afterEach(() => vi.restoreAllMocks());
const settings = {
  ...DEFAULTS,
  provider: 'chatgpt' as const,
  chatgptModel: 'gpt-6-luna',
  chatgptAccountId: 'account',
};
describe('provider routing without changing learning mechanics', () => {
  it('keeps old settings local and restores only known provider options', () => {
    expect(restoreData({ settings: { model: 'local' } }).settings).toMatchObject({
      provider: 'ollama',
      model: 'local',
      chatgptModel: '',
    });
    expect(restoreData({ settings }).settings).toMatchObject(settings);
    expect(
      restoreData({ settings: { provider: 'invalid', chatgptModel: 3, chatgptAccountId: false } })
        .settings,
    ).toMatchObject({ provider: 'ollama', chatgptModel: '', chatgptAccountId: '' });
  });
  it('routes local requests unchanged and refuses a missing cloud connection', async () => {
    const local = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValue({ message: { content: 'local' } });
    const body = { model: DEFAULTS.model, messages: [], format: {} };
    await modelChat(DEFAULTS, body);
    expect(local.mock.calls[0]![1]).toBe(body);
    expect(() => modelChat(settings, body)).toThrow(/Connect ChatGPT/);
    const cloud = {
      models: vi.fn().mockResolvedValue([{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }]),
      chat: vi.fn().mockResolvedValue({ message: { content: 'cloud' } }),
    };
    expect((await modelChat<any>(settings, body, undefined, 100, cloud)).message.content).toBe(
      'cloud',
    );
    expect(await new Ollama(settings, cloud).models()).toEqual(['gpt-6-luna']);
    expect(local).toHaveBeenCalledOnce();
  });
  it('uses the cloud transport for meanings, formation and examples, with existing validators', async () => {
    const cloud = {
      models: vi.fn(),
      chat: vi.fn().mockImplementation(async (body: any) => {
        const p = body.format.properties;
        const value = p.general_meaning
          ? { general_meaning: ['A general meaning.', 'A useful boundary.'] }
          : p.base_word
            ? { base_word: 'quiet', base_meaning: 'Making little noise.' }
            : {
                examples: [
                  {
                    meaning: 'With little noise',
                    examples: ['She spoke quietly.', 'He closed the door quietly.'],
                  },
                ],
              };
        return { message: { content: JSON.stringify(value) } };
      }),
    };
    const model = new Ollama(settings, cloud),
      signal = new AbortController().signal;
    expect(await model.generalMeaning('quietly', 'adverb', signal)).toContain('general meaning');
    expect(await model.wordFormation('quietly', 'adverb', signal)).toContain('quiet —');
    expect(await model.usageExamples('quietly', 'adverb', signal)).toHaveLength(1);
    expect(cloud.chat).toHaveBeenCalledTimes(3);
  });
  it('uses the same writing validators for cloud analysis and approved exercise generation', async () => {
    const cloud = {
      models: vi.fn(),
      chat: vi.fn().mockImplementation(async (body: any) => {
        const p = body.format.properties;
        const value = p.sentences
          ? { sentences: [{ id: '1', corrected: 'I have written a letter.' }] }
          : p.decisions
            ? {
                decisions: [
                  {
                    id: '1',
                    verdict: 'required',
                    category: 'grammar',
                    pattern: 'Past participle',
                    recommended_format: 'correction',
                    explanation: 'Use a past participle after have.',
                    tip: 'write → written',
                  },
                ],
              }
            : Object.fromEntries(
                Object.entries(p).map(([key, schema]: any) => [
                  key,
                  schema.enum?.[0] ?? 'Use write.',
                ]),
              );
        return { message: { content: JSON.stringify(value) } };
      }),
    };
    const model = new WritingModel(settings, cloud),
      signal = new AbortController().signal;
    const analysis = await model.analyse('I have wrote a letter.', signal);
    expect(analysis.findings).toHaveLength(1);
    const card = await model.exercise(analysis.findings[0]!, signal);
    expect(card.answer).toBe('written');
    expect(card.question).toBe('I have wrote a letter.');
  });
  it('initializes a vault-specific account only when selected and disposes it on unload', async () => {
    const f = pluginFixture();
    expect(f.plugin.modelConnection).toBeUndefined();
    f.app.secretStorage = { getSecret: vi.fn(() => null), setSecret: vi.fn() };
    f.vault.adapter = { getBasePath: () => '/vault/a' };
    f.plugin.settings = { ...settings };
    const account = f.plugin.chatgpt;
    expect(f.plugin.modelConnection).toBe(account);
    expect(f.plugin.chatgpt).toBe(account);
    expect(account.state().accounts).toEqual([]);
    const stop = vi.spyOn(account, 'dispose');
    f.plugin.onunload();
    expect(stop).toHaveBeenCalled();
  });
  it('supports older vault adapters and checks the selected cloud model with Anki independently', async () => {
    const f = pluginFixture();
    f.plugin.settings = { ...settings };
    const account = f.plugin.chatgpt;
    vi.spyOn(account, 'models').mockResolvedValue([{ id: settings.chatgptModel, name: 'Luna' }]);
    vi.spyOn(Anki.prototype, 'decks').mockResolvedValue(['English']);
    await f.plugin.checkConnections();
    expect(f.plugin.deckNames).toEqual(['English']);
  });
});
