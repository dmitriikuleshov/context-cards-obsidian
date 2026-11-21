import { ItemView, setIcon, type WorkspaceLeaf } from 'obsidian';
import type ContextCardsPlugin from './main';
import {
  canPractise,
  correctedSentence,
  parseWritingAnalysis,
  writingPracticeFields,
  type WritingFinding,
  type WritingSession,
} from './writing';
import { writingHighlights } from './writing-workflow';

export const WRITING_VIEW = 'context-cards-writing';
type Screen = 'review' | 'preview' | 'done';
export class WritingView extends ItemView {
  private current = '';
  private screen: Screen = 'review';
  private findingIds = new Map<string, string>();
  private editing?: string;
  private undo?: { session: string; id: string; selected: boolean; dismissed: boolean };
  private sections = new Map<string, boolean>();
  private attempt = 0;
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
    return 'Writing practice';
  }
  getIcon() {
    return 'spell-check';
  }
  async onOpen() {
    this.render();
  }
  show(s: WritingSession) {
    this.current = s.id;
    this.screen = 'review';
    this.editing = undefined;
    this.undo = undefined;
    this.attempt++;
    this.render();
  }
  private button(root: HTMLElement, text: string, action: () => void, primary = false) {
    const b = root.createEl('button', {
      text,
      cls: primary ? 'cc-writing-button mod-cta' : 'cc-writing-button',
    });
    b.type = 'button';
    b.addEventListener('click', action);
    return b;
  }
  private section(root: HTMLElement, key: string, title: string) {
    const el = root.createEl('details', { cls: 'cc-section' });
    el.dataset.writingSection = key;
    el.open = this.sections.get(key) ?? false;
    el.createEl('summary', { text: title });
    return el;
  }
  private active(s: WritingSession) {
    return s.findings.find((f) => f.id === this.findingIds.get(s.id)) ?? s.findings[0];
  }
  private selected(s: WritingSession) {
    return s.findings.filter((f) => f.selected && canPractise(f));
  }
  private pending(s: WritingSession) {
    return this.selected(s).filter((f) => !f.noteId);
  }
  private valid(f: WritingFinding) {
    try {
      writingPracticeFields(f);
      return true;
    } catch {
      return false;
    }
  }
  private changed(s: WritingSession) {
    s.error = '';
    this.host.persist();
    this.render();
  }
  private next(s: WritingSession, f: WritingFinding) {
    const start = s.findings.indexOf(f);
    const ordered = [...s.findings.slice(start + 1), ...s.findings.slice(0, start)];
    const next =
      ordered.find((item) => !item.selected && !item.dismissed && !item.noteId) ?? ordered[0];
    if (next) this.findingIds.set(s.id, next.id);
  }
  private decide(s: WritingSession, f: WritingFinding, keep: boolean) {
    if (s.phase !== 'idle' || f.noteId) return;
    // Skipped suggestions remain inspectable in the original text and can be undone.
    if (keep && !(f.kind === 'grammar' || f.kind === 'vocabulary')) return;
    this.undo = { session: s.id, id: f.id, selected: f.selected, dismissed: !!f.dismissed };
    f.dismissed = !keep;
    f.selected = keep;
    this.next(s, f);
    this.changed(s);
  }
  private field(
    root: HTMLElement,
    label: string,
    value: string,
    key: string,
    s: WritingSession,
    change: (v: string) => void,
    multiline = false,
    locked = false,
  ) {
    const wrap = root.createDiv({ cls: 'cc-field' }),
      id = `writing-${crypto.randomUUID()}`;
    wrap.createEl('label', { text: label, attr: { for: id } });
    const input = multiline
      ? wrap.createEl('textarea', { attr: { rows: '3' } })
      : wrap.createEl('input', { type: 'text' });
    input.id = id;
    input.value = value;
    input.dataset.writingField = key;
    input.disabled = s.phase !== 'idle' || locked;
    input.addEventListener('input', () => {
      change(input.value);
      s.error = '';
      this.host.persist();
    });
    return input;
  }
  private async prepare(s: WritingSession) {
    if (s.phase !== 'idle') return;
    const ticket = ++this.attempt;
    if (this.pending(s).some((f) => !this.valid(f))) await this.host.writing.generate(s);
    if (ticket !== this.attempt || this.current !== s.id) return;
    // A cancelled or unsuccessful attempt never silently advances the workflow.
    if (this.pending(s).every((f) => this.valid(f)) && !s.error) this.screen = 'preview';
    this.render();
  }
  private async export(s: WritingSession) {
    if (s.phase !== 'idle') return;
    const ticket = ++this.attempt;
    await this.host.writing.export(s);
    if (ticket !== this.attempt || this.current !== s.id) return;
    if (!s.error && !this.pending(s).length) this.screen = 'done';
    this.render();
  }
  render() {
    const root = this.contentEl,
      scroll = root.scrollTop;
    for (const d of Array.from(root.querySelectorAll<HTMLDetailsElement>('[data-writing-section]')))
      this.sections.set(d.dataset.writingSection!, d.open);
    root.empty();
    root.addClass('cc-panel', 'cc-writing-panel', 'cc-writing-workflow');
    root.lang = 'en';
    const header = root.createDiv({ cls: 'cc-panel-header' });
    header.createEl('strong', { text: 'Writing practice' });
    const nav = header.createDiv({ cls: 'cc-writing-navigation' });
    this.button(nav, 'Vocabulary', () => void this.host.openPanel());
    const settings = this.button(nav, '', () => this.host.openSettings());
    settings.setAttribute('aria-label', 'Context Cards settings');
    setIcon(settings, 'sliders-horizontal');
    const sessions = this.host.writing.sessions,
      s = sessions.find((s) => s.id === this.current) ?? sessions.at(-1);
    if (!s) {
      root.createDiv({
        cls: 'cc-empty',
        text: 'Select your English writing and choose Check writing.',
      });
      return;
    }
    this.current = s.id;
    if (sessions.length > 1) {
      const row = root.createDiv({ cls: 'cc-draft-switcher' }),
        picker = row.createEl('select', { attr: { 'aria-label': 'Writing review' } });
      for (const item of sessions)
        picker.createEl('option', {
          text: `${item.capture.book} · ${item.created.slice(0, 16).replace('T', ' ')}`,
          attr: { value: item.id },
        });
      picker.value = s.id;
      picker.addEventListener('change', () =>
        this.show(sessions.find((s) => s.id === picker.value)!),
      );
    }
    const body = root.createDiv({ cls: 'cc-panel-body' }),
      busy = s.phase !== 'idle';
    if (busy) {
      const status = body.createDiv({ cls: 'cc-busy', attr: { role: 'status' } });
      status.createSpan({ cls: 'cc-spinner' });
      status.createSpan({
        text:
          s.phase === 'analysing'
            ? 'Checking your writing…'
            : s.phase === 'generating'
              ? 'Preparing selected cards…'
              : s.phase === 'exporting'
                ? 'Adding cards to Anki…'
                : 'Saving review…',
      });
      if (s.phase === 'analysing' || s.phase === 'generating')
        this.button(status, 'Cancel', () => {
          this.attempt++;
          this.host.writing.cancel(s);
        });
    }
    if (s.error) {
      const error = body.createDiv({ cls: 'cc-writing-error', attr: { role: 'alert' } });
      error.createEl('p', { text: s.error });
      if (!busy) {
        if (!s.analysed)
          this.button(error, 'Try analysis again', () => void this.host.writing.analyse(s), true);
        else if (this.screen === 'preview' && this.pending(s).every((f) => this.valid(f)))
          this.button(error, 'Retry remaining cards', () => void this.export(s), true);
        else if (this.pending(s).length)
          this.button(error, 'Retry preparing cards', () => void this.prepare(s), true);
      }
    }
    if (this.editing) {
      const f = s.findings.find((f) => f.id === this.editing);
      if (f) this.renderEditor(body, s, f);
      else this.editing = undefined;
    }
    if (!this.editing) {
      if (this.screen === 'done') {
        body.createEl('h2', {
          text: s.findings.some((f) => f.noteId) ? 'Added to Anki' : 'Review finished',
        });
        body.createEl('p', {
          cls: 'cc-writing-success',
          text: `${s.findings.filter((f) => f.noteId).length} cards added. Your original text is unchanged.`,
        });
        this.button(body, 'Back to corrections', () => {
          this.screen = 'review';
          this.render();
        });
      } else if (this.screen === 'preview') this.renderPreviews(body, s);
      else this.renderReview(body, s);
      this.renderFooter(root, s);
    }
    root.scrollTop = scroll;
  }
  private renderReview(body: HTMLElement, s: WritingSession) {
    const busy = s.phase !== 'idle',
      f = this.active(s),
      reviewed = s.findings.filter((f) => f.selected || f.dismissed || f.noteId).length;
    const heading = body.createDiv({ cls: 'cc-writing-row' });
    heading.createEl('h2', { text: 'Review your writing' });
    if (s.analysed)
      heading.createSpan({ cls: 'cc-muted', text: `${reviewed} of ${s.findings.length} reviewed` });
    const source = body.createDiv({ cls: 'cc-writing-row cc-writing-source-heading' });
    source.createSpan({ text: `${s.capture.book} · Original text` });
    this.button(
      source,
      'Open source',
      () => void this.host.app.workspace.openLinkText(s.capture.file, '', true),
    );
    if (s.findings.length)
      body.createEl('p', {
        cls: 'cc-writing-instruction',
        text: 'Click a highlighted word to review its correction.',
      });
    const text = body.createDiv({
      cls: 'cc-writing-text',
      attr: { 'aria-label': 'Original selected text' },
    });
    let end = 0;
    for (const range of writingHighlights(s.capture.selected, s.findings)) {
      text.appendText(s.capture.selected.slice(end, range.start));
      const finding = s.findings.find((f) => f.id === range.id)!;
      const mark = this.button(text, s.capture.selected.slice(range.start, range.end), () => {
        this.findingIds.set(s.id, range.id);
        this.undo = undefined;
        this.render();
        this.contentEl.querySelector('.cc-writing-change')?.scrollIntoView({ block: 'nearest' });
      });
      mark.className = 'cc-writing-word';
      mark.dataset.findingId = finding.id;
      mark.classList.toggle('is-kept', finding.selected || !!finding.noteId);
      mark.classList.toggle('is-skipped', !!finding.dismissed);
      mark.setAttribute('aria-pressed', String(f?.id === finding.id));
      mark.setAttribute(
        'aria-label',
        `${finding.title}${finding.noteId ? ', added' : finding.dismissed ? ', skipped' : finding.selected ? ', kept' : ''}`,
      );
      mark.createEl('sup', {
        text:
          finding.noteId || finding.selected
            ? '✓'
            : finding.dismissed
              ? '–'
              : String(s.findings.indexOf(finding) + 1),
      });
      end = range.end;
    }
    text.appendText(s.capture.selected.slice(end));
    if (!s.analysed) return;
    if (!f) {
      body.createEl('p', {
        text: 'No issues were flagged. You can save this review or select another passage.',
      });
      return;
    }
    body.createDiv({ cls: 'cc-writing-legend', text: '✓ Kept for a card     – Skipped' });
    body.createEl('hr');
    const row = body.createDiv({ cls: 'cc-writing-row' });
    // A picker also makes overlapping or unmappable suggestions reachable without inventing source anchors.
    const picker = row.createEl('select', {
      cls: 'cc-writing-issue-nav',
      attr: { 'aria-label': 'Choose a correction' },
    });
    for (const [i, item] of s.findings.entries())
      picker.createEl('option', {
        text: `Correction ${i + 1} of ${s.findings.length} · ${item.title}`,
        attr: { value: item.id },
      });
    picker.value = f.id;
    picker.addEventListener('change', () => {
      this.findingIds.set(s.id, picker.value);
      this.undo = undefined;
      this.render();
    });
    this.button(row, 'Edit', () => {
      this.editing = f.id;
      this.render();
    }).disabled = busy || !!f.noteId;
    const change = body.createDiv({ cls: 'cc-writing-change' });
    change.createEl('del', { text: f.before });
    change.createSpan({ text: '→', attr: { 'aria-hidden': 'true' } });
    change.createEl('ins', { text: f.after || '(remove)' });
    body.createEl('p', { cls: 'cc-writing-why', text: f.explanation });
    if (f.noteId) {
      body.createEl('p', { cls: 'cc-writing-success', text: 'Already added to Anki.' });
      this.button(body, 'Open in Anki', () => void this.host.openAnki([f.noteId!]));
    } else if (f.kind === 'style' || f.kind === 'typo' || f.kind === 'unclear')
      body.createEl('p', {
        cls: 'cc-muted',
        text:
          f.kind === 'style'
            ? 'Optional style suggestion. No practice card is needed.'
            : f.kind === 'typo'
              ? 'Typing slip. No practice card is needed.'
              : 'Clarify your intended meaning before treating this as an error.',
      });
    const decisions = body.createDiv({ cls: 'cc-writing-decisions' });
    if (!f.noteId)
      this.button(decisions, f.selected ? 'Remove from cards' : 'Skip', () =>
        this.decide(s, f, false),
      ).disabled = busy;
    if (!f.noteId && !f.selected && (f.kind === 'grammar' || f.kind === 'vocabulary')) {
      let valid = true;
      try {
        correctedSentence(f);
        if (!f.explanation.trim()) valid = false;
      } catch {
        valid = false;
      }
      this.button(decisions, 'Keep & next', () => this.decide(s, f, true), true).disabled =
        busy || !valid;
    } else
      this.button(
        decisions,
        'Next correction',
        () => {
          this.next(s, f);
          this.render();
        },
        true,
      ).disabled = busy || s.findings.length < 2;
    if (this.undo?.session === s.id) {
      const u = this.undo,
        item = s.findings.find((f) => f.id === u.id);
      if (item && !item.noteId) {
        const row = body.createDiv({ cls: 'cc-writing-undo' });
        row.createSpan({
          text: `“${item.before}” ${item.selected ? 'kept for practice' : 'skipped'}.`,
        });
        this.button(row, 'Undo', () => {
          item.selected = u.selected;
          item.dismissed = u.dismissed;
          this.findingIds.set(s.id, item.id);
          this.undo = undefined;
          this.changed(s);
        }).disabled = busy;
      }
    }
    body.createEl('p', {
      cls: 'cc-muted',
      text:
        reviewed === s.findings.length
          ? 'All corrections reviewed. Click a highlight to revisit it.'
          : 'Keep useful mistakes as practice cards. Your text stays unchanged.',
    });
  }
  private renderEditor(body: HTMLElement, s: WritingSession, f: WritingFinding) {
    body.createEl('h2', { text: 'Edit correction' });
    body.createEl('p', { text: f.original });
    const after = this.field(
      body,
      'Correction',
      f.after,
      `${f.id}-after`,
      s,
      () => {},
      false,
      !!f.noteId,
    );
    const why = this.field(
      body,
      'Explanation',
      f.explanation,
      `${f.id}-why`,
      s,
      () => {},
      true,
      !!f.noteId,
    );
    const more = this.section(body, 'edit-details', 'More details');
    const title = this.field(
      more,
      'Issue title',
      f.title,
      `${f.id}-title`,
      s,
      () => {},
      false,
      !!f.noteId,
    );
    const category = more.createEl('select', { attr: { 'aria-label': 'Finding category' } });
    for (const kind of ['grammar', 'vocabulary', 'style', 'unclear', 'typo'])
      category.createEl('option', { text: kind, attr: { value: kind } });
    category.value = f.kind;
    category.disabled = s.phase !== 'idle' || !!f.noteId;
    const tip = this.field(more, 'Tip', f.tip, `${f.id}-tip`, s, () => {}, true, !!f.noteId);
    const before = this.field(
      more,
      'Highlighted text',
      f.before,
      `${f.id}-before`,
      s,
      () => {},
      false,
      !!f.noteId,
    );
    const format = more.createEl('select', { attr: { 'aria-label': 'Exercise type' } });
    format.createEl('option', { text: 'Correct the mistake', attr: { value: 'correction' } });
    format.createEl('option', { text: 'Fill in the missing word', attr: { value: 'gap' } });
    format.value = f.format;
    format.disabled = s.phase !== 'idle' || !!f.noteId;
    const cardInputs: Partial<
      Record<keyof NonNullable<WritingFinding['card']>, HTMLInputElement | HTMLTextAreaElement>
    > = {};
    if (f.card) {
      const details = this.section(more, 'card-fields', 'Edit card fields');
      for (const [label, key] of [
        ['Question', 'question'],
        ['Answer', 'answer'],
        ['Corrected sentence', 'corrected'],
        ['Hint', 'hint'],
        ['Card explanation', 'explanation'],
        ['Card tip', 'tip'],
      ] as const)
        cardInputs[key] = this.field(
          details,
          label,
          f.card[key],
          `${f.id}-card-${key}`,
          s,
          () => {},
          true,
          !!f.noteId,
        );
    }
    const error = body.createDiv({ cls: 'cc-writing-error', attr: { role: 'alert' } }),
      actions = body.createDiv({ cls: 'cc-writing-decisions' });
    this.button(actions, 'Cancel', () => {
      this.editing = undefined;
      this.render();
    }).disabled = s.phase !== 'idle';
    this.button(
      actions,
      'Save changes',
      () => {
        try {
          const draft = {
            ...f,
            title: title.value.trim(),
            kind: category.value as WritingFinding['kind'],
            before: before.value,
            after: after.value,
            explanation: why.value.trim(),
            tip: tip.value.trim(),
            format: format.value as WritingFinding['format'],
          };
          if (draft.kind !== 'unclear') correctedSentence(draft);
          if (!draft.explanation) throw new Error('Enter an explanation.');
          if (!draft.title) throw new Error('Enter an issue title.');
          if (draft.format === 'gap' && !draft.after.trim())
            throw new Error('Use Correct the mistake for a deletion.');
          parseWritingAnalysis(
            JSON.stringify({
              summary: '',
              findings: [
                {
                  kind: draft.kind,
                  title: draft.title,
                  original_sentence: draft.original,
                  target_before: draft.before,
                  target_after: draft.after,
                  explanation: draft.explanation,
                  tip: draft.tip,
                  pattern: draft.pattern,
                  recommended_format: draft.format,
                },
              ],
            }),
            s.capture.selected,
          );
          const underlyingChanged = (
            ['before', 'after', 'explanation', 'tip', 'kind', 'format'] as const
          ).some((key) => draft[key] !== f[key]);
          if (!underlyingChanged && f.card) {
            draft.card = { ...f.card };
            for (const [key, input] of Object.entries(cardInputs))
              (draft.card as unknown as Record<string, string>)[key] = input!.value;
            writingPracticeFields(draft);
          }
          Object.assign(f, draft);
          if (!canPractise(f)) f.selected = false;
          if (underlyingChanged) this.host.writing.editFinding(f);
          this.editing = undefined;
          if (this.screen === 'preview') this.screen = 'review';
          this.changed(s);
        } catch (e) {
          error.textContent = e instanceof Error ? e.message : String(e);
        }
      },
      true,
    ).disabled = s.phase !== 'idle' || !!f.noteId;
  }
  private renderPreviews(body: HTMLElement, s: WritingSession) {
    this.button(body, '← Corrections', () => {
      this.screen = 'review';
      this.render();
    });
    body.createEl('h2', { text: 'Review your cards' });
    body.createEl('p', { cls: 'cc-muted', text: 'Check the question and answer before adding.' });
    for (const [i, f] of this.selected(s).entries()) {
      const card = body.createDiv({ cls: 'cc-writing-preview' }),
        row = card.createDiv({ cls: 'cc-writing-row' });
      row.createEl('h3', { text: `Card ${i + 1} · ${f.title}` });
      const actions = row.createDiv({ cls: 'cc-writing-row' });
      this.button(actions, 'Edit', () => {
        this.editing = f.id;
        this.render();
      }).disabled = s.phase !== 'idle' || !!f.noteId;
      this.button(actions, 'Remove', () => {
        f.selected = false;
        this.changed(s);
      }).disabled = s.phase !== 'idle' || !!f.noteId;
      if (f.noteId)
        card.createEl('p', {
          cls: 'cc-writing-success',
          text: f.reused ? '✓ Existing Anki practice reused' : '✓ Already added',
        });
      try {
        const fields = writingPracticeFields(f);
        card.createEl('p', {
          cls: 'cc-muted',
          text:
            f.card!.kind === 'gap' ? 'Fill in the missing word' : 'Correct the highlighted part',
        });
        // These fields come from the escaping/validation shared with the real Anki note.
        card.createDiv({ cls: 'cc-writing-question' }).innerHTML = fields.Question!;
        card.createEl('hr');
        card.createEl('p', { cls: 'cc-muted', text: 'Answer' });
        card.createDiv({ cls: 'cc-writing-answer' }).innerHTML = fields.Corrected!;
        card.createEl('p', { text: f.card!.explanation });
        if (f.card!.tip) card.createEl('p', { cls: 'cc-muted', text: f.card!.tip });
      } catch (e) {
        card.createEl('p', {
          cls: 'cc-writing-error',
          text: e instanceof Error ? e.message : String(e),
        });
      }
    }
    if (!this.selected(s).length)
      body.createEl('p', { text: 'No cards selected. Return to corrections to keep one.' });
  }
  private renderFooter(root: HTMLElement, s: WritingSession) {
    const footer = root.createDiv({ cls: 'cc-footer' }),
      busy = s.phase !== 'idle';
    const options = this.section(footer, 'options', 'Options');
    this.field(options, 'Writing deck', s.deck, 'deck', s, (v) => {
      s.deck = v;
    });
    this.button(options, 'Save review', () => void this.host.writing.save(s)).disabled =
      busy || !s.analysed;
    this.button(options, 'Recheck selection', () => {
      this.undo = undefined;
      void this.host.writing.analyse(s);
    }).disabled = busy || s.findings.some((f) => !!f.noteId);
    if (s.reviewPath)
      this.button(
        options,
        'Open saved review',
        () => void this.host.app.workspace.openLinkText(s.reviewPath!, '', true),
      );
    const actions = footer.createDiv({ cls: 'cc-writing-footer-actions' }),
      pending = this.pending(s);
    if (this.screen === 'done') return;
    if (!s.analysed) {
      this.button(
        actions,
        'Check writing',
        () => void this.host.writing.analyse(s),
        true,
      ).disabled = busy;
      return;
    }
    if (this.screen === 'preview') {
      actions.createSpan({ cls: 'cc-muted', text: s.deck });
      const valid = pending.length > 0 && pending.every((f) => this.valid(f));
      this.button(
        actions,
        `Add ${pending.length} ${pending.length === 1 ? 'card' : 'cards'} to Anki`,
        () => void this.export(s),
        true,
      ).disabled = busy || !valid;
      if (!valid && pending.length)
        this.button(actions, 'Prepare missing cards', () => void this.prepare(s)).disabled = busy;
    } else {
      const count = this.selected(s).length;
      actions.createSpan({ text: `${count} ${count === 1 ? 'card' : 'cards'} selected` });
      if (!count && s.findings.every((f) => f.dismissed || f.noteId))
        this.button(
          actions,
          'Finish review',
          () => {
            this.screen = 'done';
            this.render();
          },
          true,
        ).disabled = busy;
      else
        this.button(
          actions,
          `Review${count ? ' ' + count : ''} ${count === 1 ? 'card' : 'cards'}`,
          () => void this.prepare(s),
          true,
        ).disabled = busy || !count;
    }
  }
}
