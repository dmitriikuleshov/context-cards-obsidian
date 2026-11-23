import { describe, expect, it, vi } from 'vitest';
import { ChatGPTAccount } from '../../src/chatgpt-account';
import { ChatGPTError } from '../../src/chatgpt-network';
import { DEFAULTS } from '../../src/types';
import { accountFixture, jwt } from './fixtures';

describe('ChatGPT subscription session lifecycle', () => {
  it('signs in with dynamic registration and persists secrets separately from settings', async () => {
    const f = accountFixture();
    await f.account.signIn();
    expect(f.auth().searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(f.auth().searchParams.get('agent_name_hint')).toBe('Context Cards');
    expect(f.auth().searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
    expect(f.account.state().accounts[0]).toMatchObject({
      id: f.config.id,
      connected: true,
      allowed: true,
    });
    expect(JSON.stringify(f.account.state())).not.toContain('test-access');
    expect(JSON.stringify(DEFAULTS)).not.toContain('test-refresh');
    expect(f.close).toHaveBeenCalledOnce();
    const restored = new ChatGPTAccount(f.store, 'context-cards-test', f.open, f.deps);
    expect(restored.state().active).toBe(f.config.id);
    await restored.models();
    expect(f.open).toHaveBeenCalledOnce();
  });
  it('reuses registration and host identity instead of registering on every login', async () => {
    const f = accountFixture();
    await f.account.signIn();
    const host = f.auth().searchParams.get('ext_agent_host_id');
    await f.account.signOut();
    await f.account.signIn();
    expect(f.auth().searchParams.get('client_id')).toBe(f.config.id);
    expect(f.auth().searchParams.get('ext_agent_host_id')).toBe(host);
    expect(f.auth().searchParams.has('agent_name_hint')).toBe(false);
  });
  it('refreshes expired access automatically and serializes concurrent refreshes', async () => {
    const f = accountFixture();
    await f.account.signIn();
    f.config.now += 3590000;
    await Promise.all([f.account.models(), f.account.models()]);
    const refreshes = f.json.mock.calls.filter(
      ([, options]) => options?.form?.get('grant_type') === 'refresh_token',
    );
    expect(refreshes).toHaveLength(1);
    expect(JSON.parse(f.secret()!).accounts[0].tokens.refresh).toBe('test-refresh-2');
    expect(f.open).toHaveBeenCalledOnce();
  });
  it('clears expired credentials on terminal refresh failure, preserving registration', async () => {
    const f = accountFixture();
    await f.account.signIn();
    f.config.now += 3600000;
    const original = f.json.getMockImplementation()!;
    f.json.mockImplementation(async (url, options) => {
      if (options?.form?.get('grant_type') === 'refresh_token')
        throw new ChatGPTError('invalid_grant', 'Session expired.');
      return original(url, options);
    });
    await expect(f.account.models()).rejects.toThrow(/expired/);
    expect(f.account.state().accounts[0]).toMatchObject({ connected: false, id: f.config.id });
    expect(f.secret()).not.toContain('test-refresh');
  });
  it('keeps valid credentials after a temporary network failure and exposes a retryable message', async () => {
    const f = accountFixture();
    await f.account.signIn();
    const original = f.json.getMockImplementation()!;
    f.json.mockImplementation(async (url, options) => {
      if (url.endsWith('/models')) throw new Error('Cannot connect to ChatGPT.');
      return original(url, options);
    });
    await expect(f.account.models()).rejects.toThrow(/connect/);
    expect(f.account.state().accounts[0]!.connected).toBe(true);
  });
  it('does not treat identity-only login as permission to consume the plan', async () => {
    const f = accountFixture();
    f.config.scopes = 'openid profile email offline_access';
    await f.account.signIn();
    expect(f.account.state().accounts[0]!.allowed).toBe(false);
    await expect(f.account.models()).rejects.toThrow(/permission/i);
    expect(f.stream).not.toHaveBeenCalled();
    await f.account.signIn();
    expect(f.auth().searchParams.get('prompt')).toBe('consent');
  });
  it('supports multiple saved accounts with explicit selection and pins inference to the chosen registration', async () => {
    const f = accountFixture();
    await f.account.signIn();
    const first = f.config.id;
    f.config.id = 'oaiapp-second';
    f.config.subject = 'second';
    f.config.email = 'second@example.test';
    await f.account.signIn(true);
    expect(f.account.state().accounts).toHaveLength(2);
    f.account.select(first);
    expect(f.account.state().active).toBe(first);
    expect(() => f.account.select('missing')).toThrow(/Select/);
    await f.account.chat(
      { model: 'local', messages: [], format: {} },
      { ...DEFAULTS, provider: 'chatgpt', chatgptAccountId: first, chatgptModel: 'gpt-6-luna' },
    );
    expect(f.stream.mock.calls[0]).toBeDefined();
  });
  it('rejects a mismatched identity or client during returning sign-in', async () => {
    const f = accountFixture();
    await f.account.signIn();
    f.config.subject = 'other';
    await expect(f.account.signIn()).rejects.toThrow(/different account/);
    expect(f.account.state().accounts[0]!.email).toBe('reader@example.test');
    f.config.id = 'wrong-client';
    await expect(f.account.signIn()).rejects.toThrow(/unexpected client/);
  });
  it('keeps the previous session if a new login fails or the browser cannot open', async () => {
    const f = accountFixture();
    await f.account.signIn();
    f.open.mockImplementation(() => {
      throw new Error('Browser could not open.');
    });
    await expect(f.account.signIn(true)).rejects.toThrow(/Browser/);
    expect(f.account.state().accounts[0]!.connected).toBe(true);
    expect(f.account.state().signingIn).toBe(false);
    expect(f.close).toHaveBeenCalledTimes(2);
  });
  it('signs out locally even when remote revocation fails and reports the difference', async () => {
    const f = accountFixture();
    await f.account.signIn();
    const original = f.json.getMockImplementation()!;
    f.json.mockImplementation(async (url, options) => {
      if (url.endsWith('/revoke')) throw new Error('Offline');
      return original(url, options);
    });
    await expect(f.account.signOut()).rejects.toThrow(/Remote sign-out/);
    expect(f.account.state().accounts[0]!.connected).toBe(false);
    expect(f.secret()).not.toContain('test-access');
  });
  it('rejects unavailable Secret storage and corrupted credential records', () => {
    expect(() => new ChatGPTAccount(undefined, 'key', () => {}).state()).toThrow(/1.11.4/);
    for (const raw of [
      'broken',
      '{}',
      JSON.stringify({
        version: 1,
        host: 'urn:uuid:' + crypto.randomUUID(),
        active: 'a',
        accounts: [{ id: 'a', subject: 'x', email: 'x', tokens: {} }],
      }),
    ]) {
      const f = accountFixture();
      f.setSecret(raw);
      expect(() => f.account.state()).toThrow(/damaged/);
    }
  });
  it('handles Secret storage write errors without leaving sign-in stuck', async () => {
    const f = accountFixture();
    f.store.setSecret.mockImplementation(() => {
      throw new Error('private data');
    });
    await expect(f.account.signIn()).rejects.toThrow(/Secret storage/);
    expect(f.account.state().signingIn).toBe(false);
    expect(f.open).not.toHaveBeenCalled();
  });
  it('validates discovery and token payloads before storing credentials', async () => {
    const f = accountFixture();
    f.discovery.jwks_uri = 'https://evil.test/keys';
    await expect(f.account.signIn()).rejects.toThrow(/service information/);
    const g = accountFixture();
    const original = g.json.getMockImplementation()!;
    g.json.mockImplementation(async (url, options) =>
      url.endsWith('/oauth/token') ? {} : original(url, options),
    );
    await expect(g.account.signIn()).rejects.toThrow(/identity token/);
    expect(g.account.state().accounts).toHaveLength(0);
  });
  it('retains the selected model and reports a bad catalog rather than inventing model choices', async () => {
    const f = accountFixture();
    await f.account.signIn();
    expect(await f.account.models()).toEqual([{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }]);
    f.json.mockResolvedValueOnce({ data: [] });
    await expect(f.account.models()).rejects.toThrow(/invalid model list/);
    f.json.mockResolvedValueOnce({ models: [{ visibility: 'list', slug: 'a' }] });
    await expect(f.account.models()).rejects.toThrow(/invalid model entry/);
  });
  it('refuses missing model/account selection and does not silently charge an API key', async () => {
    const f = accountFixture();
    const body = { model: 'local', messages: [], format: {} };
    await expect(f.account.chat(body, DEFAULTS)).rejects.toThrow(/Choose a ChatGPT model/);
    await expect(f.account.chat(body, { ...DEFAULTS, chatgptModel: 'gpt-6-luna' })).rejects.toThrow(
      /Connect a ChatGPT account/,
    );
    expect(f.stream).not.toHaveBeenCalled();
    f.account.dispose();
    await expect(f.account.signIn()).rejects.toThrow(/unloaded/);
  });
});
