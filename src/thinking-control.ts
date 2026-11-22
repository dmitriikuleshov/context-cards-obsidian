import { enhanceSelects } from './select-menu';
import {
  thinkingChoices,
  thinkingValue,
  usesThinking,
  type ThinkingSupport,
} from './thinking-options';
import type { Settings } from './types';

/** Rebuild only this setting, preserving focus and edits elsewhere in the settings tab. */
export class ThinkingControl {
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private cleanup?: () => void;
  private epoch = 0;
  private disposed = false;
  constructor(
    private root: HTMLElement,
    private settings: Settings,
    private persist: () => void,
    private describe: (text: string) => void,
    private readSupport: (
      settings: Pick<Settings, 'ollamaUrl' | 'model'>,
      signal: AbortSignal,
      force: boolean,
    ) => Promise<ThinkingSupport>,
    private modeChanged?: (active: boolean) => void,
  ) {}
  schedule() {
    this.epoch++;
    this.controller?.abort();
    clearTimeout(this.timer);
    this.loading();
    this.timer = setTimeout(() => void this.load(), 350);
  }
  private loading() {
    this.cleanup?.();
    this.root.replaceChildren();
    const button = this.root.ownerDocument.createElement('button');
    button.type = 'button';
    button.textContent = 'Checking…';
    button.setAttribute('aria-label', 'Checking Thinking support');
    button.disabled = true;
    this.root.append(button);
    this.describe('Checking the selected model’s supported thinking options.');
  }
  async load(force = false) {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.controller?.abort();
    const controller = new AbortController(),
      epoch = ++this.epoch;
    this.controller = controller;
    const snapshot = { ollamaUrl: this.settings.ollamaUrl, model: this.settings.model };
    this.loading();
    try {
      const support = await this.readSupport(snapshot, controller.signal, force);
      if (this.disposed || epoch !== this.epoch || controller.signal.aborted) return;
      this.render(support);
    } catch (error) {
      if (this.disposed || epoch !== this.epoch || controller.signal.aborted) return;
      this.render(
        { known: false, values: [] },
        `Could not check Thinking support: ${error instanceof Error ? error.message : String(error)} Use Check Ollama to retry.`,
      );
    }
  }
  private render(support: ThinkingSupport, error?: string) {
    this.cleanup?.();
    this.root.replaceChildren();
    const choices = error
        ? [{ value: this.settings.thinking, label: 'Unavailable' }]
        : thinkingChoices(support),
      select = this.root.ownerDocument.createElement('select');
    select.setAttribute('aria-label', 'Thinking');
    for (const choice of choices) {
      const option = this.root.ownerDocument.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      select.append(option);
    }
    // Do not replace a saved preference merely because the server is temporarily unreachable.
    const selected =
      choices.find((c) => c.value === this.settings.thinking)?.value ??
      (choices.some((c) => c.value === 'off') ? 'off' : 'default');
    select.value = selected;
    if (!error && selected !== this.settings.thinking) {
      this.settings.thinking = selected;
      this.persist();
    }
    select.disabled = !support.known || choices.length === 1;
    if (!error) this.modeChanged?.(usesThinking(thinkingValue(selected, support), support));
    select.addEventListener('change', () => {
      const choice = choices.find((c) => c.value === select.value);
      if (!choice || select.disabled) return;
      this.settings.thinking = choice.value;
      this.modeChanged?.(usesThinking(thinkingValue(choice.value, support), support));
      this.persist();
    });
    this.root.append(select);
    this.describe(
      error ??
        (!support.known
          ? 'Support unknown: Ollama did not report thinking controls. Model default is used; no on/off control is assumed.'
          : choices.length === 1
            ? 'This model does not support thinking.'
            : 'Extra reasoning before the answer, for both modes. Uses more memory and time; increase Request timeout if needed.' +
              (support.values.includes(false) ? '' : ' This model cannot turn thinking off.')),
    );
    this.cleanup = enhanceSelects(this.root);
  }
  destroy() {
    this.disposed = true;
    this.epoch++;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.cleanup?.();
  }
}
