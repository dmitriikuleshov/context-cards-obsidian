import { Modal, type App } from 'obsidian';
import type { Capture } from './types';
import { MAX_TARGET_LENGTH, narrowTarget } from './target';

/** No draft, model request or source edit exists until a target has been confirmed. */
export class TargetPicker extends Modal {
  private settled = false;
  constructor(
    app: App,
    private capture: Capture,
    private complete: (capture: Capture | null) => void,
  ) {
    super(app);
  }
  onOpen() {
    const root = this.contentEl;
    root.addClass('cc-target-picker');
    root.createEl('h2', { text: 'Choose what to learn' });
    root.createEl('p', {
      text: 'This looks like a passage. Highlight one word or expression below. Long idioms and grammar patterns can stay together.',
    });
    const text = root.createEl('textarea', {
      attr: {
        rows: '6',
        'aria-label': 'Choose a word or expression from this text',
        'aria-readonly': 'true',
      },
    });
    text.value = this.capture.selected;
    text.spellcheck = false;
    // Chromium disables caret navigation in native readonly textareas. Prevent
    // changes while retaining the normal keyboard selection controls instead.
    text.addEventListener('beforeinput', (event) => event.preventDefault());
    const feedback = root.createDiv({
      cls: 'cc-target-choice',
      attr: { role: 'status', 'aria-live': 'polite' },
    });
    const actions = root.createDiv({ cls: 'cc-target-actions' });
    const button = (label: string, action: () => void, primary = false) => {
      const el = actions.createEl('button', { text: label, cls: primary ? 'mod-cta' : '' });
      el.type = 'button';
      el.addEventListener('click', action);
      return el;
    };
    button('Cancel', () => this.close());
    if (this.capture.selected.length <= MAX_TARGET_LENGTH)
      button('Use whole phrase', () => this.finish(this.capture));
    let choice: Capture | null = null;
    const create = button(
      'Create cards',
      () => {
        if (choice) this.finish(choice);
      },
      true,
    );
    const update = () => {
      choice = narrowTarget(this.capture, text.selectionStart, text.selectionEnd);
      create.disabled = !choice;
      feedback.textContent = choice
        ? choice.selected
        : text.selectionEnd > text.selectionStart
          ? 'Choose a shorter expression (up to 240 characters).'
          : 'Highlight the word or expression you want on the card.';
    };
    for (const event of ['select', 'mouseup', 'keyup']) text.addEventListener(event, update);
    text.addEventListener('input', () => {
      text.value = this.capture.selected;
      update();
    });
    text.setSelectionRange(0, 0);
    update();
    text.focus();
  }
  private finish(capture: Capture) {
    if (this.settled) return;
    this.settled = true;
    this.complete(capture);
    this.close();
  }
  onClose() {
    if (!this.settled) {
      this.settled = true;
      this.complete(null);
    }
    this.contentEl.empty();
  }
}
