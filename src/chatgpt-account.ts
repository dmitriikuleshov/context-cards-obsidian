import { randomUUID } from 'node:crypto';
import {
  API_ORIGIN,
  AUTH_ORIGIN,
  OAUTH_SCOPES,
  loginCallback,
  oauthSecrets,
  responseBody,
  verifyIdentity,
  type LoginCallback,
} from './chatgpt-oauth';
import { ChatGPTError, cloudHTTP, type CloudHTTP } from './chatgpt-network';
import type { ModelRequest, SubscriptionConnection, SubscriptionModel } from './model-chat';
import type { Settings } from './types';

export interface SecretStore {
  getSecret(id: string): string | null;
  setSecret(id: string, value: string): void;
}
interface Tokens {
  access: string;
  refresh: string;
  identity: string;
  expires: number;
  scopes: string[];
}
interface Registration {
  id: string;
  subject: string;
  email: string;
  tokens?: Tokens;
}
interface RecordData {
  version: 1;
  host: string;
  active: string;
  accounts: Registration[];
}
export interface AccountState {
  active: string;
  accounts: { id: string; email: string; connected: boolean; allowed: boolean }[];
  signingIn: boolean;
  error: string;
}
export interface AccountDependencies {
  http?: CloudHTTP;
  callback?: (state: string, signal: AbortSignal) => Promise<LoginCallback>;
  now?: () => number;
}
const expiredCodes = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'refresh_token_expired',
  'refresh_token_reused',
  'token_expired',
  'refresh_token_invalidated',
]);
export class ChatGPTAccount implements SubscriptionConnection {
  private http: CloudHTTP;
  private now: () => number;
  private data?: RecordData;
  private login?: AbortController;
  private refreshing = new Map<string, Promise<void>>();
  private blocked = new Set<string>();
  private jobs = new Set<AbortController>();
  private stopped = false;
  private lastError = '';
  private listeners = new Set<() => void>();
  constructor(
    private store: SecretStore | undefined,
    private key: string,
    private openBrowser: (url: string) => void | Promise<void>,
    private dependencies: AccountDependencies = {},
  ) {
    this.http = dependencies.http ?? cloudHTTP;
    this.now = dependencies.now ?? Date.now;
  }
  private read() {
    if (!this.store)
      throw new Error(
        'ChatGPT sign-in requires Obsidian 1.11.4 or newer with Secret storage. Update Obsidian or choose Ollama.',
      );
    if (this.data) return this.data;
    const raw = this.store.getSecret(this.key);
    if (!raw)
      return (this.data = {
        version: 1,
        host: `urn:uuid:${randomUUID()}`,
        active: '',
        accounts: [],
      });
    try {
      const parsed = JSON.parse(raw);
      if (
        parsed.version !== 1 ||
        typeof parsed.host !== 'string' ||
        !/^urn:uuid:[a-f0-9-]{36}$/.test(parsed.host) ||
        typeof parsed.active !== 'string' ||
        !Array.isArray(parsed.accounts)
      )
        throw new Error();
      const ids = new Set();
      for (const a of parsed.accounts) {
        if (
          !a ||
          typeof a.id !== 'string' ||
          !a.id ||
          ids.has(a.id) ||
          typeof a.subject !== 'string' ||
          !a.subject ||
          typeof a.email !== 'string'
        )
          throw new Error();
        ids.add(a.id);
        const t = a.tokens;
        if (
          t &&
          (typeof t.access !== 'string' ||
            !t.access ||
            typeof t.refresh !== 'string' ||
            !t.refresh ||
            typeof t.identity !== 'string' ||
            !Number.isFinite(t.expires) ||
            !Array.isArray(t.scopes) ||
            t.scopes.some((s: unknown) => typeof s !== 'string'))
        )
          throw new Error();
      }
      return (this.data = parsed as RecordData);
    } catch {
      throw new Error(
        'The saved ChatGPT connection is damaged. Remove its Context Cards entry from Obsidian Secret storage, then reconnect.',
      );
    }
  }
  private save() {
    try {
      this.store!.setSecret(this.key, JSON.stringify(this.data));
    } catch {
      this.data = undefined;
      throw new Error(
        'Could not save ChatGPT sign-in to Obsidian Secret storage. Check storage access and reconnect.',
      );
    }
  }
  private notify() {
    for (const listener of this.listeners) listener();
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  state(): AccountState {
    const data = this.read();
    return {
      active: data.active,
      accounts: data.accounts.map((a) => ({
        id: a.id,
        email: a.email,
        connected: !!a.tokens,
        allowed: !!a.tokens?.scopes.includes('chatgpt.tokens.use.direct'),
      })),
      signingIn: !!this.login,
      error: this.lastError,
    };
  }
  select(id: string) {
    if (this.login) throw new Error('Finish or cancel ChatGPT sign-in before switching accounts.');
    const data = this.read();
    if (!data.accounts.some((a) => a.id === id)) throw new Error('Select a saved ChatGPT account.');
    data.active = id;
    this.save();
    this.lastError = '';
    this.notify();
  }
  private async discovery(signal?: AbortSignal) {
    const d = await this.http.json(`${AUTH_ORIGIN}/.well-known/openid-configuration`, { signal });
    for (const field of [
      'authorization_endpoint',
      'token_endpoint',
      'jwks_uri',
      'revocation_endpoint',
    ]) {
      const url = new URL(d?.[field]);
      if (url.origin !== AUTH_ORIGIN || url.username || url.password || url.hash)
        throw new Error('ChatGPT returned invalid sign-in service information.');
    }
    if (d.issuer !== AUTH_ORIGIN) throw new Error('ChatGPT returned an unexpected sign-in issuer.');
    return d as Record<string, string>;
  }
  async signIn(another = false) {
    if (this.stopped) throw new Error('Context Cards was unloaded. Reopen the plugin to connect.');
    if (this.login) throw new Error('ChatGPT sign-in is already in progress.');
    const data = this.read();
    const old = another ? undefined : data.accounts.find((a) => a.id === data.active);
    const controller = new AbortController();
    this.login = controller;
    this.lastError = '';
    let callback: LoginCallback | undefined;
    try {
      this.save();
      this.notify(); // Persist the installation identity before opening the browser.
      for (const job of this.jobs) job.abort();
      if (old) await this.refreshing.get(old.id)?.catch(() => {});
      const discovery = await this.discovery(controller.signal);
      const secrets = oauthSecrets();
      callback = await (this.dependencies.callback ?? loginCallback)(
        secrets.state,
        controller.signal,
      );
      const auth = new URL(discovery.authorization_endpoint!);
      const params: Record<string, string> = {
        client_id: old?.id ?? 'dynamic_agent_client',
        ext_agent_host_id: data.host,
        response_type: 'code',
        redirect_uri: callback.uri,
        scope: OAUTH_SCOPES,
        resource: API_ORIGIN,
        state: secrets.state,
        nonce: secrets.nonce,
        code_challenge_method: 'S256',
        code_challenge: secrets.challenge,
      };
      if (!old) params.agent_name_hint = 'Context Cards';
      // Always allow the user to see which account is signing in; no identity-token URL hint.
      if (old) params.login_hint = old.email;
      if (old && !old.tokens?.scopes.includes('chatgpt.tokens.use.direct'))
        params.prompt = 'consent';
      for (const [key, value] of Object.entries(params)) auth.searchParams.set(key, value);
      await this.openBrowser(auth.toString());
      const result = await callback.result;
      if (controller.signal.aborted) throw new Error('ChatGPT sign-in cancelled.');
      const id = old?.id ?? result.clientId;
      if (
        !id ||
        id === 'dynamic_agent_client' ||
        (old && result.clientId && result.clientId !== old.id)
      )
        throw new Error('ChatGPT returned an unexpected client registration. Sign in again.');
      const response = await this.http.json(discovery.token_endpoint!, {
        form: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: id,
          code: result.code,
          code_verifier: secrets.verifier,
          redirect_uri: callback.uri,
          resource: API_ORIGIN,
        }),
        signal: controller.signal,
      });
      const keys = await this.http.json(discovery.jwks_uri!, { signal: controller.signal });
      const identity = verifyIdentity(response.id_token ?? '', keys, id, secrets.nonce, this.now());
      if (old && old.subject !== identity.subject)
        throw new Error(
          'ChatGPT signed in to a different account. Use Add another account to connect it.',
        );
      const tokens = this.tokens(response);
      if (controller.signal.aborted || this.stopped) throw new Error('ChatGPT sign-in cancelled.');
      const account: Registration = { id, ...identity, tokens };
      data.accounts = [...data.accounts.filter((a) => a.id !== id), account];
      data.active = id;
      this.save();
      if (!tokens.scopes.includes('chatgpt.tokens.use.direct'))
        this.lastError =
          'Signed in, but permission to use your ChatGPT plan was not granted. Click Enable plan usage to reconnect with that permission.';
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'ChatGPT sign-in failed.';
      throw error;
    } finally {
      callback?.close();
      this.login = undefined;
      this.notify();
    }
  }
  cancelSignIn() {
    this.login?.abort();
  }
  private tokens(response: any, old?: Tokens): Tokens {
    if (
      typeof response.access_token !== 'string' ||
      !response.access_token ||
      typeof response.refresh_token !== 'string' ||
      !response.refresh_token ||
      typeof response.expires_in !== 'number' ||
      response.expires_in <= 0 ||
      response.expires_in > 86400 ||
      response.token_type?.toLowerCase() !== 'bearer'
    )
      throw new Error('ChatGPT returned incomplete sign-in credentials. Reconnect in settings.');
    const scopes =
      typeof response.scope === 'string'
        ? response.scope.split(/\s+/).filter(Boolean)
        : (old?.scopes ?? []);
    return {
      access: response.access_token,
      refresh: response.refresh_token,
      identity: response.id_token ?? old?.identity ?? '',
      expires: this.now() + response.expires_in * 1000,
      scopes,
    };
  }
  private account(id?: string) {
    if (this.stopped) throw new Error('Context Cards was unloaded.');
    if (this.login) throw new Error('Finish or cancel ChatGPT sign-in before generating.');
    const data = this.read(),
      account = data.accounts.find((a) => a.id === (id ?? data.active));
    if (!account?.tokens || this.blocked.has(account.id))
      throw new Error('Sign in to ChatGPT in Context Cards settings before generating.');
    if (!account.tokens.scopes.includes('chatgpt.tokens.use.direct'))
      throw new Error(
        'Permission to use your ChatGPT plan is missing. Click Enable plan usage in settings.',
      );
    return account;
  }
  private async refresh(account: Registration) {
    const existing = this.refreshing.get(account.id);
    if (existing) return existing;
    const work = (async () => {
      try {
        const discovery = await this.discovery();
        const response = await this.http.json(discovery.token_endpoint!, {
          form: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: account.id,
            refresh_token: account.tokens!.refresh,
            resource: API_ORIGIN,
          }),
        });
        if (response.id_token) {
          const keys = await this.http.json(discovery.jwks_uri!);
          const identity = verifyIdentity(
            response.id_token,
            keys,
            account.id,
            undefined,
            this.now(),
          );
          if (identity.subject !== account.subject)
            throw new Error('ChatGPT changed the session identity. Reconnect in settings.');
        }
        account.tokens = this.tokens(response, account.tokens);
        this.save();
      } catch (error) {
        if (error instanceof ChatGPTError && expiredCodes.has(error.code)) {
          account.tokens = undefined;
          this.save();
        }
        this.lastError =
          error instanceof Error ? error.message : 'Could not refresh ChatGPT sign-in.';
        this.notify();
        throw error;
      }
    })();
    this.refreshing.set(account.id, work);
    try {
      await work;
    } finally {
      this.refreshing.delete(account.id);
    }
  }
  private async access(id?: string) {
    const account = this.account(id);
    if (account.tokens!.expires < this.now() + 60000) await this.refresh(account);
    return this.account(account.id).tokens!.access;
  }
  private async authorized<T>(
    id: string | undefined,
    signal: AbortSignal | undefined,
    timeout: number,
    operation: (token: string, signal: AbortSignal, timeout: number) => Promise<T>,
  ) {
    const started = this.now(),
      controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) throw new Error('Cancelled.');
    signal?.addEventListener('abort', abort, { once: true });
    this.jobs.add(controller);
    const timer = setTimeout(abort, timeout);
    try {
      const token = await new Promise<string>((resolve, reject) => {
        const stop = () => reject(new Error('Cancelled or ChatGPT request timed out.'));
        controller.signal.addEventListener('abort', stop, { once: true });
        this.access(id)
          .then(resolve, reject)
          .finally(() => controller.signal.removeEventListener('abort', stop));
      });
      if (controller.signal.aborted) throw new Error('Cancelled or ChatGPT request timed out.');
      const remaining = Math.max(1, timeout - (this.now() - started));
      return await operation(token, controller.signal, remaining);
    } catch (error) {
      if (error instanceof ChatGPTError) {
        const account = this.read().accounts.find((a) => a.id === (id ?? this.read().active));
        if (account && ['http_401', 'subscription_sharing_invalid_user'].includes(error.code)) {
          account.tokens = undefined;
          this.save();
        } else if (
          account?.tokens &&
          [
            'chatpass_v2_scope_not_authorized',
            'chatpass_v2_invalid_authorization_context',
          ].includes(error.code)
        ) {
          account.tokens.scopes = account.tokens.scopes.filter(
            (scope) => scope !== 'chatgpt.tokens.use.direct',
          );
          this.save();
        }
      }
      this.lastError = error instanceof Error ? error.message : 'ChatGPT request failed.';
      this.notify();
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      this.jobs.delete(controller);
    }
  }
  async models(signal?: AbortSignal, account?: string): Promise<SubscriptionModel[]> {
    return this.authorized(account, signal, 15000, async (token, signal, timeout) => {
      const data = await this.http.json(`${API_ORIGIN}/models`, { token, signal, timeout });
      if (!Array.isArray(data?.models))
        throw new Error('ChatGPT returned an invalid model list. Try Refresh models.');
      const seen = new Set<string>();
      const models: SubscriptionModel[] = [];
      for (const item of data.models) {
        if (item?.visibility !== 'list') continue;
        if (
          typeof item.slug !== 'string' ||
          !item.slug.trim() ||
          typeof item.display_name !== 'string' ||
          !item.display_name.trim()
        )
          throw new Error('ChatGPT returned an invalid model entry. Try Refresh models.');
        if (!seen.has(item.slug)) {
          models.push({ id: item.slug, name: item.display_name });
          seen.add(item.slug);
        }
      }
      this.lastError = '';
      return models;
    });
  }
  async chat(
    body: ModelRequest,
    settings: Settings,
    signal?: AbortSignal,
    timeout = settings.timeoutSeconds * 1000,
  ) {
    if (!settings.chatgptModel.trim())
      throw new Error('Choose a ChatGPT model in Context Cards settings.');
    if (!settings.chatgptAccountId)
      throw new Error('Connect a ChatGPT account in Context Cards settings.');
    const text = await this.authorized(
      settings.chatgptAccountId,
      signal,
      timeout,
      (token, signal, timeout) =>
        this.http.stream(`${API_ORIGIN}/responses`, {
          token,
          body: responseBody(settings.chatgptModel, body.messages, body.format),
          signal,
          timeout,
        }),
    );
    this.lastError = '';
    return { message: { content: text }, done_reason: 'stop' };
  }
  async signOut(id?: string) {
    const data = this.read(),
      account = data.accounts.find((a) => a.id === (id ?? data.active));
    if (!account) return;
    this.blocked.add(account.id);
    for (const controller of this.jobs) controller.abort();
    let failure = '';
    try {
      await this.refreshing.get(account.id)?.catch(() => {});
      if (account.tokens) {
        const discovery = await this.discovery();
        await this.http.json(discovery.revocation_endpoint!, {
          form: new URLSearchParams({
            token: account.tokens.refresh,
            token_type_hint: 'refresh_token',
            client_id: account.id,
          }),
        });
      }
    } catch {
      failure =
        'Signed out locally. Remote sign-out could not be confirmed; disconnect Context Cards in ChatGPT Settings → Security and login.';
    } finally {
      account.tokens = undefined;
      this.save();
      this.blocked.delete(account.id);
      this.lastError = failure;
      this.notify();
    }
    if (failure) throw new Error(failure);
  }
  dispose() {
    this.stopped = true;
    this.cancelSignIn();
    for (const controller of this.jobs) controller.abort();
    this.listeners.clear();
  }
}
