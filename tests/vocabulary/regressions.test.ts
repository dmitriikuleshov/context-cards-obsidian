import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ollama } from '../../src/ollama';
import { Anki } from '../../src/anki';
import { DEFAULTS } from '../../src/types';
import * as http from '../../src/http';
import { pluginFixture, rawContent, response } from './fixtures';
afterEach(() => vi.restoreAllMocks());
describe('generation lifecycle regressions', () => {
  it.each([
    [6000, 1800, 6144],
    [6001, 1800, 12288],
    [12000, 1800, 12288],
    [20, 12000, 12288],
  ])(
    'uses a consistent model window for source length %i and setting %i',
    async (length, contextSize, tokens) => {
      const source = 'A record. ' + 'x'.repeat(length - 10);
      const request = vi.spyOn(http, 'jsonRequest').mockImplementation(async (_url, body) => {
        const props = (body as any).format.properties;
        if (props.lemma) return response(rawContent({ lemma: 'record', examples: [] })) as any;
        if (props.american_ipa)
          return response({ american_ipa: props.american_ipa.enum[0] }) as any;
        if (props.general_meaning)
          return response({ general_meaning: ['First.', 'Second.'] }) as any;
        if (props.base_word)
          return response({ base_word: 'base', base_meaning: 'Base meaning.' }) as any;
        return response({ examples: [{ meaning: 'Usage', examples: ['One.', 'Two.'] }] }) as any;
      });
      await new Ollama({ ...DEFAULTS, contextSize }).generate(
        'record',
        source,
        new AbortController().signal,
      );
      expect(request).toHaveBeenCalledTimes(5);
      expect(request.mock.calls.every((call) => (call[1] as any).options.num_ctx === tokens)).toBe(
        true,
      );
      expect(request.mock.calls.every((call) => (call[1] as any).think === false)).toBe(true);
      expect(JSON.parse((request.mock.calls[0]![1] as any).messages[1].content).source).toBe(
        source,
      );
    },
  );
  it.each(['generalMeaning', 'wordFormation', 'usageExamples'] as const)(
    'uses the extended configured window for standalone %s',
    async (method) => {
      const request = vi.spyOn(http, 'jsonRequest').mockResolvedValue(
        response({
          general_meaning: ['First.', 'Second.'],
          base_word: 'base',
          base_meaning: 'Base meaning.',
          examples: [{ meaning: 'Usage', examples: ['One.', 'Two.'] }],
        }),
      );
      await new Ollama({ ...DEFAULTS, contextSize: 12000 })[method](
        'record',
        'noun',
        new AbortController().signal,
      );
      expect((request.mock.calls[0]![1] as any).options.num_ctx).toBe(12288);
    },
  );
  for (const method of [
    'generate',
    'generateGeneralMeaning',
    'generateWordFormation',
    'approve',
  ] as const)
    it(`does not start ${method} from a stale UI callback after unload`, async () => {
      const { plugin, d } = pluginFixture();
      plugin.onunload();
      const calls = [
        vi.spyOn(Ollama.prototype, 'generate').mockRejectedValue(new Error('Unexpected call')),
        vi
          .spyOn(Ollama.prototype, 'generalMeaning')
          .mockRejectedValue(new Error('Unexpected call')),
        vi.spyOn(Ollama.prototype, 'wordFormation').mockRejectedValue(new Error('Unexpected call')),
        vi.spyOn(Anki.prototype, 'add').mockRejectedValue(new Error('Unexpected call')),
      ];
      await plugin[method](d);
      for (const call of calls) expect(call).not.toHaveBeenCalled();
    });
  it('reports a malformed top-level model payload without a raw TypeError', async () => {
    const request = vi.spyOn(http, 'jsonRequest').mockResolvedValue(response(null));
    await expect(
      new Ollama(DEFAULTS).generate('word', 'A word.', new AbortController().signal),
    ).rejects.toThrow(/invalid|object/i);
    expect(request).toHaveBeenCalledOnce();
  });
  for (const stage of ['pronunciation', 'general meaning', 'word formation', 'examples'])
    it(`does not start ${stage} after the shared timeout has expired`, async () => {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      const request = vi.spyOn(http, 'jsonRequest').mockImplementation(async () => {
        now = 60001;
        return response(
          rawContent({
            lemma: stage === 'pronunciation' ? 'record' : 'unlistedwordxyz',
            examples: [],
          }),
        ) as any;
      });
      const fields = {
        ...DEFAULTS.fields,
        ipa: stage === 'pronunciation' ? ('american' as const) : ('off' as const),
        generalMeaningSentences: stage === 'general meaning' ? 2 : 0,
        wordFormation: stage === 'word formation',
        examples: stage === 'examples',
      };
      const model = new Ollama({ ...DEFAULTS, fields }),
        general = vi.spyOn(model, 'generalMeaning').mockResolvedValue('Late.'),
        formation = vi.spyOn(model, 'wordFormation').mockResolvedValue('Late.'),
        examples = vi
          .spyOn(model, 'usageExamples')
          .mockResolvedValue([{ meaning: 'Late', examples: ['One.', 'Two.'] }]);
      await expect(model.generate('word', 'A word.', new AbortController().signal)).rejects.toThrow(
        /timed out|timeout/i,
      );
      expect(request).toHaveBeenCalledOnce();
      expect(general).not.toHaveBeenCalled();
      expect(formation).not.toHaveBeenCalled();
      expect(examples).not.toHaveBeenCalled();
    });
  it('passes the decreasing shared budget and the same abort signal to every request', async () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const signal = new AbortController().signal;
    const request = vi.spyOn(http, 'jsonRequest').mockImplementation(async (_url, body) => {
      const props = (body as any).format.properties;
      now += 1000;
      if (props.lemma)
        return response(rawContent({ lemma: 'unlistedwordxyz', examples: [] })) as any;
      if (props.general_meaning) return response({ general_meaning: ['First.', 'Second.'] }) as any;
      if (props.base_word)
        return response({ base_word: 'base', base_meaning: 'Base meaning.' }) as any;
      return response({ examples: [{ meaning: 'Usage', examples: ['One.', 'Two.'] }] }) as any;
    });
    const result = await new Ollama(DEFAULTS).generate('word', 'A word.', signal);
    expect(result.seconds).toBe(4);
    expect(request.mock.calls.map((c) => c[3])).toEqual([60000, 59000, 58000, 57000]);
    expect(request.mock.calls.every((c) => c[2] === signal)).toBe(true);
  });
});
