import { ChatGPTControl } from '../../src/chatgpt-control';
import { enhanceSelects } from '../../src/select-menu';
import { DEFAULTS } from '../../src/types';
import type { AccountState } from '../../src/chatgpt-account';

/** Simulated subscription: no OAuth/network calls and no real credentials. */
export function mountChatGPTSettings(root: HTMLElement) {
  const settings = { ...structuredClone(DEFAULTS), provider: 'chatgpt' as const };
  const state: AccountState = { active: '', accounts: [], signingIn: false, error: '' };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((f) => f());
  let cancel = false;
  const account = {
    state: () => structuredClone(state),
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    select: (id: string) => {
      state.active = id;
      notify();
    },
    signIn: async () => {
      cancel = false;
      state.signingIn = true;
      notify();
      await new Promise((r) => setTimeout(r, 250));
      state.signingIn = false;
      if (cancel) {
        notify();
        throw new Error('ChatGPT sign-in cancelled.');
      }
      state.active = 'preview';
      state.accounts = [
        { id: 'preview', email: 'reader@example.com', connected: true, allowed: true },
      ];
      notify();
    },
    cancelSignIn: () => {
      cancel = true;
      state.signingIn = false;
      notify();
    },
    signOut: async () => {
      state.accounts[0]!.connected = false;
      notify();
    },
    models: async () => {
      if (new URLSearchParams(location.search).has('limit'))
        throw new Error('ChatGPT plan usage limit reached. Check Settings → Usage in ChatGPT.');
      return [
        { id: 'gpt-6-luna', name: 'GPT-6 Luna' },
        { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol' },
      ];
    },
  };
  root.replaceChildren();
  root.style.padding = '22px';
  const title = root.createEl('h2', { text: 'Context Cards' });
  title.style.marginTop = '0';
  root.createEl('h3', { text: 'AI connection' });
  const provider = root.createEl('select');
  provider.setAttribute('aria-label', 'Provider');
  for (const [id, name] of [
    ['ollama', 'Ollama · local model'],
    ['chatgpt', 'ChatGPT · subscription'],
  ]) {
    const option = root.createEl('option');
    option.value = id!;
    option.textContent = name!;
    provider.append(option);
  }
  provider.value = 'chatgpt';
  const content = root.createDiv();
  let control: ChatGPTControl | undefined;
  const render = () => {
    control?.destroy();
    content.replaceChildren();
    if (provider.value === 'ollama') {
      content.createEl('h3', { text: 'Local model' });
      content.createEl('p', { text: 'Your Ollama model and server settings are kept.' });
      return;
    }
    content.createEl('h3', { text: 'ChatGPT subscription' });
    content.createEl('p', {
      cls: 'cc-muted',
      text: 'Sends selected text and context to OpenAI. Uses the shared allowance included in your ChatGPT plan after you grant permission. No API key or automatic switch to API billing. Internet access is required.',
    });
    control = new ChatGPTControl(
      content.createDiv(),
      settings,
      account,
      () => {},
      () => {},
    );
  };
  provider.addEventListener('change', () => {
    account.cancelSignIn();
    render();
  });
  enhanceSelects(root);
  render();
  Object.assign(window, { chatgptPreview: { settings, state, account } });
}
