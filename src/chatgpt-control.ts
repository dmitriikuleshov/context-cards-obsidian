import type { ChatGPTAccount, AccountState } from './chatgpt-account';
import type { Settings } from './types';
import type { SubscriptionModel } from './model-chat';
import { enhanceSelects } from './select-menu';

export type AccountControl = Pick<
  ChatGPTAccount,
  'state' | 'subscribe' | 'select' | 'signIn' | 'cancelSignIn' | 'signOut' | 'models'
>;
/** Settings UI has no credential access. Account/model failures preserve saved choices. */
export class ChatGPTControl {
  private unsubscribe?: () => void;
  private cleanup?: () => void;
  private controller?: AbortController;
  private disposed = false;
  private busy = false;
  private loading = false;
  private error = '';
  private models: SubscriptionModel[] = [];
  private modelAccount = '';
  private epoch = 0;
  constructor(
    private root: HTMLElement,
    private settings: Settings,
    private account: AccountControl,
    private persist: () => void,
    private open: (url: string) => void,
  ) {
    root.classList.add('cc-chatgpt-settings');
    this.unsubscribe = account.subscribe(() => this.render());
    this.render();
    try {
      const state = account.state(),
        current = state.accounts.find((a) => a.id === state.active);
      if (state.active && settings.chatgptAccountId !== state.active) {
        settings.chatgptAccountId = state.active;
        persist();
      }
      if (current?.connected && current.allowed) void this.loadModels();
    } catch {
      /* Render shows the unavailable Secret storage message. */
    }
  }
  private button(parent: HTMLElement, label: string, action: () => void, disabled = false) {
    const button = parent.ownerDocument.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', action);
    parent.append(button);
    return button;
  }
  private async run(action: () => Promise<void>) {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.error = '';
    this.render();
    try {
      await action();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not update ChatGPT connection.';
    } finally {
      this.busy = false;
      if (!this.disposed) {
        let state: AccountState;
        try {
          state = this.account.state();
        } catch {
          this.render();
          return;
        }
        if (this.settings.chatgptAccountId !== state.active) {
          this.settings.chatgptAccountId = state.active;
          this.persist();
        }
        this.render();
        const active = state.accounts.find((a) => a.id === state.active);
        if (active?.connected && active.allowed && !this.error) await this.loadModels();
      }
    }
  }
  async loadModels() {
    if (this.disposed) return;
    const state = this.account.state(),
      active = state.accounts.find((a) => a.id === state.active);
    if (!active?.connected || !active.allowed) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const epoch = ++this.epoch;
    this.loading = true;
    this.error = '';
    this.render();
    try {
      const models = await this.account.models(controller.signal, state.active);
      if (this.disposed || controller.signal.aborted || epoch !== this.epoch) return;
      this.models = models;
      this.modelAccount = state.active;
    } catch (error) {
      if (this.disposed || controller.signal.aborted || epoch !== this.epoch) return;
      this.error = error instanceof Error ? error.message : 'Could not load ChatGPT models.';
    } finally {
      if (!this.disposed && epoch === this.epoch) {
        this.loading = false;
        this.render();
      }
    }
  }
  private render() {
    if (this.disposed) return;
    this.cleanup?.();
    this.root.replaceChildren();
    const doc = this.root.ownerDocument;
    let state: AccountState;
    try {
      state = this.account.state();
    } catch (error) {
      const p = doc.createElement('p');
      p.className = 'cc-error';
      p.textContent = error instanceof Error ? error.message : 'ChatGPT connection is unavailable.';
      this.root.append(p);
      return;
    }
    const active = state.accounts.find((a) => a.id === state.active);
    const status = doc.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = state.signingIn
      ? 'Finish sign-in in your browser, then return here. You can close the browser after connecting.'
      : active?.connected
        ? `${active.email} · ${active.allowed ? 'Connected' : 'Plan permission needed'}`
        : active
          ? `${active.email} · Signed out`
          : 'Not connected';
    this.root.append(status);
    if (state.accounts.length > 1) {
      const select = doc.createElement('select');
      select.setAttribute('aria-label', 'ChatGPT account');
      for (const a of state.accounts) {
        const option = doc.createElement('option');
        option.value = a.id;
        option.textContent = `${a.email} · ${a.id.slice(-8)}`;
        select.append(option);
      }
      select.value = state.active;
      select.disabled = this.busy || state.signingIn;
      select.addEventListener('change', () => {
        if (select.disabled) return;
        this.controller?.abort();
        this.epoch++;
        this.loading = false;
        this.models = [];
        this.error = '';
        this.account.select(select.value);
        this.settings.chatgptAccountId = select.value;
        this.persist();
        void this.loadModels();
      });
      this.root.append(select);
    }
    const actions = doc.createElement('div');
    actions.className = 'cc-chatgpt-actions';
    this.root.append(actions);
    if (state.signingIn) this.button(actions, 'Cancel sign-in', () => this.account.cancelSignIn());
    else {
      if (!active?.connected || !active.allowed)
        this.button(
          actions,
          active?.connected ? 'Enable plan usage' : 'Continue with ChatGPT',
          () => void this.run(() => this.account.signIn()),
          this.busy,
        ).classList.add('mod-cta');
      if (active?.connected)
        this.button(
          actions,
          'Sign out',
          () => void this.run(() => this.account.signOut()),
          this.busy,
        );
      if (state.accounts.length)
        this.button(
          actions,
          'Add another account',
          () => void this.run(() => this.account.signIn(true)),
          this.busy,
        );
    }
    this.button(
      actions,
      'Manage usage',
      () => this.open('https://chatgpt.com/settings/usage'),
      false,
    );
    if (active?.connected && active.allowed && !state.signingIn) {
      const row = doc.createElement('div');
      row.className = 'cc-chatgpt-model';
      const label = doc.createElement('label');
      label.textContent = 'ChatGPT model';
      const select = doc.createElement('select');
      select.setAttribute('aria-label', 'ChatGPT model');
      const names = this.modelAccount === state.active ? this.models : [];
      const current = this.settings.chatgptModel;
      if (!names.some((m) => m.id === current)) {
        const option = doc.createElement('option');
        option.value = current;
        option.textContent = current
          ? `${current}${!this.loading && !this.error ? ' · unavailable' : ''}`
          : 'Choose a model';
        option.disabled = true;
        select.append(option);
      }
      for (const model of names) {
        const option = doc.createElement('option');
        option.value = model.id;
        option.textContent = model.name;
        select.append(option);
      }
      select.value = current;
      select.disabled = this.loading || this.busy || !!this.error || !names.length;
      select.addEventListener('change', () => {
        if (!select.disabled && names.some((m) => m.id === select.value)) {
          this.settings.chatgptModel = select.value;
          this.persist();
        }
      });
      label.append(select);
      row.append(label);
      this.button(
        row,
        this.loading ? 'Refreshing…' : 'Refresh models',
        () => void this.loadModels(),
        this.loading || this.busy,
      );
      this.root.append(row);
      const description = doc.createElement('p');
      description.className = 'cc-muted';
      description.textContent = this.loading
        ? 'Loading models available to this ChatGPT account…'
        : !names.length && !this.error
          ? 'No available models returned. Try Refresh models or check account permissions.'
          : 'Choose a model for both vocabulary and writing. Your Ollama model is saved separately.';
      this.root.append(description);
    }
    const message = this.error || state.error;
    if (message) {
      const error = doc.createElement('p');
      error.className = 'cc-error';
      error.setAttribute('role', 'alert');
      error.textContent = message;
      this.root.append(error);
    }
    this.cleanup = enhanceSelects(this.root);
  }
  cancel() {
    this.account.cancelSignIn();
  }
  destroy() {
    this.disposed = true;
    this.epoch++;
    this.controller?.abort();
    this.unsubscribe?.();
    this.cleanup?.();
  }
}
