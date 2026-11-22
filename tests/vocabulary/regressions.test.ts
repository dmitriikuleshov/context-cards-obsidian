import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ollama } from '../../src/ollama';
import { Anki } from '../../src/anki';
import { DEFAULTS } from '../../src/types';
import * as http from '../../src/http';
import { pluginFixture, rawContent, response } from './fixtures';
afterEach(() => vi.restoreAllMocks());
describe('generation lifecycle regressions', () => {
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
