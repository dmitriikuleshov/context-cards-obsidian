import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chatRequest,
  clearThinkingCache,
  parseThinkingSupport,
  readThinkingSupport,
  thinkingChoices,
  thinkingValue,
  validThinkingChoice,
} from '../src/thinking';
import * as http from '../src/http';
import { DEFAULTS } from '../src/types';
import { restoreData } from '../src/storage';
import { Ollama } from '../src/ollama';
import { WritingModel } from '../src/writing-model';
import { rawContent, response } from './vocabulary/fixtures';

const toggle = { known: true, values: [false, true], default: true };
const levels = { known: true, values: ['low', 'medium', 'high'], default: 'medium' };
const unknown = { known: false, values: [] };
const metadata = { thinking: { values: [false, true], default: true } };
const signal = () => new AbortController().signal;
const settings = (thinking: typeof DEFAULTS.thinking = 'on') => ({
  ...structuredClone(DEFAULTS),
  thinking,
});
const payload = {
  model: DEFAULTS.model,
  messages: [],
  options: { num_predict: 150, num_ctx: 6144, temperature: 0.2 },
};
afterEach(() => {
  clearThinkingCache();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('thinking metadata and stored preferences', () => {
  it.each(['off', 'on', 'default', 'level:low', 'level:custom mode'])(
    'restores supported preference syntax %s',
    (value) => {
      expect(validThinkingChoice(value)).toBe(true);
      expect(restoreData({ settings: { thinking: value } }).settings.thinking).toBe(value);
    },
  );
  it.each([
    undefined,
    null,
    false,
    0,
    'yes',
    'level:',
    'level: high',
    'level:high ',
    'level:a\nb',
    'level:' + 'x'.repeat(65),
  ])('rejects invalid preference %s', (value) => {
    expect(validThinkingChoice(value)).toBe(false);
    expect(restoreData({ settings: { thinking: value } }).settings.thinking).toBe('off');
  });
  it.each([
    null,
    {},
    { capabilities: ['thinking'] },
    { thinking: {} },
    { thinking: { values: [] } },
    { thinking: { values: [null] } },
    { thinking: { values: [2] } },
    { thinking: { values: [''] } },
    { thinking: { values: [' high'] } },
    { thinking: { values: ['a\nb'] } },
    { thinking: { values: ['x'.repeat(65)] } },
    { thinking: { values: Array(33).fill(true) } },
  ])('does not invent controls from absent or malformed metadata (%#)', (value) => {
    expect(parseThinkingSupport(value)).toEqual(unknown);
  });
  it('deduplicates exact values and accepts only a supported default', () => {
    expect(
      parseThinkingSupport({ thinking: { values: [false, true, true], default: true } }),
    ).toEqual(toggle);
    expect(
      parseThinkingSupport({ thinking: { values: ['low', 'high'], default: 'other' } }),
    ).toEqual({ known: true, values: ['low', 'high'] });
  });
  it('offers real booleans, named levels, unsupported and unknown states', () => {
    expect(thinkingChoices(toggle).map((c) => c.value)).toEqual(['off', 'on', 'default']);
    expect(thinkingChoices(levels).map((c) => c.label)).toEqual([
      'Low',
      'Medium',
      'High',
      'Model default',
    ]);
    expect(thinkingChoices({ known: true, values: ['extended'] })[0]).toEqual({
      value: 'level:extended',
      label: 'extended',
    });
    expect(thinkingChoices({ known: true, values: [false] })).toEqual([
      { value: 'off', label: 'Not supported' },
    ]);
    expect(thinkingChoices(unknown)).toEqual([{ value: 'default', label: 'Model default' }]);
    expect(thinkingChoices({ known: true, values: [true] }).map((c) => c.value)).toEqual([
      'on',
      'default',
    ]);
  });
  it('resolves available controls without pretending an always-on model can turn thinking off', () => {
    expect(thinkingValue('on', toggle)).toBe(true);
    expect(thinkingValue('off', toggle)).toBe(false);
    expect(thinkingValue('off', unknown)).toBe(false);
    expect(thinkingValue('off', levels)).toBeNull();
    expect(thinkingValue('default', toggle)).toBeNull();
    expect(thinkingValue('default', unknown)).toBeUndefined();
    expect(thinkingValue('level:high', levels)).toBe('high');
    expect(() => thinkingValue('on', unknown)).toThrow('unknown');
    expect(() => thinkingValue('on', levels)).toThrow('does not support');
    expect(() => thinkingValue('level:other', levels)).toThrow('does not support');
  });
});

describe('model-specific metadata cache', () => {
  it('reads /api/show without generating or loading a model, and caches an independent copy', async () => {
    const request = vi.spyOn(http, 'jsonRequest').mockResolvedValue(metadata);
    const s = { ...settings(), model: ' selected:model ', ollamaUrl: 'http://localhost:11434/' },
      abort = signal();
    const first = await readThinkingSupport(s, abort);
    first.values.push('mutated');
    expect(await readThinkingSupport(s)).toEqual(toggle);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      'http://localhost:11434/api/show',
      { model: 'selected:model' },
      abort,
      8000,
    );
  });
  it('separates servers/models, supports forced refresh and expires stale controls', async () => {
    let now = 100;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const request = vi.spyOn(http, 'jsonRequest').mockResolvedValue(metadata);
    await readThinkingSupport(settings());
    await readThinkingSupport({ ...settings(), model: 'another' });
    await readThinkingSupport({ ...settings(), ollamaUrl: 'http://localhost:9999' });
    await readThinkingSupport(settings(), undefined, true, 1234);
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[3]?.[3]).toBe(1234);
    now += 60001;
    await readThinkingSupport(settings());
    expect(request).toHaveBeenCalledTimes(5);
  });
  it('bounds cache size and rechecks an evicted model', async () => {
    const request = vi.spyOn(http, 'jsonRequest').mockResolvedValue(metadata);
    for (let i = 0; i < 17; i++) await readThinkingSupport({ ...settings(), model: `model${i}` });
    await readThinkingSupport({ ...settings(), model: 'model0' });
    expect(request).toHaveBeenCalledTimes(18);
  });
  it('does not cache failed lookups or late results after cancellation', async () => {
    const controller = new AbortController();
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockRejectedValueOnce(new Error('Offline'))
      .mockImplementationOnce(async () => {
        controller.abort();
        return metadata;
      })
      .mockResolvedValue(metadata);
    await expect(readThinkingSupport(settings())).rejects.toThrow('Offline');
    await expect(readThinkingSupport(settings(), controller.signal)).rejects.toThrow('Cancelled');
    await readThinkingSupport(settings());
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe('shared chat transport', () => {
  it('keeps Off unchanged with no extra metadata request or larger limits', async () => {
    const request = vi.spyOn(http, 'jsonRequest').mockResolvedValue(response({ ready: true }));
    const abort = signal();
    await chatRequest(settings('off'), payload, abort, 1234);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      `${DEFAULTS.ollamaUrl}/api/chat`,
      { ...payload, think: false },
      abort,
      1234,
    );
    expect(payload.options.num_predict).toBe(150);
  });
  it('retains Off for older settings without the new property', async () => {
    const s = settings();
    delete (s as any).thinking;
    const request = vi.spyOn(http, 'jsonRequest').mockResolvedValue(response({}));
    await chatRequest(s, {}, signal(), 1000);
    expect((request.mock.calls[0]![1] as any).think).toBe(false);
  });
  it('enables supported thinking and budgets metadata inside the existing deadline', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const request = vi.spyOn(http, 'jsonRequest').mockImplementation(async (url) => {
      now += 200;
      return url.endsWith('/api/show') ? metadata : response({ ready: true });
    });
    const abort = signal();
    await chatRequest(settings(), payload, abort, 1000);
    expect(request.mock.calls[0]?.[3]).toBe(1000);
    const call = request.mock.calls[1]!;
    expect(call[2]).toBe(abort);
    expect(call[3]).toBe(800);
    expect((call[1] as any).think).toBe(true);
    expect((call[1] as any).options).toEqual({
      num_predict: 8192,
      num_ctx: 12288,
    });
  });
  it('does not send a generation once capability lookup uses the whole deadline', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const request = vi.spyOn(http, 'jsonRequest').mockImplementation(async () => {
      now = 1001;
      return metadata;
    });
    await expect(chatRequest(settings(), payload, signal(), 1000)).rejects.toThrow('timed out');
    expect(request).toHaveBeenCalledOnce();
  });
  it('passes named levels exactly and keeps larger pre-existing limits', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce({ thinking: { values: levels.values, default: 'medium' } })
      .mockResolvedValue(response({}));
    await chatRequest(
      settings('level:high'),
      { options: { num_predict: 6000, num_ctx: 20000 } },
      signal(),
      60000,
    );
    expect((request.mock.calls[1]![1] as any).think).toBe('high');
    expect((request.mock.calls[1]![1] as any).options).toEqual({
      num_predict: 10096,
      num_ctx: 20000,
    });
  });
  it.each([
    { thinking: { values: [false, true], default: false } },
    { thinking: { values: [false] } },
  ])('does not enlarge the budget for a known non-thinking default (%#)', async (support) => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce(support)
      .mockResolvedValue(response({}));
    await chatRequest(settings('default'), payload, signal(), 60000);
    expect((request.mock.calls[1]![1] as any).think).toBeNull();
    expect((request.mock.calls[1]![1] as any).options.num_predict).toBe(150);
  });
  it('uses model default without inventing an on/off control when metadata is absent', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce({ capabilities: ['completion'] })
      .mockResolvedValue(response({}));
    await chatRequest(settings('default'), {}, signal(), 60000);
    const body = request.mock.calls[1]![1] as any;
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('think');
    expect(body.options.num_predict).toBe(8192);
  });
  it('cannot secretly disable a known levels-only model', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce({ thinking: { values: levels.values, default: 'medium' } })
      .mockResolvedValue(response({}));
    await readThinkingSupport(settings());
    await chatRequest(settings('off'), payload, signal(), 60000);
    expect((request.mock.calls[1]![1] as any).think).toBeNull();
    expect((request.mock.calls[1]![1] as any).options.num_predict).toBe(8192);
  });
  it('refuses an unavailable On option before generating', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValue({ thinking: { values: [false] } });
    await expect(chatRequest(settings(), payload, signal(), 60000)).rejects.toThrow(
      'does not support',
    );
    expect(request).toHaveBeenCalledOnce();
  });
  it.each([
    { content: '', done: 'stop' },
    { content: '{', done: 'length' },
  ])(
    'explains exhausted thinking without parsing it as an answer (%#)',
    async ({ content, done }) => {
      vi.spyOn(http, 'jsonRequest')
        .mockResolvedValueOnce(metadata)
        .mockResolvedValue({
          done_reason: done,
          message: { thinking: 'Internal reasoning.', content },
        });
      await expect(chatRequest(settings(), payload, signal(), 60000)).rejects.toThrow(
        'generation budget on thinking',
      );
    },
  );
  it('does not mislabel an ordinary response failure or malformed reasoning field', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce({ message: { thinking: ' ', content: '' } })
      .mockResolvedValueOnce({ message: { thinking: 42 } })
      .mockResolvedValueOnce(null);
    for (let i = 0; i < 3; i++)
      await expect(chatRequest(settings('off'), payload, signal(), 60000)).resolves.toBeDefined();
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe('both model clients use Thinking', () => {
  it('applies On to every vocabulary request and never copies reasoning into card fields', async () => {
    const request = vi.spyOn(http, 'jsonRequest').mockImplementation(async (url, body: any) => {
      if (url.endsWith('/api/show')) return metadata;
      const p = body.format.properties;
      const value = p.lemma
        ? rawContent({ lemma: 'unlistedwordxyz', examples: [] })
        : p.general_meaning
          ? { general_meaning: 'A general meaning. A clarification.' }
          : p.base_word
            ? { base_word: '', base_meaning: '' }
            : {
                examples: [{ meaning: 'Usage', examples: ['One sentence.', 'Another sentence.'] }],
              };
      return {
        message: { content: JSON.stringify(value), thinking: 'A private reasoning trace.' },
      };
    });
    const result = await new Ollama(settings()).generate('word', 'A word.', signal());
    const calls = request.mock.calls.filter((call) => call[0].endsWith('/api/chat'));
    expect(calls).toHaveLength(4);
    expect(
      calls.every(
        (call) => (call[1] as any).think === true && (call[1] as any).options.num_predict >= 8192,
      ),
    ).toBe(true);
    expect(JSON.stringify(result.content)).not.toContain('private reasoning');
    expect(request.mock.calls.filter((call) => call[0].endsWith('/api/show'))).toHaveLength(1);
  });
  it('keeps Thinking enabled across writing validation retries', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce(metadata)
      .mockResolvedValueOnce({ message: { content: 'broken' } })
      .mockResolvedValueOnce(response({ summary: '', findings: [] }));
    const result = await new WritingModel(settings()).analyse(
      'This sentence is correct.',
      signal(),
    );
    expect(result.findings).toEqual([]);
    expect(request).toHaveBeenCalledTimes(3);
    for (const call of request.mock.calls.slice(1)) expect((call[1] as any).think).toBe(true);
  });
  it('does not waste a writing retry when reasoning exhausted the token budget', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce(metadata)
      .mockResolvedValueOnce({
        message: { thinking: 'Reasoning.', content: '' },
        done_reason: 'length',
      });
    await expect(
      new WritingModel(settings()).analyse('This is correct.', signal()),
    ).rejects.toThrow('generation budget');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
