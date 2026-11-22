import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  reviewTarget,
  narrowTarget,
  verifyTarget,
  needsTargetValidation,
  TargetSelectionError,
} from '../../src/target';
import { Ollama } from '../../src/ollama';
import * as http from '../../src/http';
import { DEFAULTS } from '../../src/types';
import { restoreData } from '../../src/storage';
import { issues } from '../../src/text';
import { capture, content, deferred, draft, pluginFixture, rawContent, response } from './fixtures';
afterEach(() => vi.restoreAllMocks());
const PASSAGE =
  'This is my hand-written text and I want AI to check it for mistakes. I started to learn english a few years ago. This is good';
function passage() {
  const text = 'Before. ' + PASSAGE + ' After.';
  return capture({ text, selected: PASSAGE, start: 8, end: 8 + PASSAGE.length });
}
describe('soft target review and exact source offsets', () => {
  it.each([
    'word',
    'brushed off',
    'had been resorted to',
    'as far as I am concerned',
    'Dr. Smith',
    'state-of-the-art',
  ])('keeps an ordinary item on the direct path: %s', (value) =>
    expect(reviewTarget(value)).toBe(false),
  );
  it.each([
    PASSAGE,
    'A sentence. Another sentence.',
    'one\ntwo',
    'x'.repeat(241),
    'You cannot have your cake and eat it too',
  ])('asks rather than rejects a large or complex selection: %s', (value) =>
    expect(reviewTarget(value)).toBe(true),
  );
  it('retains a chosen repeated word, whitespace offsets and the full original snapshot', () => {
    const c = passage(),
      start = c.selected.lastIndexOf('good'),
      chosen = narrowTarget(c, start - 1, start + 4)!;
    expect(chosen.selected).toBe('good');
    expect(chosen.text).toBe(c.text);
    expect(chosen.start).toBe(c.start + start);
    expect(chosen.text.slice(chosen.start, chosen.end)).toBe('good');
    expect(c.selected).toBe(PASSAGE);
  });
  it.each([
    [-1, 2],
    [0, 9999],
    [1.5, 3],
    [0, 2.5],
    [3, 3],
    [5, 2],
    [NaN, 2],
  ])('rejects invalid local offsets %s..%s', (start, end) =>
    expect(narrowTarget(passage(), start, end)).toBeNull(),
  );
  it('requires a nonempty bounded target but permits a whole long idiom', () => {
    expect(narrowTarget(capture({ selected: '   ' }), 0, 3)).toBeNull();
    expect(narrowTarget(capture({ selected: 'x'.repeat(241) }), 0, 241)).toBeNull();
    const selected = 'You cannot have your cake and eat it too';
    expect(narrowTarget(capture({ selected }), 0, selected.length)!.selected).toBe(selected);
  });
  it('blocks unverified legacy passage cards, persists verification and invalidates it when the answer changes', () => {
    const d = draft({ answer: PASSAGE, context: PASSAGE, answerStart: 0 });
    expect(needsTargetValidation(d)).toBe(true);
    expect(issues(d)[0]).toContain('Choose');
    d.targetValidated = PASSAGE;
    expect(needsTargetValidation(d)).toBe(false);
    const restored = restoreData({ drafts: [d] }).drafts[0]!;
    expect(restored.targetValidated).toBe(PASSAGE);
    restored.answer += ' changed';
    expect(needsTargetValidation(restored)).toBe(true);
    expect(
      restoreData({ drafts: [{ ...d, targetValidated: 'different', targetNeedsReview: true }] })
        .drafts[0],
    ).toMatchObject({ targetNeedsReview: true });
    expect(
      restoreData({ drafts: [{ ...d, targetValidated: 3 }] }).drafts[0]!.targetValidated,
    ).toBeUndefined();
    expect(needsTargetValidation(draft({ targetNeedsReview: true }))).toBe(true);
    expect(needsTargetValidation(draft())).toBe(false);
  });
});
describe('model target scope verification', () => {
  it('allows inflection and whitespace normalization while preserving the whole selected phrase', () => {
    expect(() =>
      verifyTarget('had been\n resorted to', {
        status: 'ready',
        target_is_single_item: true,
        target_source_form: 'had been resorted to',
        lemma: 'resort to',
      }),
    ).not.toThrow();
  });
  it.each([
    { target_is_single_item: false, target_source_form: PASSAGE },
    { target_is_single_item: true, target_source_form: 'good' },
    { target_is_single_item: 'true', target_source_form: PASSAGE },
    { target_is_single_item: true, target_source_form: 3 },
    {},
  ])('refuses silently narrowed or unverifiable targets %#', (value) =>
    expect(() => verifyTarget(PASSAGE, { status: 'ready', ...value })).toThrow(
      TargetSelectionError,
    ),
  );
  it('preserves ordinary ambiguity while rejecting a passage even if marked ambiguous', () => {
    expect(() => verifyTarget('bank', { status: 'ambiguous' })).not.toThrow();
    expect(() =>
      verifyTarget(PASSAGE, { status: 'ambiguous', target_is_single_item: false }),
    ).toThrow(TargetSelectionError);
  });
  it('does not request meanings, formation or examples after the model chooses one word from a passage', async () => {
    const request = vi.spyOn(http, 'jsonRequest').mockResolvedValue(
      response(
        rawContent({
          lemma: 'good',
          target_is_single_item: false,
          target_source_form: 'good',
          examples: [],
        }),
      ),
    );
    await expect(
      new Ollama(DEFAULTS).generate(PASSAGE, PASSAGE, new AbortController().signal),
    ).rejects.toThrow(TargetSelectionError);
    expect(request).toHaveBeenCalledOnce();
  });
  it('keeps an inflected phrase as the answer while accepting its dictionary lemma', async () => {
    vi.spyOn(http, 'jsonRequest').mockResolvedValue(
      response(rawContent({ target_source_form: 'brushed off', examples: [] })),
    );
    const settings = {
      ...DEFAULTS,
      fields: {
        ...DEFAULTS.fields,
        ipa: 'off' as const,
        generalMeaningSentences: 0,
        wordFormation: false,
        examples: false,
      },
    };
    expect(
      (
        await new Ollama(settings).generate(
          'brushed off',
          'She brushed off the warning.',
          new AbortController().signal,
        )
      ).content.expression,
    ).toBe('brush off');
  });
});
describe('target selection before capture and recovery after model errors', () => {
  function setup() {
    const f = pluginFixture();
    f.plugin.drafts = [];
    vi.spyOn(f.plugin, 'openPanel').mockResolvedValue({ show: vi.fn() } as any);
    const generate = vi.spyOn(f.plugin, 'generate').mockResolvedValue();
    return { ...f, generate };
  }
  it('waits for a precise target before creating a draft or touching the source', async () => {
    const f = setup(),
      work = deferred<ReturnType<typeof capture> | null>();
    const choose = vi.spyOn(f.plugin, 'chooseTarget').mockReturnValue(work.promise);
    f.plugin.settings.markSourceWord = true;
    const running = f.plugin.capture(passage());
    expect(f.plugin.drafts).toEqual([]);
    expect(f.vault.process).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    const c = passage(),
      start = c.selected.lastIndexOf('good');
    work.resolve(narrowTarget(c, start, start + 4));
    await running;
    expect(choose).toHaveBeenCalledOnce();
    expect(f.plugin.drafts[0]!.answer).toBe('good');
    expect(f.plugin.drafts[0]!.capture.text).toBe(c.text);
    expect(f.generate).toHaveBeenCalledOnce();
  });
  it('permits an explicitly confirmed long expression instead of enforcing a word-count cap', async () => {
    const f = setup(),
      selected = 'You cannot have your cake and eat it too',
      c = capture({ text: selected, selected, start: 0, end: selected.length });
    vi.spyOn(f.plugin, 'chooseTarget').mockResolvedValue(c);
    await f.plugin.capture(c);
    expect(f.plugin.drafts[0]!.answer).toBe(selected);
    expect(f.generate).toHaveBeenCalledOnce();
  });
  for (const stop of ['cancel', 'clear', 'unload'] as const)
    it(`does not create a delayed draft after ${stop}`, async () => {
      const f = setup(),
        work = deferred<ReturnType<typeof capture> | null>();
      vi.spyOn(f.plugin, 'chooseTarget').mockReturnValue(work.promise);
      const running = f.plugin.capture(passage());
      if (stop === 'clear') await f.plugin.clearDrafts();
      if (stop === 'unload') f.plugin.onunload();
      work.resolve(stop === 'cancel' ? null : passage());
      await running;
      expect(f.plugin.drafts).toEqual([]);
      expect(f.generate).not.toHaveBeenCalled();
    });
  it('shows a recoverable target error and blocks Anki approval', async () => {
    const { plugin, d } = pluginFixture();
    vi.spyOn(Ollama.prototype, 'generate').mockRejectedValue(new TargetSelectionError());
    await plugin.generate(d);
    expect(d.targetNeedsReview).toBe(true);
    expect(issues(d)[0]).toContain('Choose');
    vi.mocked(Ollama.prototype.generate).mockResolvedValue({ content: content(), seconds: 1 });
    await plugin.generate(d);
    expect(d.targetNeedsReview).toBeUndefined();
    expect(d.targetValidated).toBe(d.answer);
  });
  it('does not turn a canceled scope response into a review error', async () => {
    const { plugin, d } = pluginFixture(),
      work = deferred<any>();
    vi.spyOn(Ollama.prototype, 'generate').mockReturnValue(work.promise);
    const running = plugin.generate(d);
    plugin.cancel(d);
    work.reject(new TargetSelectionError());
    await running;
    expect(d.targetNeedsReview).toBeUndefined();
  });
  it.each(['ambiguous', 'unknown'] as const)(
    'does not certify an unresolved %s response as a verified target',
    async (status) => {
      const { plugin, d } = pluginFixture();
      d.targetNeedsReview = true;
      vi.spyOn(Ollama.prototype, 'generate').mockResolvedValue({
        content: content({ status }),
        seconds: 1,
      });
      await plugin.generate(d);
      expect(d.targetNeedsReview).toBe(true);
      expect(d.targetValidated).toBeUndefined();
      expect(issues(d)[0]).toContain('Choose');
    },
  );
  it('replaces stale teaching fields only after the user chooses a new target, then regenerates', async () => {
    const { plugin, d } = pluginFixture();
    d.targetNeedsReview = true;
    d.targetValidated = 'old';
    d.seconds = 1;
    d.pendingContent = content();
    d.pendingSource = { context: d.context, answer: d.answer };
    d.duplicates = [99];
    d.allowDuplicate = true;
    d.exampleGroups = [{ meaning: 'Old sense', examples: ['Old example.'] }];
    const start = d.context.indexOf('warning');
    vi.spyOn(plugin, 'chooseTarget').mockResolvedValue({
      ...d.capture,
      text: d.context,
      selected: 'warning',
      start,
      end: start + 7,
    });
    const generate = vi.spyOn(plugin, 'generate').mockResolvedValue();
    await plugin.refineTarget(d);
    expect(d.answer).toBe('warning');
    expect(d.answerStart).toBe(start);
    expect(d.meaning).toBe('');
    expect(d.generalMeaning).toBeUndefined();
    expect(d.exampleGroups).toBeUndefined();
    expect(d.pendingContent).toBeUndefined();
    expect(d.pendingSource).toBeUndefined();
    expect(d.seconds).toBeUndefined();
    expect(d.targetNeedsReview).toBeUndefined();
    expect(d.targetValidated).toBeUndefined();
    expect(d.duplicates).toBeUndefined();
    expect(d.allowDuplicate).toBe(false);
    expect(generate).toHaveBeenCalledWith(d);
  });
  it('keeps manual content when the whole current phrase is confirmed again', async () => {
    const { plugin, d } = pluginFixture(),
      before = structuredClone(d);
    const choose = vi
      .spyOn(plugin, 'chooseTarget')
      .mockResolvedValue({
        ...d.capture,
        text: d.context,
        selected: d.answer,
        start: d.answerStart,
        end: d.answerStart + d.answer.length,
      });
    const generate = vi.spyOn(plugin, 'generate').mockResolvedValue();
    await plugin.refineTarget(d);
    expect(choose).toHaveBeenCalledWith(
      expect.objectContaining({ text: d.context, selected: d.answer, start: d.answerStart }),
    );
    expect(d).toEqual(before);
    expect(generate).toHaveBeenCalledWith(d);
  });
  it('offers the preserved context if the old answer is no longer valid', async () => {
    const { plugin, d } = pluginFixture();
    d.answerStart = -1;
    const choose = vi.spyOn(plugin, 'chooseTarget').mockResolvedValue(null);
    await plugin.refineTarget(d);
    expect(choose).toHaveBeenCalledWith(
      expect.objectContaining({
        text: d.context,
        selected: d.context,
        start: 0,
        end: d.context.length,
      }),
    );
  });
  for (const change of [
    'cancel',
    'clear',
    'unload',
    'discard',
    'revision',
    'context',
    'phase',
  ] as const)
    it(`keeps later edits and state if a pending target choice becomes stale: ${change}`, async () => {
      const { plugin, d } = pluginFixture(),
        work = deferred<ReturnType<typeof capture> | null>();
      vi.spyOn(plugin, 'chooseTarget').mockReturnValue(work.promise);
      const generate = vi.spyOn(plugin, 'generate').mockResolvedValue();
      const running = plugin.refineTarget(d);
      if (change === 'clear') await plugin.clearDrafts();
      if (change === 'unload') plugin.onunload();
      if (change === 'discard') plugin.discard(d);
      if (change === 'revision') d.revision++;
      if (change === 'context') d.context += ' Edited.';
      if (change === 'phase') d.phase = 'sending';
      work.resolve(change === 'cancel' ? null : capture());
      await running;
      expect(d.meaning).toBe('Dismiss something without consideration.');
      expect(generate).not.toHaveBeenCalled();
    });
  it.each(['sending', 'generating', 'saved'] as const)(
    'does not refine a %s draft',
    async (phase) => {
      const { plugin, d } = pluginFixture();
      d.phase = phase;
      const choose = vi.spyOn(plugin, 'chooseTarget');
      await plugin.refineTarget(d);
      expect(choose).not.toHaveBeenCalled();
    },
  );
  it('does not refine after unload', async () => {
    const { plugin, d } = pluginFixture();
    plugin.onunload();
    const choose = vi.spyOn(plugin, 'chooseTarget');
    await plugin.refineTarget(d);
    expect(choose).not.toHaveBeenCalled();
  });
});
