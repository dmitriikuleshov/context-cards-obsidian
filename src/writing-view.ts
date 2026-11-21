import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type ContextCardsPlugin from './main';
import { htmlText } from './text';
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
    this.render();
  }
  private button(root: HTMLElement, text: string, callback: () => void, primary = false) {
    const b = root.createEl('button', { text, cls: primary ? 'mod-cta' : '' });
    b.type = 'button';
    b.addEventListener('click', callback);
    return b;
  }
  private field(
    root: HTMLElement,
    label: string,
    value: string,
    key: string,
    change: (v: string) => void,
    multiline = true,
  ) {
    const wrap = root.createDiv({ cls: 'cc-field' });
    const id = `writing-${crypto.randomUUID()}`;
    wrap.createEl('label', { text: label, attr: { for: id } });
    const input = multiline
      ? wrap.createEl('textarea', { attr: { rows: '2' } })
      : wrap.createEl('input', { type: 'text' });
    input.id = id;
    input.value = value;
    input.dataset.writingField = key;
    input.addEventListener('input', () => {
      change(input.value);
      this.host.persist();
      this.render();
    });
    return input;
  }
  render() {
    const root = this.contentEl;
    const focused = root.ownerDocument.activeElement as HTMLInputElement | HTMLTextAreaElement;
    const key = focused?.dataset?.writingField;
    const cursor = key ? [focused.selectionStart, focused.selectionEnd] : undefined;
    const scroll = root.scrollTop;
    root.empty();
    root.addClass('cc-panel');
    root.addClass('cc-writing-panel');
    root.lang = 'en';
    const header = root.createDiv({ cls: 'cc-panel-header' });
    header.createEl('strong', { text: 'Check writing' });
    this.button(header, 'Vocabulary', () => void this.host.openPanel());
    const sessions = this.host.writing.sessions;
    const s = sessions.find((v) => v.id === this.current) ?? sessions.at(-1);
    if (!s) {
      root.createEl('p', {
        text: 'Select your own text in a Markdown note, then choose Check writing. Your original text will stay intact.',
      });
      return;
    }
    const busy = s.phase !== 'idle';
    const picker = root.createEl('select', { attr: { 'aria-label': 'Writing review' } });
    for (const session of sessions)
      picker.createEl('option', {
        text: `${session.capture.book} · ${session.created.slice(0, 16).replace('T', ' ')}`,
        attr: { value: session.id },
      });
    picker.value = s.id;
    picker.addEventListener('change', () => {
      this.current = picker.value;
      this.render();
    });
    const body = root.createDiv({ cls: 'cc-panel-body' });
    body.createDiv({
      cls: 'cc-muted',
      text: 'Review suggestions before accepting them. Optional style and unclear meaning are not treated as errors.',
    });
    const source = body.createEl('details');
    source.createEl('summary', { text: 'Your selected text' });
    source.createEl('pre', { text: s.capture.selected, cls: 'cc-writing-source' });
    if (s.summary) body.createEl('p', { text: s.summary });
    if (s.analysed && !s.findings.length)
      body.createEl('p', {
        text: 'No issues were flagged. This is model feedback, not a guarantee that the text is error-free.',
      });
    if (busy) {
      body.createEl('p', {
        text:
          s.phase === 'analysing'
            ? 'Checking your writing…'
            : s.phase === 'generating'
              ? 'Preparing practice cards…'
              : 'Saving your review…',
      });
      if (s.phase === 'analysing' || s.phase === 'generating')
        this.button(body, 'Cancel', () => this.host.writing.cancel(s));
    }
    for (const f of s.findings.filter((f) => !f.dismissed)) this.finding(body, s, f, busy);
    const dismissed = s.findings.filter((f) => f.dismissed);
    if (dismissed.length) {
      const hidden = body.createEl('details');
      hidden.createEl('summary', { text: `Dismissed suggestions · ${dismissed.length}` });
      for (const f of dismissed) {
        this.button(hidden, `Restore: ${f.title}`, () => {
          f.dismissed = false;
          this.host.persist();
          this.render();
        }).disabled = busy;
      }
    }

    if (s.error)
      body.createDiv({ cls: 'cc-writing-error', text: s.error, attr: { role: 'alert' } });
    const footer = root.createDiv({ cls: 'cc-footer' });
    this.field(
      footer,
      'Writing deck',
      s.deck,
      'writing-deck',
      (v) => {
        s.deck = v;
      },
      false,
    );
    const selected = s.findings.filter((f) => f.selected && canPractise(f) && !f.noteId);
    const actions = footer.createDiv({ cls: 'cc-writing-actions' });
    const check = this.button(
      actions,
      s.analysed ? 'Recheck selection' : 'Check writing',
      () => void this.host.writing.analyse(s),
    );
    check.disabled = busy || s.findings.some((f) => !!f.noteId);
    check.title = 'Rechecking replaces current suggestions and unexported card drafts.';
    const generate = this.button(
      actions,
      `Prepare ${selected.length || ''} ${selected.length === 1 ? 'card' : 'cards'}`.replace(
        '  ',
        ' ',
      ),
      () => void this.host.writing.generate(s),
    );
    generate.disabled = busy || !selected.length;
    const save = this.button(actions, 'Save review', () => void this.host.writing.save(s));
    save.disabled = busy || !s.analysed;
    let valid = selected.length > 0 && selected.every((f) => !!f.card);
    if (valid)
      try {
        for (const f of selected) writingPracticeFields(f);
      } catch {
        valid = false;
      }
    const add = this.button(
      actions,
      `Save review & add ${selected.length || ''} ${selected.length === 1 ? 'card' : 'cards'}`.replace(
        '  ',
        ' ',
      ),
      () => void this.host.writing.export(s),
      true,
    );
    add.disabled = busy || !valid;
    if (s.reviewPath)
      this.button(
        footer,
        'Open saved review',
        () => void this.host.app.workspace.openLinkText(s.reviewPath!, '', true),
      );
    // Cancel stays available while other editing controls are locked.
    if (busy)
      for (const e of Array.from(
        root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
          'input,textarea,select',
        ),
      ))
        e.disabled = true;
    root.scrollTop = scroll;
    if (key) {
      const replacement = Array.from(
        root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-writing-field]'),
      ).find((e) => e.dataset.writingField === key);
      if (replacement && !replacement.disabled) {
        replacement.focus({ preventScroll: true });
        if (cursor && cursor[0] !== null) replacement.setSelectionRange(cursor[0]!, cursor[1]!);
      }
    }
  }
  private finding(root: HTMLElement, s: WritingSession, f: WritingFinding, busy: boolean) {
    const block = root.createDiv({ cls: 'cc-writing-finding' });
    block.createEl('h3', { text: `${f.kind[0]!.toUpperCase() + f.kind.slice(1)} · ${f.title}` });
    const original = block.createDiv({ cls: 'cc-context' });
    const start = f.original.indexOf(f.before);
    original.innerHTML = `${htmlText(f.original.slice(0, start))}<mark>${htmlText(f.before)}</mark>${htmlText(f.original.slice(start + f.before.length))}`;
    if (f.noteId) {
      block.createDiv({
        cls: 'cc-muted',
        text: f.reused ? 'Existing Anki practice reused.' : 'Added to Anki.',
      });
      this.button(block, 'Open in Anki', () => void this.host.openAnki([f.noteId!]));
    }
    const editable = block.createDiv();
    const invalidate = () => this.host.writing.editFinding(f);
    const metadata = editable.createEl('details');
    metadata.createEl('summary', { text: 'Edit issue details' });
    this.field(
      metadata,
      'Issue title',
      f.title,
      `${f.id}-title`,
      (v) => {
        f.title = v;
        invalidate();
      },
      false,
    );
    this.field(
      metadata,
      'Highlighted text',
      f.before,
      `${f.id}-before`,
      (v) => {
        f.before = v;
        invalidate();
      },
      false,
    );
    const category = metadata.createEl('select', {
      attr: { 'aria-label': `Finding category: ${f.title}` },
    });
    for (const kind of ['grammar', 'vocabulary', 'style', 'unclear', 'typo'])
      category.createEl('option', { text: kind, attr: { value: kind } });
    category.value = f.kind;
    category.addEventListener('change', () => {
      f.kind = category.value as typeof f.kind;
      if (!canPractise(f)) f.selected = false;
      invalidate();
      this.render();
    });
    if (!f.noteId)
      this.button(metadata, 'Dismiss suggestion', () => {
        f.dismissed = true;
        f.selected = false;
        invalidate();
        this.render();
      }).disabled = busy;
    this.field(
      editable,
      'Replace with',
      f.after,
      `${f.id}-after`,
      (v) => {
        f.after = v;
        invalidate();
      },
      false,
    );
    if (f.kind !== 'unclear')
      try {
        block.createDiv({ cls: 'cc-writing-correction', text: correctedSentence(f) });
      } catch (error) {
        block.createDiv({ text: String(error) });
      }
    this.field(editable, 'Why', f.explanation, `${f.id}-why`, (v) => {
      f.explanation = v;
      invalidate();
    });
    this.field(
      editable,
      'Tip',
      f.tip,
      `${f.id}-tip`,
      (v) => {
        f.tip = v;
        invalidate();
      },
      false,
    );
    if (canPractise(f)) {
      const label = editable.createEl('label', { cls: 'cc-writing-select' });
      const check = label.createEl('input', { type: 'checkbox' });
      check.checked = f.selected;
      label.appendText(' Create a practice card');
      check.addEventListener('change', () => {
        f.selected = check.checked;
        this.host.persist();
        this.render();
      });
      const format = editable.createEl('select', {
        attr: { 'aria-label': `Card format: ${f.title}` },
      });
      format.createEl('option', { text: 'Correct the mistake', attr: { value: 'correction' } });
      format.createEl('option', { text: 'Complete the sentence', attr: { value: 'gap' } });
      format.value = f.format;
      format.addEventListener('change', () => {
        f.format = format.value === 'gap' ? 'gap' : 'correction';
        invalidate();
        this.render();
      });
    } else
      block.createDiv({
        cls: 'cc-muted',
        text:
          f.kind === 'unclear'
            ? 'Clarification is needed before this can become a definite correction.'
            : f.kind === 'style'
              ? 'Optional wording suggestion. Not selected for practice.'
              : 'Typing slip. Not selected for practice.',
      });
    if (f.card) {
      const details = block.createEl('details');
      details.open = true;
      details.createEl('summary', { text: 'Practice card · review before adding' });
      const c = f.card;
      for (const [label, key] of [
        ['Question', 'question'],
        ['Answer', 'answer'],
        ['Corrected sentence', 'corrected'],
        ['Hint', 'hint'],
        ['Card explanation', 'explanation'],
        ['Card tip', 'tip'],
      ] as const)
        this.field(details, label, c[key], `${f.id}-card-${key}`, (v) => {
          c[key] = v;
        });
      try {
        const fields = writingPracticeFields(f);
        const preview = details.createDiv({ cls: 'cc-writing-card-preview' });
        preview.innerHTML = `<div class="cc-label">Front</div>${fields.Question}<hr><div class="cc-label">Back</div><div>${fields.Corrected}</div><div>${fields.Explanation}</div>`;
      } catch (error) {
        details.createDiv({
          cls: 'cc-writing-error',
          text: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (busy || f.noteId)
      for (const input of Array.from(
        block.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
          'input,textarea,select',
        ),
      ))
        input.disabled = true;
  }
}
