import { ItemView, Notice, setIcon, type WorkspaceLeaf } from 'obsidian';
import type ContextCardsPlugin from './main';
import { cardFields, EXAMPLE_COUNT, type Draft } from './types';
import { answerValid, contextHtml, htmlText, issues, updateContext, typedAnswer } from './text';
import { visibleDraft } from './fields';
import { CARD_CSS, examplesHtml } from './templates';

export const VIEW_TYPE = 'context-cards-review';
export class ReviewView extends ItemView {
  private currentId = '';
  private tab: 'edit' | 'preview' = 'edit';
  private direction: 'recognition' | 'recall' = 'recognition';
  private back = false;
  private previewFrame?: HTMLIFrameElement;
  private previewObserver?: ResizeObserver;
  private footer?: HTMLElement;
  private destination?: HTMLElement;
  private warning?: HTMLElement;
  private answerChip?: HTMLElement;
  private sections = new Map<string, boolean>();
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: ContextCardsPlugin,
  ) {
    super(leaf);
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return 'Context Cards';
  }
  getIcon() {
    return 'book-open-check';
  }
  async onOpen() {
    this.render();
  }
  async onClose() {
    this.previewObserver?.disconnect();
  }
  show(draft: Draft) {
    this.currentId = draft.id;
    this.tab = 'edit';
    this.back = false;
    this.render();
  }
  active(): Draft | undefined {
    return this.plugin.drafts.find((v) => v.id === this.currentId) ?? this.plugin.drafts.at(-1);
  }
  private button(
    parent: HTMLElement,
    text: string,
    action: () => void,
    cls = '',
  ): HTMLButtonElement {
    const button = parent.createEl('button', { text, cls });
    button.type = 'button';
    button.addEventListener('click', action);
    return button;
  }
  private changed(draft: Draft) {
    draft.revision++;
    draft.error = '';
    draft.duplicates = undefined;
    draft.allowDuplicate = false;
    this.plugin.persist();
    this.answerChip?.toggleClass('is-invalid', !answerValid(draft));
    this.refreshFooter(draft);
  }
  private field(
    parent: HTMLElement,
    label: string,
    value: string,
    action: (v: string) => void,
    options: { multiline?: boolean; rows?: number; hint?: string } = {},
  ): HTMLInputElement | HTMLTextAreaElement {
    const wrapper = parent.createDiv({ cls: 'cc-field' });
    const id = `cc-${crypto.randomUUID()}`;
    wrapper.createEl('label', { text: label, attr: { for: id } });
    const input = options.multiline
      ? wrapper.createEl('textarea', { attr: { rows: String(options.rows ?? 3) } })
      : wrapper.createEl('input', { type: 'text' });
    input.id = id;
    input.dataset.ccField = label;
    input.value = value;
    input.spellcheck = true;
    input.addEventListener('input', () => action(input.value));
    if (options.hint) {
      input.title = options.hint;
      input.setAttribute('aria-description', options.hint);
    }
    return input;
  }
  private section(parent: HTMLElement, key: string, label: string): HTMLDetailsElement {
    const details = parent.createEl('details', { cls: 'cc-section' });
    details.dataset.ccSection = key;
    details.open = this.sections.get(key) ?? false;
    const summary = details.createEl('summary', { text: label });
    if (key === 'explanation' || key === 'examples') {
      summary.addEventListener('click', () => {
        if (details.open) return;
        const win = details.ownerDocument.defaultView;
        win?.requestAnimationFrame(() => {
          if (!details.isConnected || !details.open) return;
          details.scrollIntoView({
            block: 'start',
            inline: 'nearest',
            behavior: win.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 'instant'
              : 'smooth',
          });
        });
      });
    }
    return details;
  }
  render() {
    this.previewObserver?.disconnect();
    this.previewFrame = undefined;
    const root = this.contentEl;
    for (const details of Array.from(
      root.querySelectorAll<HTMLDetailsElement>('details[data-cc-section]'),
    ))
      this.sections.set(details.dataset.ccSection!, details.open);
    const focused = root.ownerDocument.activeElement as
      HTMLInputElement | HTMLTextAreaElement | null;
    const focusKey = focused && root.contains(focused) ? focused.dataset.ccField : undefined;
    const cursor =
      focused && typeof focused.selectionStart === 'number'
        ? ([focused.selectionStart, focused.selectionEnd ?? focused.selectionStart] as const)
        : undefined;
    const scrollTop = root.scrollTop;
    this.answerChip = undefined;
    this.destination = undefined;
    root.empty();
    root.addClass('cc-panel');
    root.lang = 'en';
    const header = root.createDiv({ cls: 'cc-panel-header' });
    const brand = header.createDiv({ cls: 'cc-brand' });
    const icon = brand.createSpan();
    setIcon(icon, 'book-open-check');
    brand.createSpan({ text: 'Context Cards' });
    const settings = this.button(header, '', () => this.plugin.openSettings(), 'clickable-icon');
    setIcon(settings, 'settings-2');
    settings.setAttribute('aria-label', 'Open Context Cards settings');
    const draft = this.active();
    if (!draft) {
      const empty = root.createDiv({ cls: 'cc-empty' });
      empty.createDiv({ cls: 'cc-empty-icon', text: 'Aa' });
      empty.createEl('h2', { text: 'Keep the words worth keeping.' });
      empty.createEl('p', {
        text: 'Select a word or expression in your book, then click Create cards or use the editor context menu.',
      });

      this.button(empty, 'Check connections', () => this.plugin.checkConnections());

      return;
    }
    this.currentId = draft.id;
    const switcher = root.createDiv({ cls: 'cc-draft-switcher' });
    const select = switcher.createEl('select', { attr: { 'aria-label': 'Choose a draft' } });
    select.dataset.ccField = 'draft-switcher';
    for (const item of [...this.plugin.drafts].reverse())
      select.createEl('option', {
        text: `${item.phase === 'saved' ? '✓ ' : ''}${item.expression || item.answer}`,
        value: item.id,
      });
    select.value = draft.id;
    select.addEventListener('change', () => {
      this.currentId = select.value;
      this.render();
    });
    const clear = this.button(
      switcher,
      'Clear all',
      () => void this.plugin.clearDrafts(),
      'cc-clear-drafts',
    );
    clear.setAttribute('aria-label', 'Clear all drafts');
    clear.title =
      'Remove all drafts from this panel and cancel pending generations. Anki notes are kept.';
    const source = root.createDiv({ cls: 'cc-source-heading' });
    source.createSpan({ text: draft.capture.book });
    const original = this.button(source, 'Open source', () => this.plugin.openSource(draft));
    original.addClass('cc-link-button');
    const tabs = root.createDiv({ cls: 'cc-tabs' });
    this.button(
      tabs,
      'Edit',
      () => {
        this.tab = 'edit';
        this.render();
      },
      this.tab === 'edit' ? 'is-active' : '',
    );
    this.button(
      tabs,
      'Preview',
      () => {
        this.tab = 'preview';
        this.back = false;
        this.render();
      },
      this.tab === 'preview' ? 'is-active' : '',
    );
    tabs.querySelectorAll('button')[0]?.setAttribute('aria-label', 'Edit draft');
    tabs.querySelectorAll('button')[1]?.setAttribute('aria-label', 'Preview cards');
    this.warning = root.createDiv({
      cls: 'cc-warning',
      attr: { role: 'status', 'aria-live': 'polite' },
    });
    if (draft.phase === 'generating') {
      const busy = root.createDiv({ cls: 'cc-busy' });
      busy.createSpan({ cls: 'cc-spinner' });
      busy.createDiv({ text: 'Preparing your draft…' });
      this.button(busy, 'Cancel', () => this.plugin.cancel(draft));
      busy.title = 'The first request can take longer while the model loads.';
    }
    if (draft.pendingContent) {
      const suggestion = root.createDiv({ cls: 'cc-suggestion' });
      suggestion.createEl('strong', { text: 'A new version is ready.' });
      suggestion.createEl('p', {
        text: 'Your current edits are intact. Replace the teaching fields with the new version, or keep your draft.',
      });
      this.button(
        suggestion,
        'Apply new version',
        () => {
          if (
            draft.pendingSource &&
            (draft.pendingSource.context !== draft.context ||
              draft.pendingSource.answer !== draft.answer)
          ) {
            delete draft.pendingContent;
            delete draft.pendingSource;
            this.changed(draft);
            draft.error =
              'The source changed after this version was generated. Generate again for the updated passage.';
            this.render();
            return;
          }
          Object.assign(draft, draft.pendingContent);
          delete draft.pendingContent;
          delete draft.pendingSource;
          this.changed(draft);
          this.render();
        },
        'mod-cta',
      );
      this.button(suggestion, 'Keep my draft', () => {
        delete draft.pendingContent;
        delete draft.pendingSource;
        this.changed(draft);
        this.render();
      });
    }
    if (draft.phase === 'saved') {
      const saved = root.createDiv({ cls: 'cc-success' });
      saved.createEl('strong', { text: 'Two cards added to Anki.' });
      saved.createDiv({ text: draft.deck });
      this.button(
        saved,
        'Open in Anki',
        () => void this.plugin.openAnki([draft.noteId!]),
        'mod-cta',
      );
      this.button(saved, 'Continue reading', () => {
        void this.plugin.openSource(draft);
      });
    }
    const body = root.createDiv({ cls: 'cc-panel-body' });
    if (this.tab === 'preview') this.renderPreview(body, draft);
    else this.renderEditor(body, draft);
    this.footer = root.createDiv({ cls: 'cc-footer' });
    this.refreshFooter(draft);
    if (focusKey) {
      const replacement = Array.from(
        root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-cc-field]'),
      ).find((e) => e.dataset.ccField === focusKey);
      if (replacement && !replacement.disabled) {
        replacement.focus({ preventScroll: true });
        if (cursor && typeof replacement.setSelectionRange === 'function')
          replacement.setSelectionRange(...cursor);
      }
    }
    root.scrollTop = draft.phase === 'saved' ? 0 : scrollTop;
  }
  private renderEditor(body: HTMLElement, draft: Draft) {
    const disabled = draft.phase === 'saved' || draft.phase === 'sending';
    const update = (action: () => void) => {
      action();
      this.changed(draft);
    };
    const word = this.field(body, 'Word or expression', draft.expression, (v) =>
      update(() => {
        draft.expression = v;
      }),
    );
    word.parentElement?.addClass('cc-word');
    word.parentElement?.querySelector('label')?.addClass('cc-sr-only');
    const metadata = body.createDiv({ cls: 'cc-metadata-fields' });
    this.field(
      metadata,
      'Grammar',
      draft.partOfSpeech,
      (v) =>
        update(() => {
          draft.partOfSpeech = v;
        }),
      { hint: 'For example: plural noun, adjective, phrasal verb.' },
    );
    const ipa = this.field(
      metadata,
      draft.ipaVariant === 'british' ? 'British IPA' : 'American IPA',
      draft.americanIpa,
      (v) =>
        update(() => {
          draft.americanIpa = v;
        }),
      { hint: 'Pronunciation of the displayed dictionary entry.' },
    );
    ipa.spellcheck = false;
    this.field(
      body,
      'Meaning in this context',
      draft.meaning,
      (v) =>
        update(() => {
          draft.meaning = v;
        }),
      { multiline: true, rows: 2, hint: 'Used as the hidden definition on the recall card.' },
    );
    this.field(
      body,
      'General meaning',
      draft.generalMeaning ?? '',
      (v) =>
        update(() => {
          draft.generalMeaning = v;
        }),
      { multiline: true, rows: 2 },
    );
    const formation = this.field(
      body,
      'Word formation',
      draft.wordFormation ?? '',
      (v) =>
        update(() => {
          draft.wordFormation = v;
        }),
      { multiline: true, rows: 2 },
    );
    if (draft.wordFormation === '') formation.placeholder = 'No separate base word identified.';
    if (draft.wordFormation === undefined) {
      const fill = this.button(
        body,
        'Find base word',
        () => void this.plugin.generateWordFormation(draft),
        'cc-fill-general',
      );
      fill.disabled = draft.phase === 'generating' || !draft.expression.trim();
    }
    const context = this.field(
      body,
      'Context from your book',
      draft.context,
      (v) => update(() => updateContext(draft, v)),
      { multiline: true, rows: 3 },
    ) as HTMLTextAreaElement;
    context.parentElement?.addClass('cc-context-field');
    const tools = this.section(body, 'context', '');
    tools.addClass('cc-context-tools');
    const answer = tools.querySelector('summary')!;
    answer.addClass('cc-answer-chip');
    this.answerChip = answer;
    answer.appendText('Answer: ');
    answer.createEl('strong', { text: typedAnswer(draft.answer) });
    if (!answerValid(draft)) {
      answer.addClass('is-invalid');
      tools.open = true;
    }
    const controls = tools.createDiv({ cls: 'cc-context-controls' });
    this.button(controls, 'Use selection as answer', () => {
      const start = context.selectionStart,
        end = context.selectionEnd,
        selected = context.value.slice(start, end);
      if (!selected.trim()) {
        new Notice('Highlight the word or expression inside the context field first.');
        return;
      }
      draft.answer = selected.trim();
      draft.answerStart = start + selected.length - selected.trimStart().length;
      this.changed(draft);
      this.render();
    });
    this.button(controls, 'More context', () => this.plugin.expandContext(draft));
    const original = this.section(tools, 'original', 'Original selection');
    original.addClass('cc-original');
    original.createEl('blockquote', { text: draft.capture.selected });
    original.createDiv({ cls: 'cc-muted', text: draft.capture.file });
    const explanationSection = this.section(body, 'explanation', 'Explanation & usage notes');
    explanationSection.addClass('cc-teaching-section');
    this.field(
      explanationSection,
      'Explanation',
      draft.explanation,
      (v) =>
        update(() => {
          draft.explanation = v;
        }),
      { multiline: true, rows: 2 },
    );
    this.field(
      explanationSection,
      'Usage notes',
      draft.notes.join('\n'),
      (v) =>
        update(() => {
          draft.notes = v.split('\n').filter((s) => s.trim());
        }),
      { multiline: true, rows: 2 },
    );
    const exampleCount = draft.examples.filter((v) => v.trim()).length;
    const groupCount = draft.exampleGroups?.length;
    const examples = this.section(
      body,
      'examples',
      exampleCount
        ? `Examples · ${groupCount ? `${groupCount} ${groupCount === 1 ? 'usage' : 'usages'} · ` : ''}${exampleCount} examples`
        : 'Examples',
    );
    examples.addClass('cc-examples');
    examples.addClass('cc-teaching-section');
    if (draft.exampleGroups?.length) {
      draft.exampleGroups.forEach((group, gi) => {
        const container = examples.createDiv({ cls: 'cc-example-group' });
        this.field(container, `Meaning / usage ${gi + 1}`, group.meaning, (v) =>
          update(() => {
            group.meaning = v;
          }),
        );
        group.examples.forEach((value, ei) => {
          const input = this.field(
            container,
            `Usage ${gi + 1}, example ${ei + 1}`,
            value,
            (v) =>
              update(() => {
                group.examples[ei] = v;
                draft.examples = draft.exampleGroups!.flatMap((g) => g.examples);
              }),
            { multiline: true, rows: 2 },
          );
          input.parentElement!.addClass('cc-example');
          input.parentElement!.dataset.number = String(ei + 1);
          input.parentElement!.querySelector('label')?.addClass('cc-sr-only');
        });
      });
    } else {
      for (let i = 0; i < EXAMPLE_COUNT; i++) {
        const input = this.field(
          examples,
          `Usage example ${i + 1}`,
          draft.examples[i] ?? '',
          (v) =>
            update(() => {
              draft.examples[i] = v;
            }),
          { multiline: true, rows: 2 },
        );
        const row = input.parentElement!;
        row.addClass('cc-example');
        row.dataset.number = String(i + 1);
        row.querySelector('label')?.addClass('cc-sr-only');
      }
    }
    const destination = body.createDiv({ cls: 'cc-destination' });
    this.destination = destination;
    const deckRow = destination.createDiv({ cls: 'cc-deck-row' });
    const icon = deckRow.createSpan({ cls: 'cc-deck-icon' });
    setIcon(icon, 'layers');
    icon.setAttribute('aria-hidden', 'true');
    const deck = this.field(deckRow, 'Deck', draft.deck, (v) =>
      update(() => {
        draft.deck = v;
      }),
    );
    deck.parentElement!.querySelector('label')?.addClass('cc-sr-only');
    deck.setAttribute('placeholder', 'Choose an Anki deck');
    deck.setAttribute('title', draft.deck);
    const technical = this.section(destination, 'anki', 'Tags');
    technical.addClass('cc-technical');
    technical.addClass('cc-destination-tools');
    const listId = `cc-decks-${crypto.randomUUID()}`;
    deck.setAttribute('list', listId);
    const options = technical.createEl('datalist', { attr: { id: listId } });
    for (const name of this.plugin.deckNames) options.createEl('option', { value: name });
    this.field(
      technical,
      'Tags',
      draft.tags,
      (v) =>
        update(() => {
          draft.tags = v;
        }),
      { hint: 'Separate tags with spaces. Use :: for nested tags.' },
    );
    this.button(technical, 'Refresh decks', () => this.plugin.refreshDecks());
    const f = cardFields(this.plugin.settings);
    const enabled: Record<string, boolean> = {
      Grammar: f.grammar,
      'American IPA': f.ipa !== 'off',
      'British IPA': f.ipa !== 'off',
      'Meaning in this context': !!f.meaningSentences,
      'General meaning': !!f.generalMeaningSentences,
      'Word formation': f.wordFormation,
      'Context from your book': f.context,
      Explanation: !!f.explanationSentences,
    };
    for (const label of Array.from(body.querySelectorAll('label'))) {
      if (enabled[label.textContent ?? ''] === false) label.parentElement!.hidden = true;
    }
    metadata.hidden = !f.grammar && f.ipa === 'off';
    examples.hidden = !f.examples;
    if (!f.explanationSentences)
      explanationSection.querySelector('summary')!.textContent = 'Usage notes';
    tools.hidden = !f.context;
    for (const button of Array.from(body.querySelectorAll('button')))
      if (button.textContent === 'Find base word') button.hidden = !f.wordFormation;
    if (disabled)
      for (const control of Array.from(body.querySelectorAll('input,textarea,button')))
        (control as HTMLInputElement).disabled = true;
  }
  private renderPreview(body: HTMLElement, draft: Draft) {
    const toolbar = body.createDiv({ cls: 'cc-preview-toolbar' });
    this.button(toolbar, 'Recognition', () => {
      this.direction = 'recognition';
      this.back = false;
      this.updatePreview(draft);
    });
    this.button(toolbar, 'Recall', () => {
      this.direction = 'recall';
      this.back = false;
      this.updatePreview(draft);
    });
    this.button(toolbar, 'Flip card', () => {
      this.back = !this.back;
      this.updatePreview(draft);
    });
    const frame = body.createEl('iframe', {
      cls: 'cc-preview-frame',
      attr: { title: 'Anki card preview', sandbox: 'allow-same-origin' },
    });
    this.previewFrame = frame;
    frame.addEventListener('load', () => {
      if (this.previewFrame !== frame || !frame.contentDocument?.body) return;
      this.previewObserver?.disconnect();
      const content = frame.contentDocument.body;
      const resize = () => {
        frame.style.height = `${Math.ceil(content.getBoundingClientRect().height) + 2}px`;
      };
      this.previewObserver = new ResizeObserver(resize);
      this.previewObserver.observe(content);
      resize();
    });
    frame.title = 'Anki card preview. Typed answers are compared during review in Anki.';
    this.updatePreview(draft);
  }
  private updatePreview(draft: Draft) {
    if (!this.previewFrame) return;
    const original = draft;
    draft = visibleDraft(draft, this.plugin.settings);
    const list = (values: string[]) =>
      `<ul>${values
        .filter(Boolean)
        .map((v) => `<li>${htmlText(v)}</li>`)
        .join('')}</ul>`;
    let html = '';
    if (this.direction === 'recognition')
      html =
        `<div class="cc-eyebrow">Recall the meaning used in the source</div><div class="cc-expression">${htmlText(draft.expression)}</div>` +
        (this.back
          ? draft.context
            ? `<div class="cc-context">${contextHtml(draft)}</div>`
            : ''
          : draft.context
            ? `<details class="cc-details"><summary>Show context</summary><div>${contextHtml(draft)}</div></details>`
            : '');
    else
      html =
        `<div class="cc-eyebrow">Restore the original word or expression</div><div class="cc-context">${contextHtml(original, true)}</div>` +
        (this.back
          ? `<div class="cc-expression">${htmlText(typedAnswer(draft.answer))}</div>`
          : ` ${draft.meaning ? `<details class="cc-details"><summary>Show definition</summary><div>${htmlText(draft.meaning)}</div></details>` : ''}<input id="typeans" aria-label="Your answer" placeholder="Type the missing expression" autocomplete="off">`);
    if (this.back)
      html +=
        `<div class="cc-notes">${[draft.partOfSpeech, draft.americanIpa].filter(Boolean).map(htmlText).join(' · ')}</div>` +
        `<hr id="answer">${draft.meaning ? `<div class="cc-label">Meaning in this context</div><div class="cc-meaning">${htmlText(draft.meaning)}</div>` : ''}${draft.generalMeaning ? `<div class="cc-label">General meaning</div><div>${htmlText(draft.generalMeaning)}</div>` : ''}${draft.wordFormation ? `<div class="cc-label">Word formation</div><div>${htmlText(draft.wordFormation)}</div>` : ''}${draft.explanation ? `<div class="cc-label">Explanation</div><div>${htmlText(draft.explanation)}</div>` : ''}${draft.examples.length ? `<div class="cc-label">Usage examples</div>${examplesHtml(draft)}` : ''}${draft.notes.length ? `<div class="cc-label">Usage notes</div>${list(draft.notes)}` : ''}`;
    const bodyClass = this.contentEl.ownerDocument.body.classList.contains('theme-dark')
      ? 'card nightMode'
      : 'card';
    this.previewFrame.srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>${CARD_CSS}body{margin:0;padding:20px}input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #cdd5c5;border-radius:6px;font:inherit}</style></head><body class="${bodyClass}"><div class="cc-card">${html}</div></body></html>`;
  }
  private refreshFooter(draft: Draft) {
    if (this.warning) {
      this.warning.empty();
      if (draft.error) this.warning.createDiv({ text: draft.error });
      if (draft.status !== 'ready' && draft.question)
        this.warning.createDiv({ text: draft.question });
      this.warning.toggleClass('is-visible', !!draft.error || draft.status !== 'ready');
    }
    if (!this.footer) return;
    if (draft.phase === 'saved' || this.tab === 'preview') {
      this.footer.empty();
      return;
    }
    // Keep destination inputs mounted while footer validation/actions refresh on each keystroke.
    for (const child of Array.from(this.footer.children))
      if (child !== this.destination) child.remove();
    if (this.destination && this.destination.parentElement !== this.footer)
      this.footer.appendChild(this.destination);
    if (draft.duplicates?.length) {
      const duplicate = this.footer.createDiv({ cls: 'cc-duplicate' });
      duplicate.createDiv({ text: 'This expression is already in Anki.' });
      this.button(duplicate, 'View existing', () => void this.plugin.openAnki(draft.duplicates!));
      const label = duplicate.createEl('label');
      const check = label.createEl('input', { type: 'checkbox' });
      check.checked = draft.allowDuplicate;
      label.appendText(' Add as a different sense');
      check.addEventListener('change', () => {
        draft.allowDuplicate = check.checked;
        this.plugin.persist();
        this.refreshFooter(draft);
      });
    }
    const problems = issues(draft, this.plugin.settings);
    if (problems.length && draft.meaning)
      this.footer.createDiv({ cls: 'cc-validation', text: problems[0] });
    const actions = this.footer.createDiv({ cls: 'cc-footer-actions' });
    const generate = this.button(
      actions,
      draft.seconds !== undefined || draft.meaning || draft.explanation || draft.generalMeaning
        ? 'Regenerate'
        : 'Generate draft',
      () => void this.plugin.generate(draft),
    );
    generate.disabled = ['generating', 'sending'].includes(draft.phase);
    const approve = this.button(
      actions,
      draft.phase === 'sending' ? 'Adding…' : 'Add to Anki',
      () => void this.plugin.approve(draft),
      'mod-cta',
    );
    approve.disabled =
      problems.length > 0 ||
      ['generating', 'sending'].includes(draft.phase) ||
      !!draft.pendingContent ||
      (!!draft.duplicates?.length && !draft.allowDuplicate);
    approve.title = problems.join('\n');
    generate.title =
      draft.seconds === undefined
        ? 'Generate an editable draft'
        : `Last generation: ${draft.seconds.toFixed(1)}s`;
    if (draft.phase !== 'sending') {
      const discard = this.button(
        actions,
        '',
        () => this.plugin.discard(draft),
        'cc-discard clickable-icon',
      );
      setIcon(discard, 'trash-2');
      discard.setAttribute('aria-label', 'Discard draft');
      discard.title = 'Discard draft';
    }
  }
}
