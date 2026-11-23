import { generateKeyPairSync, sign } from 'node:crypto';
import { vi } from 'vitest';
import { ChatGPTAccount } from '../../src/chatgpt-account';
import { API_ORIGIN, AUTH_ORIGIN, OAUTH_SCOPES } from '../../src/chatgpt-oauth';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const jwk = {
  ...pair.publicKey.export({ format: 'jwk' }),
  kid: 'test-key',
  use: 'sig',
  alg: 'RS256',
};
export function jwt(claims: Record<string, unknown>, header = { alg: 'RS256', kid: 'test-key' }) {
  const unsigned = [header, claims]
    .map((v) => Buffer.from(JSON.stringify(v)).toString('base64url'))
    .join('.');
  return (
    unsigned + '.' + sign('sha256', Buffer.from(unsigned), pair.privateKey).toString('base64url')
  );
}
export function accountFixture() {
  let secret: string | null = null;
  const config = {
    now: 1795500000000,
    id: 'oaiapp-test',
    subject: 'test-user',
    email: 'reader@example.test',
    scopes: OAUTH_SCOPES,
    tokenNumber: 0,
  };
  let auth: URL;
  const store = {
    getSecret: vi.fn(() => secret),
    setSecret: vi.fn((_key: string, value: string) => {
      secret = value;
    }),
  };
  const discovery = {
    issuer: AUTH_ORIGIN,
    authorization_endpoint: AUTH_ORIGIN + '/api/accounts/authorize',
    token_endpoint: AUTH_ORIGIN + '/api/accounts/oauth/token',
    jwks_uri: AUTH_ORIGIN + '/jwks',
    revocation_endpoint: AUTH_ORIGIN + '/revoke',
  };
  const tokens = () => ({
    access_token: 'test-access-' + ++config.tokenNumber,
    refresh_token: 'test-refresh-' + config.tokenNumber,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: config.scopes,
    id_token: jwt({
      iss: AUTH_ORIGIN,
      aud: config.id,
      sub: config.subject,
      email: config.email,
      exp: config.now / 1000 + 3600,
      nonce: auth?.searchParams.get('nonce'),
    }),
  });
  const json = vi.fn(async (url: string, options?: any): Promise<any> => {
    if (url.endsWith('openid-configuration')) return discovery;
    if (url.endsWith('/jwks')) return { keys: [jwk] };
    if (url.endsWith('/oauth/token')) return tokens();
    if (url.endsWith('/revoke')) return {};
    if (url === API_ORIGIN + '/models')
      return {
        models: [
          { slug: 'gpt-6-luna', display_name: 'GPT-6 Luna', visibility: 'list' },
          { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' },
        ],
      };
    throw new Error('Unexpected test URL');
  });
  const stream = vi.fn(async (_url: string, _options: any) => '{"answer":"test"}');
  const open = vi.fn((url: string) => {
    auth = new URL(url);
  });
  const close = vi.fn();
  const callback = vi.fn(async (_state: string, _signal: AbortSignal) => ({
    uri: 'http://127.0.0.1:1234/auth/callback',
    result: Promise.resolve({ code: 'test-code', clientId: config.id }),
    close,
  }));
  const deps = { http: { json, stream }, callback, now: () => config.now };
  const account = new ChatGPTAccount(store, 'context-cards-test', open, deps);
  return {
    account,
    store,
    json,
    stream,
    open,
    callback,
    close,
    config,
    discovery,
    tokens,
    deps,
    auth: () => auth,
    secret: () => secret,
    setSecret: (value: string | null) => {
      secret = value;
    },
  };
}
