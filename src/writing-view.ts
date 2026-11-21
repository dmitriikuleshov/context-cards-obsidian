import { ItemView, setIcon, type WorkspaceLeaf } from 'obsidian';
import type ContextCardsPlugin from './main';
import { htmlText } from './text';
import { CARD_CSS } from './templates';
import {
  canPractise,
  writingPracticeFields,
  correctedSentence,
  type WritingSession,
  type WritingFinding,
} from './writing';

export const WRITING_VIEW = 'context-cards-writing';
export class WritingView extends ItemView {
  private current = '';
  private findingIds = new Map<string, string>();
  private tab: 'edit' | 'preview' = 'edit';
  private back = false;
  private sections = new Map<string, boolean>();
  private actions?: HTMLElement;
  private warning?: HTMLElement;
  private corrected?: HTMLElement;
  private quote?: HTMLElement;
  private cardEditor?: HTMLElement;
  private issuePicker?: HTMLSelectElement;
  private formatPicker?: HTMLSelectElement;
  constructor(
    leaf: WorkspaceLeaf,
    private host: ContextCardsPlugin,
  ) {
    super(leaf);
  }
  getViewType() {
    return WRITING_VIEW;
  }
  getDisplayText() {
    return 'Check writing';
  }
  getIcon() {
    return 'spell-check';
  }
  async onOpen() {
    this.render();
  }
  show(s: WritingSession) {
    this.current = s.id;
    this.tab = 'edit';
    this.back = false;
    this.render();
  }
  private button(root: HTMLElement, text: string, callback: () => void, cls = '') {
    const button = root.createEl('button', { text, cls });
    button.type = 'button';
    button.addEventListener('click', callback);
    return button;
  }
  private section(root: HTMLElement, key: string, title: string) {
    const section = root.createEl('details', { cls: 'cc-section' });
    section.dataset.writingSection = key;
    section.open = this.sections.get(key) ?? false;
    section.createEl('summary', { text: title });
    return section;
  }
  private field(
    root: HTMLElement,
    label: string,
    value: string,
    key: string,
    change: (v: string) => void,
    s: WritingSession,
    f?: WritingFinding,
    multiline = true,
  ) {
    const wrap = root.createDiv({ cls: 'cc-field' }),
      id = `writing-${crypto.randomUUID()}`;
    wrap.createEl('label', { text: label, attr: { for: id } });
    const input = multiline
      ? wrap.createEl('textarea', { attr: { rows: '2' } })
      : wrap.createEl('input', { type: 'text' });
    input.id = id;
    input.value = value;
    input.dataset.writingField = key;
    input.disabled = s.phase !== 'idle' || !!f?.noteId;
    input.addEventListener('input', () => {
      change(input.value);
      s.error = '';
      this.host.persist();
      // Keep the input and its ancestors mounted: typing and IME composition must not redraw the panel.
      this.updateLive(s, f);
    });
    return input;
  }
  private selected(s: WritingSession) {
    return s.findings.filter((f) => f.selected && canPractise(f) && !f.noteId);
  }
  private active(s: WritingSession) {
    return (
      s.findings.find((f) => !f.dismissed && f.id === this.findingIds.get(s.id)) ??
      s.findings.find((f) => !f.dismissed)
    );
  }
  render() {
    const root = this.contentEl;
    for (const section of Array.from(
      root.querySelectorAll<HTMLDetailsElement>('details[data-writing-section]'),
    ))
      this.sections.set(section.dataset.writingSection!, section.open);
    const active = root.ownerDocument.activeElement as
      HTMLInputElement | HTMLTextAreaElement | null;
    const focusKey = active?.dataset?.writingField;
    const cursor =
      focusKey && typeof active?.selectionStart === 'number'
        ? [active.selectionStart, active.selectionEnd]
        : undefined;
    const scroll = root.scrollTop;
    this.actions = this.warning = this.corrected = this.quote = this.cardEditor = undefined;
    this.issuePicker = undefined;
    this.formatPicker = undefined;
    root.empty();
    root.addClass('cc-panel');
    root.addClass('cc-writing-panel');
    root.lang = 'en';
    const header = root.createDiv({ cls: 'cc-panel-header' });
    header.createEl('strong', { text: 'Check writing' });
    const navigation = header.createDiv({ cls: 'cc-writing-navigation' });
    this.button(navigation, 'Vocabulary', () => void this.host.openPanel(), 'cc-link-button');
    const settings = this.button(navigation, '', () => this.host.openSettings(), 'clickable-icon');
    settings.setAttribute('aria-label', 'Context Cards settings');
    setIcon(settings, 'sliders-horizontal');
    const sessions = this.host.writing.sessions,
      s = sessions.find((s) => s.id === this.current) ?? sessions.at(-1);
    if (!s) {
      const empty = root.createDiv({ cls: 'cc-empty' });
      empty.createEl('h2', { text: 'Learn from your own writing.' });
      empty.createEl('p', {
        text: 'Select a paragraph and choose Check writing. Review corrections, then turn useful mistakes into practice.',
      });
      return;
    }
    const pickerRow = root.createDiv({ cls: 'cc-draft-switcher' });
    const picker = pickerRow.createEl('select', { attr: { 'aria-label': 'Writing review' } });
    for (const session of sessions)
      picker.createEl('option', {
        text: `${session.capture.book} · ${session.created.slice(0, 16).replace('T', ' ')}`,
        attr: { value: session.id },
      });
    picker.value = s.id;
    picker.addEventListener('change', () => {
      this.current = picker.value;
      this.tab = 'edit';
      this.back = false;
      this.render();
    });
    const source = root.createDiv({ cls: 'cc-source-heading' });
    source.createSpan({ text: s.capture.book });
    this.button(
      source,
      'Open source',
      () => void this.host.app.workspace.openLinkText(s.capture.file, '', true),
      'cc-link-button',
    );
    const tabs = root.createDiv({ cls: 'cc-tabs' });
    for (const [value, title] of [
      ['edit', 'Edit'],
      ['preview', 'Preview'],
    ] as const) {
      const b = this.button(
        tabs,
        title,
        () => {
          this.tab = value;
          this.back = false;
          this.render();
        },
        this.tab === value ? 'is-active' : '',
      );
      b.setAttribute(
        'aria-label',
        value === 'edit' ? 'Edit writing review' : 'Preview writing card',
      );
    }
    const body = root.createDiv({ cls: 'cc-panel-body' });
    if (s.phase !== 'idle') {
      const busy = body.createDiv({ cls: 'cc-busy' });
      busy.createSpan({ cls: 'cc-spinner' });
      busy.createSpan({
        text:
          s.phase === 'analysing'
            ? 'Checking writing…'
            : s.phase === 'generating'
              ? 'Preparing cards…'
              : 'Saving…',
      });
      if (['analysing', 'generating'].includes(s.phase))
        this.button(busy, 'Cancel', () => this.host.writing.cancel(s));
    }
    const visible = s.findings.filter((f) => !f.dismissed);
    if (visible.length) {
      const selector = body.createDiv({ cls: 'cc-field' });
      selector.createEl('label', {
        text: `Corrections · ${visible.length}`,
        attr: { for: 'cc-writing-correction-picker' },
      });
      const pick = selector.createEl('select', {
        attr: { id: 'cc-writing-correction-picker', 'aria-label': 'Choose a correction' },
      });
      this.issuePicker = pick;
      for (const f of visible)
        pick.createEl('option', {
          text: `${f.noteId ? 'Added · ' : f.selected ? '✓ ' : ''}${f.title} · ${f.kind}`,
          attr: { value: f.id },
        });
      const f = this.active(s)!;
      pick.value = f.id;
      pick.addEventListener('change', () => {
        this.findingIds.set(s.id, pick.value);
        this.back = false;
        this.render();
      });
      if (this.tab === 'edit') this.renderEditor(body, s, f);
      else this.renderPreview(body, s, f);
    } else if (s.analysed && s.phase === 'idle')
      body.createEl('p', {
        text: s.findings.length
          ? 'All suggestions are dismissed. Restore one from Review details below.'
          : 'No issues were flagged. You can save the review or check another selection.',
      });
    if (this.tab === 'edit') this.renderDetails(body, s);
    this.warning = body.createDiv({ cls: 'cc-warning', attr: { role: 'alert' } });
    if (this.tab === 'edit') {
      const footer = root.createDiv({ cls: 'cc-footer' });
      const destination = footer.createDiv({ cls: 'cc-destination' }),
        row = destination.createDiv({ cls: 'cc-deck-row' });
      const icon = row.createSpan({ cls: 'cc-deck-icon' });
      setIcon(icon, 'layers');
      icon.setAttribute('aria-hidden', 'true');
      const deck = this.field(
        row,
        'Writing deck',
        s.deck,
        'writing-deck',
        (v) => {
          s.deck = v;
        },
        s,
        undefined,
        false,
      );
      deck.parentElement!.querySelector('label')?.addClass('cc-sr-only');
      const tools = this.section(destination, 'footer-tools', 'More');
      tools.addClass('cc-destination-tools');
      this.button(tools, 'Save review', () => void this.host.writing.save(s)).disabled =
        s.phase !== 'idle' || !s.analysed;
      if (s.reviewPath)
        this.button(
          tools,
          'Open saved review',
          () => void this.host.app.workspace.openLinkText(s.reviewPath!, '', true),
        );
      this.actions = footer.createDiv({ cls: 'cc-footer-actions' });
    }
    this.updateLive(s, this.active(s));
    root.scrollTop = scroll;
    if (focusKey) {
      const replacement = Array.from(
        root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-writing-field]'),
      ).find((e) => e.dataset.writingField === focusKey);
      if (replacement && !replacement.disabled) {
        replacement.focus({ preventScroll: true });
        if (cursor) replacement.setSelectionRange(cursor[0]!, cursor[1]!);
      }
    }
  }
  private renderEditor(body: HTMLElement, s: WritingSession, f: WritingFinding) {
    this.quote = body.createDiv({ cls: 'cc-context cc-writing-original' });
    this.field(
      body,
      'Correction',
      f.after,
      `${f.id}-after`,
      (v) => {
        f.after = v;
        this.host.writing.editFinding(f);
      },
      s,
      f,
      false,
    );
    this.corrected = body.createDiv({ cls: 'cc-writing-correction' });
    this.field(
      body,
      'Explanation',
      f.explanation,
      `${f.id}-why`,
      (v) => {
        f.explanation = v;
        this.host.writing.editFinding(f);
      },
      s,
      f,
    );
    const notes = this.section(body, 'tip', 'Tip');
    this.field(
      notes,
      'Tip',
      f.tip,
      `${f.id}-tip`,
      (v) => {
        f.tip = v;
        this.host.writing.editFinding(f);
      },
      s,
      f,
    );
    const choose = body.createDiv({ cls: 'cc-writing-choices' });
    const label = choose.createEl('label', { cls: 'cc-writing-select' }),
      checkbox = label.createEl('input', { type: 'checkbox' });
    checkbox.checked = f.selected;
    checkbox.disabled = s.phase !== 'idle' || !!f.noteId || !canPractise(f);
    label.appendText(' Create a practice card');
    checkbox.addEventListener('change', () => {
      f.selected = checkbox.checked;
      this.host.persist();
      this.updateLive(s, f);
    });
    const format = choose.createEl('select', { attr: { 'aria-label': `Card format: ${f.title}` } });
    this.formatPicker = format;
    format.createEl('option', { text: 'Correct the mistake', attr: { value: 'correction' } });
    const gap = format.createEl('option', {
      text: 'Complete the sentence',
      attr: { value: 'gap' },
    });
    gap.disabled = !f.after.trim();
    format.value = f.format;
    format.disabled = s.phase !== 'idle' || !!f.noteId || !canPractise(f);
    format.addEventListener('change', () => {
      f.format = format.value === 'gap' ? 'gap' : 'correction';
      this.host.writing.editFinding(f);
      this.host.persist();
      this.render();
    });
    if (f.noteId) {
      body.createDiv({
        cls: 'cc-muted',
        text: f.reused ? 'Existing Anki practice reused.' : 'Added to Anki.',
      });
      this.button(body, 'Open in Anki', () => void this.host.openAnki([f.noteId!]));
    } else if (!canPractise(f))
      body.createDiv({
        cls: 'cc-muted',
        text:
          f.kind === 'unclear'
            ? 'Clarify the intended meaning before treating this as an error.'
            : f.kind === 'style'
              ? 'Optional style suggestion. No practice card is selected.'
              : 'Typing slip. No practice card is selected.',
      });
    if (f.card) {
      const card = this.section(body, 'card-fields', 'Card details');
      this.cardEditor = card;
      for (const [label, key] of [
        ['Question', 'question'],
        ['Answer', 'answer'],
        ['Corrected sentence', 'corrected'],
        ['Hint', 'hint'],
        ['Card explanation', 'explanation'],
        ['Card tip', 'tip'],
      ] as const)
        this.field(
          card,
          label,
          f.card[key],
          `${f.id}-card-${key}`,
          (v) => {
            if (f.card) f.card[key] = v;
          },
          s,
          f,
        );
    }
    const metadata = this.section(body, 'issue-details', 'Issue details');
    this.field(
      metadata,
      'Issue title',
      f.title,
      `${f.id}-title`,
      (v) => {
        f.title = v;
      },
      s,
      f,
      false,
    );
    this.field(
      metadata,
      'Highlighted text',
      f.before,
      `${f.id}-before`,
      (v) => {
        f.before = v;
        this.host.writing.editFinding(f);
      },
      s,
      f,
      false,
    );
    const category = metadata.createEl('select', { attr: { 'aria-label': 'Finding category' } });
    for (const kind of ['grammar', 'vocabulary', 'style', 'unclear', 'typo'])
      category.createEl('option', { text: kind, attr: { value: kind } });
    category.value = f.kind;
    category.disabled = s.phase !== 'idle' || !!f.noteId;
    category.addEventListener('change', () => {
      f.kind = category.value as typeof f.kind;
      if (!canPractise(f)) f.selected = false;
      this.host.writing.editFinding(f);
      this.host.persist();
      this.render();
    });
  }
  private renderDetails(body: HTMLElement, s: WritingSession) {
    const details = this.section(body, 'review-details', 'Review details');
    details.createEl('pre', { cls: 'cc-writing-source', text: s.capture.selected });
    if (s.summary) details.createEl('p', { text: s.summary });
    const recheck = this.button(
      details,
      s.analysed ? 'Recheck selection' : 'Check writing',
      () => void this.host.writing.analyse(s),
    );
    recheck.disabled = s.phase !== 'idle' || s.findings.some((f) => !!f.noteId);
    recheck.title = 'Rechecking replaces current suggestions and unexported card drafts.';
    for (const f of s.findings.filter((f) => f.dismissed))
      this.button(details, `Restore: ${f.title}`, () => {
        f.dismissed = false;
        this.host.persist();
        this.render();
      }).disabled = s.phase !== 'idle';
  }
  private renderPreview(body: HTMLElement, s: WritingSession, f: WritingFinding) {
    if (!f.card) {
      body.createEl('p', {
        text: 'Select this correction for practice, then prepare the card in Edit.',
      });
      return;
    }
    const toolbar = body.createDiv({ cls: 'cc-preview-toolbar' });
    this.button(toolbar, 'Flip card', () => {
      this.back = !this.back;
      this.render();
    });
    try {
      const fields = writingPracticeFields(f);
      const front = `<div class="cc-eyebrow">${f.card.kind === 'gap' ? 'Complete the sentence' : 'Correct the highlighted part'}</div><div class="cc-context">${fields.Question}</div>`;
      const answer = `<hr id="answer"><div class="cc-meaning">${fields.Answer}</div><div class="cc-context">${fields.Corrected}</div><div class="cc-label">Why</div><div>${fields.Explanation}</div>${fields.Tip ? `<div class="cc-label">Remember</div><div>${fields.Tip}</div>` : ''}`;
      const typed =
        !this.back && f.card.kind === 'gap'
          ? '<label>Your answer<input aria-label="Your answer" autocomplete="off"></label>'
          : '';
      const frame = body.createEl('iframe', {
        cls: 'cc-preview-frame',
        attr: {
          title: 'Writing practice preview. Typed answers are compared in Anki.',
          sandbox: 'allow-same-origin',
        },
      });
      const dark = body.ownerDocument.body.classList.contains('theme-dark');
      frame.srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>${CARD_CSS}body{margin:0;padding:20px}input{box-sizing:border-box;display:block;width:100%;padding:10px;font:inherit}</style></head><body class="card ${dark ? 'nightMode' : ''}"><div class="cc-card">${front}${this.back ? answer : typed}</div></body></html>`;
    } catch (error) {
      body.createDiv({
        cls: 'cc-writing-error',
        text: error instanceof Error ? error.message : String(error),
      });
    }
  }
  private updateLive(s: WritingSession, f?: WritingFinding) {
    if (f && this.quote) {
      const index = f.original.indexOf(f.before);
      this.quote.innerHTML =
        index < 0 || !f.before
          ? htmlText(f.original)
          : `${htmlText(f.original.slice(0, index))}<mark>${htmlText(f.before)}</mark>${htmlText(f.original.slice(index + f.before.length))}`;
    }
    if (f && this.corrected) {
      try {
        this.corrected.textContent =
          f.kind === 'unclear' ? 'Clarification needed' : correctedSentence(f);
      } catch {
        this.corrected.textContent = 'Check the highlighted text and correction.';
      }
    }
    if (f && this.formatPicker) {
      this.formatPicker.options[1]!.disabled = !f.after.trim();
      if (!f.after.trim() && f.format === 'gap') {
        f.format = 'correction';
        this.host.writing.editFinding(f);
        this.formatPicker.value = f.format;
        this.host.persist();
      }
    }
    if (f && !f.card && this.cardEditor) {
      this.cardEditor.remove();
      this.cardEditor = undefined;
    }
    if (this.issuePicker)
      for (const option of Array.from(this.issuePicker.options)) {
        const finding = s.findings.find((f) => f.id === option.value);
        if (finding)
          option.textContent = `${finding.noteId ? 'Added · ' : finding.selected ? '✓ ' : ''}${finding.title} · ${finding.kind}`;
      }
    if (this.warning) {
      this.warning.textContent = s.error;
      this.warning.toggleClass('is-visible', !!s.error);
    }
    if (!this.actions) return;
    this.actions.empty();
    const selected = this.selected(s),
      busy = s.phase !== 'idle';
    if (!s.analysed) {
      this.button(
        this.actions,
        'Check writing',
        () => void this.host.writing.analyse(s),
        'mod-cta',
      ).disabled = busy;
      return;
    }
    const prepare = this.button(
      this.actions,
      `Prepare ${selected.length || ''} ${selected.length === 1 ? 'card' : 'cards'}`.replace(
        '  ',
        ' ',
      ),
      () => void this.host.writing.generate(s),
    );
    prepare.disabled = busy || !selected.length;
    let valid = !!selected.length;
    for (const finding of selected)
      try {
        writingPracticeFields(finding);
      } catch {
        valid = false;
      }
    const add = this.button(
      this.actions,
      selected.length > 1 ? `Add ${selected.length} cards to Anki` : 'Add to Anki',
      () => void this.host.writing.export(s),
      'mod-cta',
    );
    add.disabled = busy || !valid;
    add.title = 'Save the writing review and add the selected, prepared cards.';
    if (f && !f.noteId) {
      const discard = this.button(
        this.actions,
        '',
        () => {
          f.dismissed = true;
          f.selected = false;
          this.host.writing.editFinding(f);
          this.host.persist();
          this.render();
        },
        'cc-discard clickable-icon',
      );
      discard.disabled = busy;
      discard.setAttribute('aria-label', 'Dismiss suggestion');
      setIcon(discard, 'trash-2');
    }
  }
}
