import { enhanceSelects } from './select-menu';
import type { Settings } from './types';

/** Installed-model picker. Discovery never changes the saved model automatically. */
export class ModelControl {
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private cleanup?: () => void;
  private epoch = 0;
  private disposed = false;
  private choice: HTMLElement;
  private refresh: HTMLButtonElement;
  constructor(
    private root: HTMLElement,
    private settings: Settings,
    private persist: () => void,
    private describe: (text: string) => void,
    private readModels: (
      settings: Pick<Settings, 'ollamaUrl' | 'model'>,
      signal: AbortSignal,
    ) => Promise<string[]>,
  ) {
    root.classList.add('cc-model-control');
    this.choice = root.ownerDocument.createElement('div');
    this.choice.className = 'cc-model-choice';
    this.refresh = root.ownerDocument.createElement('button');
    this.refresh.type = 'button';
    this.refresh.textContent = 'Refresh';
    this.refresh.setAttribute('aria-label', 'Refresh installed models');
    this.refresh.title = 'Reload models from Ollama';
    this.refresh.addEventListener('click', () => void this.load());
    root.append(this.choice, this.refresh);
  }
  schedule() {
    if (this.disposed) return;
    this.epoch++;
    this.controller?.abort();
    clearTimeout(this.timer);
    this.render([], true);
    this.timer = setTimeout(() => void this.load(), 350);
  }
  async load() {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.controller?.abort();
    const controller = new AbortController(),
      epoch = ++this.epoch;
    this.controller = controller;
    const snapshot = { ollamaUrl: this.settings.ollamaUrl, model: this.settings.model };
    this.render([], true);
    try {
      const names = await this.readModels(snapshot, controller.signal);
      if (this.disposed || epoch !== this.epoch || controller.signal.aborted) return;
      this.render(names, false);
    } catch (error) {
      if (this.disposed || epoch !== this.epoch || controller.signal.aborted) return;
      this.render([], false, error instanceof Error ? error.message : String(error));
    }
  }
  private render(names: string[], loading: boolean, error?: string) {
    this.cleanup?.();
    this.choice.replaceChildren();
    this.refresh.disabled = loading;
    this.refresh.textContent = loading ? 'Refreshing…' : 'Refresh';
    const select = this.root.ownerDocument.createElement('select');
    select.setAttribute('aria-label', 'Model');
    const current = this.settings.model.trim();
    // Ollama accepts an omitted :latest tag; show its installed entry without changing settings.
    const selected = names.includes(current)
      ? current
      : names.includes(`${current}:latest`)
        ? `${current}:latest`
        : current;
    const option = (value: string, text: string, disabled = false) => {
      const el = this.root.ownerDocument.createElement('option');
      el.value = value;
      el.textContent = text;
      el.disabled = disabled;
      select.append(el);
    };
    if (!names.includes(selected))
      option(
        current,
        current ? `${current}${!loading && !error ? ' · not installed' : ''}` : 'Choose a model',
        true,
      );
    for (const name of names) option(name, name);
    select.value = selected;
    select.disabled = loading || !!error || !names.length;
    select.addEventListener('change', () => {
      if (select.disabled || !names.includes(select.value)) return;
      this.settings.model = select.value;
      this.persist();
      this.describe(
        'Choose an installed model for vocabulary and writing. Refresh after downloading or removing a model.',
      );
    });
    this.choice.append(select);
    this.describe(
      loading
        ? 'Loading installed models from Ollama…'
        : error
          ? `Could not load models: ${error} Your saved model is kept. Check the server address and try Refresh.`
          : !names.length
            ? 'No models installed on this server. Download one with ollama pull, then click Refresh.'
            : !names.includes(selected)
              ? 'Your saved model is not installed on this server. Choose a model from the list or install it, then click Refresh.'
              : 'Choose an installed model for vocabulary and writing. Refresh after downloading or removing a model.',
    );
    this.cleanup = enhanceSelects(this.choice);
  }
  destroy() {
    this.disposed = true;
    this.epoch++;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.cleanup?.();
  }
}
