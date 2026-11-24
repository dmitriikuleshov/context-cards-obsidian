// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ReviewView } from '../src/view';
import type ContextCardsPlugin from '../src/main';
import { DEFAULTS, type Content } from '../src/types';
import { createDraft } from '../src/text';
import { installDomHelpers } from './dom';
beforeAll(installDomHelpers);
function setup() {
  const draft = createDraft(
    {
      text: 'She brushed off my advice.',
      start: 4,
      end: 15,
      selected: 'brushed off',
      file: 'Book.md',
      book: 'Book',
      vault: 'Test',
      mode: 'reading',
    },
    DEFAULTS,
  );
  Object.assign(draft, {
    expression: 'brush off',
    partOfSpeech: 'phrasal verb',
    americanIpa: '/bɹʌʃ ɔf/',
    meaning: 'dismiss without considering',
    explanation: 'She dismissed the advice.',
    examples: [
      'He brushed off my advice.',
      'They brushed off the warning.',
      'She brushed off the criticism.',
      'We brushed off his suggestion.',
      'They brushed off our complaints.',
    ],
  });
  const plugin = {
    settings: structuredClone(DEFAULTS),
    drafts: [draft],
    deckNames: [],
    persist: vi.fn(),
    approve: vi.fn(),
    generate: vi.fn(),
    generateGeneralMeaning: vi.fn(),
    generateWordFormation: vi.fn(),
    discard: vi.fn(),
    clearDrafts: vi.fn(),
    expandContext: vi.fn(),
    openSource: vi.fn(),
    openSettings: vi.fn(),
    openAnki: vi.fn(),
  } as unknown as ContextCardsPlugin;
  const view = new ReviewView({} as any, plugin);
  view.show(draft);
  document.body.replaceChildren(view.contentEl);
  const click = (text: string) => {
    const button = Array.from(view.contentEl.querySelectorAll('button')).find(
      (e) => e.textContent === text || e.getAttribute('aria-label') === text,
    );
    expect(button).toBeTruthy();
    button!.click();
  };
  const field = (label: string) => {
    const e = Array.from(view.contentEl.querySelectorAll('label')).find(
      (e) => e.textContent === label,
    )!;
    return view.contentEl.querySelector(`#${e.htmlFor}`)! as HTMLInputElement | HTMLTextAreaElement;
  };
  return { draft, plugin, view, click, field };
}
describe('editable review panel', () => {
  it('disables Clear all while any draft is exporting and unlocks it when the export finishes', () => {
    const { plugin, view, click } = setup();
    const other = { ...structuredClone(plugin.drafts[0]!), id: 'sending' };
    other.phase = 'sending';
    plugin.drafts.push(other);
    view.render();
    const clear = () =>
      view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Clear all drafts"]')!;
    expect(clear().disabled).toBe(true);
    click('Clear all drafts');
    expect(plugin.clearDrafts).not.toHaveBeenCalled();
    other.phase = 'saved';
    view.render();
    expect(clear().disabled).toBe(false);
    click('Clear all drafts');
    expect(plugin.clearDrafts).toHaveBeenCalledOnce();
  });
  it('keeps the deck visible in the footer and preserves typing focus', () => {
    const { view, field } = setup();
    const explanation = view.contentEl.querySelector<HTMLDetailsElement>(
      '[data-cc-section=explanation]',
    )!;
    const examples = view.contentEl.querySelector<HTMLDetailsElement>(
      '[data-cc-section=examples]',
    )!;
    expect(explanation.open).toBe(false);
    expect(examples.open).toBe(false);
    expect(
      explanation.compareDocumentPosition(examples) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const deck = field('Deck');
    expect(view.contentEl.querySelector('.cc-footer')!.contains(deck)).toBe(true);
    deck.focus();
    deck.value = 'English::Books::New';
    deck.setSelectionRange(10, 10);
    deck.dispatchEvent(new Event('input'));
    expect(document.activeElement).toBe(deck);
    expect(deck.selectionStart).toBe(10);
  });
  it('edits grouped examples and renders safe headings in the Anki preview', () => {
    const { draft, view, field } = setup();
    draft.exampleGroups = [
      {
        meaning: 'Dismiss a concern',
        examples: ['She brushed off the warning.', 'He brushed off my advice.'],
      },
      {
        meaning: 'Remove by brushing',
        examples: ['She brushed off the dust.', 'He brushed off the crumbs.'],
      },
    ];
    view.render();
    expect(field('Meaning / usage 2').value).toBe('Remove by brushing');
    const example = field('Usage 2, example 1');
    example.value = 'He brushed off the dirt.';
    example.dispatchEvent(new Event('input'));
    expect(draft.exampleGroups[1]!.examples[0]).toBe(example.value);
    expect(draft.examples).toContain(example.value);
  });
  it('edits general meaning separately and keeps the contextual field intact', () => {
    const { draft, field, view } = setup();
    const original = draft.meaning;
    for (const phase of ['generating', 'editing'] as const) {
      draft.phase = phase;
      view.render();
      expect(view.contentEl.textContent).not.toContain('Generate general meaning');
    }
    const general = field('General meaning');
    general.value = 'General definition. General clarification.';
    general.dispatchEvent(new Event('input'));
    expect(draft.generalMeaning).toBe(general.value);
    expect(field('Meaning in this context').value).toBe(original);
  });
  it('keeps technical fields available and remembers expanded sections after an update', () => {
    const { view, field } = setup();
    const technical = view.contentEl.querySelector<HTMLDetailsElement>('.cc-technical')!;
    expect(technical.open).toBe(false);
    technical.open = true;
    const tags = field('Tags');
    tags.value = 'english reading';
    tags.dispatchEvent(new Event('input'));
    tags.focus();
    view.render();
    expect(view.contentEl.querySelector<HTMLDetailsElement>('.cc-technical')!.open).toBe(true);
    expect(field('Tags').value).toBe('english reading');
    expect(document.activeElement).toBe(field('Tags'));
    expect(view.contentEl.querySelector('.cc-field-hint')).toBeNull();
  });
  it('clears the draft selector and returns to the empty panel with one click', () => {
    const { view, plugin, click } = setup();
    vi.mocked(plugin.clearDrafts).mockImplementation(async () => {
      plugin.drafts = [];
      view.render();
    });
    click('Clear all drafts');
    expect(plugin.clearDrafts).toHaveBeenCalledOnce();
    expect(view.contentEl.querySelector('select')).toBeNull();
    expect(view.contentEl.querySelector('.cc-empty')).toBeTruthy();
  });
  it('edits grammar and IPA separately and exposes five example fields', () => {
    const { draft, field } = setup();
    for (const [label, value] of [
      ['Grammar', 'plural noun'],
      ['American IPA', '/ˈveɪɡəɹiz/'],
    ]) {
      const input = field(label!);
      input.value = value!;
      input.dispatchEvent(new Event('input'));
    }
    expect(draft.partOfSpeech).toBe('plural noun');
    expect(draft.americanIpa).toBe('/ˈveɪɡəɹiz/');
    expect(field('Usage example 5')).toBeTruthy();
    expect(draft.explanation).toBe('She dismissed the advice.');
  });
  it('retains keyboard focus and caret when an asynchronous update redraws the panel', () => {
    const { view, field } = setup();
    const input = field('Explanation');
    input.focus();
    input.setSelectionRange(5, 8);
    view.render();
    const replacement = field('Explanation');
    expect(document.activeElement).toBe(replacement);
    expect(replacement.selectionStart).toBe(5);
    expect(replacement.selectionEnd).toBe(8);
  });
  it('stores edits immediately and approves the edited draft', () => {
    const { draft, plugin, field, click } = setup(),
      input = field('Explanation');
    input.value = 'My edited explanation';
    input.dispatchEvent(new Event('input'));
    expect(draft.explanation).toBe('My edited explanation');
    expect(plugin.persist).toHaveBeenCalled();
    click('Add to Anki');
    expect(plugin.approve).toHaveBeenCalledWith(draft);
  });
  it('uses the actual highlighted range in the context editor as the answer', () => {
    const { draft, field, click } = setup(),
      context = field('Context from your book') as HTMLTextAreaElement;
    const start = draft.context.indexOf('advice');
    context.setSelectionRange(start, start + 6);
    click('Use selection as answer');
    expect(draft.answer).toBe('advice');
    expect(draft.answerStart).toBe(start);
  });
  it('shows generation and approval actions only in the editor', () => {
    const { view, click } = setup();
    const buttons = () =>
      Array.from(view.contentEl.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons()).toContain('Regenerate');
    expect(buttons()).toContain('Add to Anki');
    click('Preview cards');
    expect(buttons()).not.toContain('Regenerate');
    expect(buttons()).not.toContain('Add to Anki');
    expect(view.contentEl.querySelector('.cc-footer')!.childElementCount).toBe(0);
    click('Edit draft');
    expect(buttons()).toContain('Regenerate');
    expect(buttons()).toContain('Add to Anki');
  });
  it('previews both directions without exposing the expression on the recall front', () => {
    const { view, click } = setup();
    click('Preview cards');
    click('Recall');
    expect(
      view.contentEl.querySelector('[data-cc-direction="recall"]')!.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      view.contentEl
        .querySelector('[data-cc-direction="recognition"]')!
        .getAttribute('aria-pressed'),
    ).toBe('false');
    expect(view.contentEl.querySelector('.cc-preview-toolbar')!.textContent).not.toContain(
      'Flip card',
    );
    expect(view.contentEl.querySelector('.cc-preview-card-header')!.textContent).toContain(
      'Flip card',
    );
    const frame = () => view.contentEl.querySelector('iframe')!;
    expect(frame().srcdoc).toContain('Show definition');
    expect(frame().srcdoc).toContain('cc-gap');
    expect(frame().srcdoc).not.toContain('brush off');
    expect(frame().srcdoc).not.toContain('brushed off');
    click('Flip card');
    expect(view.contentEl.querySelector('.cc-preview-side')!.textContent).toBe('Answer');
    expect(frame().srcdoc).toContain('brushed off');
    expect(frame().getAttribute('sandbox')).toBe('allow-same-origin');
  });
  it('refuses a pending replacement after its source context is edited', () => {
    const { view, draft, field, click } = setup();
    const original = draft.meaning;
    draft.pendingContent = { ...draft, meaning: 'Meaning from the previous source.' };
    draft.pendingSource = { context: draft.context, answer: draft.answer };
    view.render();
    const context = field('Context from your book');
    context.value += ' A new sentence changes the passage.';
    context.dispatchEvent(new Event('input'));
    click('Apply new version');
    expect(draft.meaning).toBe(original);
    expect(draft.pendingContent).toBeUndefined();
    expect(draft.error).toContain('source changed');
  });
  it('makes regeneration a deliberate choice and preserves the source answer', () => {
    const { view, draft, click } = setup();
    draft.pendingContent = {
      status: 'ready',
      expression: 'new lemma',
      partOfSpeech: 'noun',
      americanIpa: '/tɜɹm/',
      meaning: 'new meaning',
      explanation: 'new explanation',
      examples: ['First.', 'Second.', 'Third.', 'Fourth.', 'Fifth.'],
      notes: [],
      question: '',
    } satisfies Content;
    view.render();
    expect(view.contentEl.textContent).toContain('Your current edits are intact');
    click('Apply new version');
    expect(draft.expression).toBe('new lemma');
    expect(draft.answer).toBe('brushed off');
    expect(draft.pendingContent).toBeUndefined();
  });
  it('requires an explicit different-sense choice when duplicates are reported', () => {
    const { view, draft } = setup();
    draft.duplicates = [42];
    view.render();
    const approve = () =>
      Array.from(view.contentEl.querySelectorAll('button')).find(
        (e) => e.textContent === 'Add to Anki',
      )!;
    expect(approve().disabled).toBe(true);
    const checkbox = view.contentEl.querySelector('input[type=checkbox]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(approve().disabled).toBe(false);
    expect(draft.allowDuplicate).toBe(true);
  });
  it('makes exported notes read-only', () => {
    const { view, draft } = setup();
    draft.phase = 'saved';
    draft.noteId = 42;
    view.render();
    expect(view.contentEl.textContent).toContain('Two cards added to Anki.');
    expect(
      Array.from(
        view.contentEl.querySelectorAll('.cc-panel-body input,.cc-panel-body textarea'),
      ).every((e) => (e as HTMLInputElement).disabled),
    ).toBe(true);
    expect(view.contentEl.querySelector('.cc-footer button')).toBeNull();
  });
});
