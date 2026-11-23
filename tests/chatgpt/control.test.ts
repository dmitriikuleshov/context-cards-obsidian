// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatGPTControl } from '../../src/chatgpt-control';
import type { AccountState } from '../../src/chatgpt-account';
import { DEFAULTS } from '../../src/types';
import { installDomHelpers } from '../dom';
installDomHelpers();
const controls: ChatGPTControl[] = [];
afterEach(() => {
  controls.splice(0).forEach((c) => c.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fixture(connected = false) {
  const root = document.createElement('div');
  document.body.append(root);
  const settings = { ...structuredClone(DEFAULTS), provider: 'chatgpt' as const };
  const state: AccountState = {
    active: connected ? 'first' : '',
    accounts: connected
      ? [{ id: 'first', email: 'reader@example.test', connected: true, allowed: true }]
      : [],
    signingIn: false,
    error: '',
  };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((f) => f());
  const account = {
    state: vi.fn(() => structuredClone(state)),
    subscribe: vi.fn((f: () => void) => {
      listeners.add(f);
      return () => listeners.delete(f);
    }),
    select: vi.fn((id: string) => {
      state.active = id;
      notify();
    }),
    signIn: vi.fn(async () => {
      state.active = 'first';
      state.accounts = [
        { id: 'first', email: 'reader@example.test', connected: true, allowed: true },
      ];
      notify();
    }),
    cancelSignIn: vi.fn(),
    signOut: vi.fn(async () => {
      state.accounts[0]!.connected = false;
      notify();
    }),
    models: vi.fn(async () => [
      { id: 'gpt-6-luna', name: 'GPT-6 Luna' },
      { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol' },
    ]),
  };
  const persist = vi.fn(),
    open = vi.fn();
  const control = new ChatGPTControl(root, settings, account, persist, open);
  controls.push(control);
  const button = (label: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === label,
    )!;
  return { root, settings, state, account, control, persist, open, notify, button };
}
describe('ChatGPT connection settings', () => {
  it('handles storage failure during refresh or account selection without losing the saved choice', async () => {
    const f = fixture(true);
    await flush();
    f.state.accounts.push({
      id: 'second',
      email: 'second@example.test',
      connected: true,
      allowed: true,
    });
    f.notify();
    f.account.select.mockImplementationOnce(() => {
      throw new Error('Could not save account.');
    });
    const select = Array.from(f.root.querySelectorAll('select')).find(
      (s) => !s.closest('.cc-chatgpt-model'),
    )!;
    select.value = 'second';
    select.dispatchEvent(new Event('change'));
    expect(f.settings.chatgptAccountId).toBe('first');
    expect(f.root.textContent).toContain('Could not save account.');
    f.account.state.mockImplementation(() => {
      throw new Error('Secret storage is unavailable.');
    });
    await expect(f.control.loadModels()).resolves.toBeUndefined();
    expect(f.root.textContent).toContain('Secret storage is unavailable.');
  });
  it('offers explicit account addition, model refresh and cancellation', async () => {
    const f = fixture(true);
    await flush();
    f.button('Refresh models').click();
    await flush();
    expect(f.account.models).toHaveBeenCalledTimes(2);
    f.button('Add another account').click();
    await flush();
    expect(f.account.signIn).toHaveBeenCalledWith(true);
    f.control.cancel();
    expect(f.account.cancelSignIn).toHaveBeenCalled();
    f.account.models.mockResolvedValueOnce([]);
    await f.control.loadModels();
    expect(f.root.textContent).toContain('No available models');
  });
  it('does not persist late sign-in UI changes after leaving provider settings', async () => {
    const f = fixture();
    let resolve!: () => void;
    f.account.signIn.mockImplementationOnce(() => new Promise<void>((r) => (resolve = r)));
    f.button('Continue with ChatGPT').click();
    const calls = f.persist.mock.calls.length;
    f.control.destroy();
    resolve();
    await flush();
    expect(f.persist).toHaveBeenCalledTimes(calls);
  });
  it('shows a clear empty state and never sends generation requests on opening settings', () => {
    const f = fixture();
    expect(f.root.textContent).toContain('Not connected');
    expect(f.button('Continue with ChatGPT')).toBeDefined();
    expect(f.button('Sign out')).toBeUndefined();
    expect(f.account.models).not.toHaveBeenCalled();
    f.button('Manage usage').click();
    expect(f.open).toHaveBeenCalledWith('https://chatgpt.com/settings/usage');
  });
  it('connects, shows the account and fetches models without auto-selecting one', async () => {
    const f = fixture();
    f.button('Continue with ChatGPT').click();
    await flush();
    expect(f.settings.chatgptAccountId).toBe('first');
    expect(f.root.textContent).toContain('reader@example.test · Connected');
    expect(f.settings.chatgptModel).toBe('');
    expect(f.button('Choose a model')).toBeDefined();
    const select = f.root.querySelector<HTMLSelectElement>('.cc-chatgpt-model select')!;
    select.value = 'gpt-6-luna';
    select.dispatchEvent(new Event('change'));
    expect(f.settings.chatgptModel).toBe('gpt-6-luna');
    expect(f.settings.model).toBe(DEFAULTS.model);
  });
  it('supports cancellation while waiting in the browser', async () => {
    const f = fixture();
    f.state.signingIn = true;
    f.notify();
    expect(f.root.textContent).toContain('Finish sign-in in your browser');
    expect(f.button('Continue with ChatGPT')).toBeUndefined();
    f.button('Cancel sign-in').click();
    expect(f.account.cancelSignIn).toHaveBeenCalledOnce();
  });
  it('explains missing plan permission and offers a separate enable action', async () => {
    const f = fixture(true);
    await flush();
    f.state.accounts[0]!.allowed = false;
    f.notify();
    expect(f.button('Enable plan usage')).toBeDefined();
    expect(f.root.querySelector('.cc-chatgpt-model')).toBeNull();
    f.button('Enable plan usage').click();
    await flush();
    expect(f.account.signIn).toHaveBeenCalledWith();
  });
  it('keeps unavailable model choices and prevents choosing fabricated values', async () => {
    const f = fixture(true);
    f.settings.chatgptModel = 'saved-model';
    await flush();
    expect(f.button('saved-model · unavailable')).toBeDefined();
    expect(f.settings.chatgptModel).toBe('saved-model');
    const select = f.root.querySelector<HTMLSelectElement>('.cc-chatgpt-model select')!;
    select.value = 'not-found';
    select.dispatchEvent(new Event('change'));
    expect(f.settings.chatgptModel).toBe('saved-model');
  });
  it('keeps the saved model after a failed refresh and presents the actual safe message', async () => {
    const f = fixture(true);
    await flush();
    f.settings.chatgptModel = 'gpt-6-luna';
    f.account.models.mockRejectedValueOnce(new Error('Plan limit reached.'));
    await f.control.loadModels();
    expect(f.root.textContent).toContain('Plan limit reached.');
    expect(f.settings.chatgptModel).toBe('gpt-6-luna');
    expect(f.root.querySelector<HTMLSelectElement>('.cc-chatgpt-model select')!.disabled).toBe(
      true,
    );
    await f.control.loadModels();
    expect(f.root.textContent).not.toContain('Plan limit reached.');
  });
  it('discards a late catalog after destruction instead of changing settings', async () => {
    const f = fixture(true);
    await flush();
    let resolve!: (v: any) => void;
    f.account.models.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const pending = f.control.loadModels();
    f.control.destroy();
    const text = f.root.textContent;
    resolve([{ id: 'late', name: 'Late' }]);
    await pending;
    expect(f.root.textContent).toBe(text);
    expect(f.settings.chatgptModel).toBe('');
  });
  it('switches accounts explicitly and only uses the catalog belonging to that account', async () => {
    const f = fixture(true);
    await flush();
    f.state.accounts.push({
      id: 'second',
      email: 'reader@example.test',
      connected: true,
      allowed: true,
    });
    f.notify();
    const select = Array.from(f.root.querySelectorAll('select')).find(
      (s) => !s.closest('.cc-chatgpt-model'),
    )!;
    select.value = 'second';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(f.settings.chatgptAccountId).toBe('second');
    expect(f.account.models).toHaveBeenLastCalledWith(expect.any(AbortSignal), 'second');
    expect(f.account.select).toHaveBeenCalledWith('second');
  });
  it('renders startup storage failures without a non-working sign-in button', () => {
    const f = fixture();
    f.account.state.mockImplementation(() => {
      throw new Error('Update Obsidian for Secret storage.');
    });
    f.notify();
    expect(f.root.textContent).toContain('Update Obsidian');
    expect(f.root.querySelector('button')).toBeNull();
  });
  it('shows local-only logout failure and removes model controls for the disconnected session', async () => {
    const f = fixture(true);
    await flush();
    f.account.signOut.mockImplementationOnce(async () => {
      f.state.accounts[0]!.connected = false;
      f.notify();
      throw new Error('Signed out locally. Remote sign-out could not be confirmed.');
    });
    f.button('Sign out').click();
    await flush();
    expect(f.root.textContent).toContain('Remote sign-out');
    expect(f.button('Continue with ChatGPT')).toBeDefined();
    expect(f.root.querySelector('.cc-chatgpt-model')).toBeNull();
  });
});
