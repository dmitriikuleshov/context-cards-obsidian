import { describe, it, expect, vi, afterEach } from 'vitest';
import { CARD_SCHEMA, parseContent, Ollama } from '../src/ollama';
import * as http from '../src/http';
import { DEFAULTS, DEFAULT_FIELDS } from '../src/types';
afterEach(() => vi.restoreAllMocks());
describe('model response validation', () => {
  const generalResponse = {
    message: {
      content: JSON.stringify({
        general_meaning:
          'A broad definition of the word. A further clarification of its common uses.',
      }),
    },
  };
  const usageResponse = {
    message: {
      content: JSON.stringify({
        examples: [
          {
            meaning: 'An established usage',
            examples: ['A first new example.', 'A second new example.'],
          },
        ],
      }),
    },
  };
  const formationResponse = {
    message: { content: JSON.stringify({ base_word: '', base_meaning: '' }) },
  };
  const response = (lemma: string) => ({
    message: {
      content: JSON.stringify({
        status: 'ready',
        lemma,
        part_of_speech: 'verb',
        american_ipa: '/wrong/',
        meaning: 'to try to do something',
        explanation: 'It describes an attempt.',
        examples: ['One.', 'Two.', 'Three.', 'Four.', 'Five.'],
        notes: [],
      }),
    },
  });
  it('corrects model IPA using the offline dictionary without an extra model request for one variant', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce(response('vagaries'))
      .mockResolvedValueOnce(generalResponse)
      .mockResolvedValueOnce(formationResponse)
      .mockResolvedValueOnce(usageResponse);
    const result = await new Ollama(DEFAULTS).generate(
      'vagaries',
      'The vagaries of the weather.',
      new AbortController().signal,
    );
    expect(result.content.americanIpa).toBe('/ˈveɪɡɚiz/');
    expect(request).toHaveBeenCalledTimes(4);
    expect(result.content.meaning).toBe('to try to do something');
    expect(result.content.generalMeaning).toBe(
      'A broad definition of the word. A further clarification of its common uses.',
    );
    const generalRequest = request.mock.calls[1]![1] as any;
    expect(JSON.parse(generalRequest.messages.find((m: any) => m.role === 'user').content)).toEqual(
      {
        word: 'vagaries',
        grammar: 'verb',
      },
    );
    expect(generalRequest.messages.find((m: any) => m.role === 'user').content).not.toContain(
      'weather',
    );
  });
  it('constrains pronunciation selection to dictionary candidates for the displayed lemma', async () => {
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValueOnce(response('seek to'))
      .mockResolvedValueOnce({ message: { content: '{"american_ipa":"/siːk tuː/"}' } })
      .mockResolvedValueOnce(generalResponse)
      .mockResolvedValueOnce(formationResponse)
      .mockResolvedValueOnce(usageResponse);
    const result = await new Ollama(DEFAULTS).generate(
      'sought to',
      'He sought to explain the noise.',
      new AbortController().signal,
    );
    expect(result.content.americanIpa).toBe('/siːk tuː/');
    expect(request).toHaveBeenCalledTimes(5);
    const first = request.mock.calls[0]![1] as any,
      second = request.mock.calls[1]![1] as any;
    expect(second.format.properties.american_ipa.enum).toContain('/siːk tuː/');
    expect(second.messages[1].content).not.toContain('sought to');
    expect(second.options.num_ctx).toBe(first.options.num_ctx);
  });
  it('returns the base definition and sends no passage to the base-word request', async () => {
    const request = vi.spyOn(http, 'jsonRequest').mockResolvedValue({
      message: {
        content: JSON.stringify({
          base_word: 'conceive',
          base_meaning: 'To form an idea or imagine something.',
        }),
      },
    });
    expect(
      await new Ollama(DEFAULTS).wordFormation(
        'conceivably',
        'adverb',
        new AbortController().signal,
      ),
    ).toBe('conceive — To form an idea or imagine something.');
    expect(JSON.parse((request.mock.calls[0]![1] as any).messages[1].content)).toEqual({
      word: 'conceivably',
      grammar: 'adverb',
    });
  });
  it('leaves word formation empty when there is no separate base', async () => {
    vi.spyOn(http, 'jsonRequest').mockResolvedValue(formationResponse);
    expect(
      await new Ollama(DEFAULTS).wordFormation('book', 'noun', new AbortController().signal),
    ).toBe('');
  });
  it('keeps distinct meaning groups and rejects incomplete groups', () => {
    const base = JSON.parse(response('bright').message.content);
    const groups = [
      {
        meaning: 'Full of light',
        examples: ['The kitchen is bright.', 'A bright lamp lit the room.'],
      },
      { meaning: 'Intelligent', examples: ['She is a bright student.', 'He is a bright child.'] },
    ];
    const parsed = parseContent(JSON.stringify({ ...base, examples: groups }));
    expect(parsed.exampleGroups).toEqual(groups);
    expect(parsed.examples).toHaveLength(4);
    expect(() =>
      parseContent(
        JSON.stringify({ ...base, examples: [{ meaning: 'Light', examples: ['One.'] }] }),
      ),
    ).toThrow('two examples');
    expect(() =>
      parseContent(JSON.stringify({ ...base, examples: Array(6).fill(groups[0]) })),
    ).toThrow('one and five');
  });
  it('skips optional model requests when fields are disabled', async () => {
    const value = JSON.parse(response('bright').message.content);
    Object.assign(value, { meaning: '', explanation: '', examples: [], american_ipa: '' });
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValue({ message: { content: JSON.stringify(value) } });
    const settings = {
      ...DEFAULTS,
      fields: {
        ...DEFAULT_FIELDS,
        ipa: 'off' as const,
        meaningSentences: 0,
        generalMeaningSentences: 0,
        explanationSentences: 0,
        wordFormation: false,
        examples: false,
      },
    };
    const result = await new Ollama(settings).generate(
      'bright',
      'A bright room.',
      new AbortController().signal,
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.content.meaning).toBe('');
    expect(result.content.examples).toEqual([]);
  });
  it('keeps British IPA instead of replacing it with the American dictionary', async () => {
    const value = JSON.parse(response('after').message.content);
    value.american_ipa = '/ˈɑːftə/';
    const request = vi
      .spyOn(http, 'jsonRequest')
      .mockResolvedValue({ message: { content: JSON.stringify(value) } });
    const settings = {
      ...DEFAULTS,
      fields: {
        ...DEFAULT_FIELDS,
        ipa: 'british' as const,
        generalMeaningSentences: 0,
        wordFormation: false,
        examples: false,
      },
    };
    const result = await new Ollama(settings).generate(
      'after',
      'Come after lunch.',
      new AbortController().signal,
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.content.americanIpa).toBe('/ˈɑːftə/');
    expect(result.content.ipaVariant).toBe('british');
  });
  it('requests configured counts and validates examples per usage', async () => {
    const request = vi.spyOn(http, 'jsonRequest').mockResolvedValue({
      message: {
        content: JSON.stringify({
          examples: [{ meaning: 'Full of light', examples: ['One.', 'Two.', 'Three.'] }],
        }),
      },
    });
    const settings = {
      ...DEFAULTS,
      fields: { ...DEFAULT_FIELDS, maxUsages: 2, examplesPerUsage: 3 },
    };
    const groups = await new Ollama(settings).usageExamples(
      'bright',
      'adjective',
      new AbortController().signal,
    );
    expect(groups[0]!.examples).toHaveLength(3);
    const body = request.mock.calls[0]![1] as any;
    expect(body.format.properties.examples.maxItems).toBe(2);
    expect(body.format.properties.examples.items.properties.examples.minItems).toBe(3);
  });
  it('supports both a concrete usage pattern and a nuance in notebook-style notes', () => {
    const value = {
      status: 'ready',
      lemma: 'conceivably',
      part_of_speech: 'adverb',
      american_ipa: '/kənˈsiːvəbli/',
      meaning: 'in a way that can be imagined or considered possible',
      explanation: 'It presents a possibility without saying that it is likely.',
      examples: [
        'The delay could conceivably affect the plans.',
        'She might conceivably finish tonight.',
        'The delay could conceivably affect us.',
        'They might conceivably agree.',
        'It could conceivably work.',
      ],
      notes: ['could / might conceivably + verb', 'More formal than possibly.'],
    };
    expect(CARD_SCHEMA.properties.notes.maxItems).toBe(2);
    expect(parseContent(JSON.stringify(value)).notes).toEqual(value.notes);
    expect(() =>
      parseContent(
        JSON.stringify({ ...value, notes: [...value.notes, 'Unnecessary third point.'] }),
      ),
    ).toThrow();
  });
  it('keeps an ambiguous result out of the card fields even when the model filled them', () => {
    const response = parseContent(
      JSON.stringify({
        status: 'ambiguous',
        lemma: 'bank',
        meaning: 'money',
        explanation: 'guess',
        examples: ['wrong', 'wrong'],
        notes: ['wrong'],
        clarification_question: 'River or financial institution?',
      }),
    );
    expect(response.status).toBe('ambiguous');
    expect(response.meaning).toBe('');
    expect(response.examples).toEqual(['', '', '', '', '']);
  });
  it('rejects truncated and incomplete ready responses', () => {
    expect(() => parseContent('{"status":')).toThrow('finish');
    expect(() =>
      parseContent(
        JSON.stringify({
          status: 'ready',
          lemma: 'word',
          meaning: 'a meaning',
          explanation: 'explanation',
          examples: ['one'],
          notes: [],
        }),
      ),
    ).toThrow('five examples');
  });
});
