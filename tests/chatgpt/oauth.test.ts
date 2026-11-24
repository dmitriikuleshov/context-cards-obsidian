import { describe, expect, it, vi } from 'vitest';
import { request } from 'node:http';
import {
  AUTH_ORIGIN,
  loginCallback,
  oauthSecrets,
  responseBody,
  verifyIdentity,
} from '../../src/chatgpt-oauth';
import { jwk, jwt } from './fixtures';

describe('ChatGPT identity verification', () => {
  const now = 1795500000000;
  const claims = {
    iss: AUTH_ORIGIN,
    aud: 'client',
    sub: 'user',
    exp: now / 1000 + 100,
    nonce: 'nonce',
    email: 'reader@example.test',
  };
  it('checks a real signature, issuer, audience, expiry and nonce', () => {
    expect(verifyIdentity(jwt(claims), { keys: [jwk] }, 'client', 'nonce', now)).toEqual({
      subject: 'user',
      email: claims.email,
    });
  });
  it.each([
    { iss: 'https://evil.test' },
    { aud: 'other-client' },
    { exp: now / 1000 },
    { nonce: 'other' },
    { sub: '' },
    { iat: now / 1000 + 120 },
    { aud: ['client', 'other'] },
  ])('rejects a signed token with invalid claims %#', (change) => {
    expect(() =>
      verifyIdentity(jwt({ ...claims, ...change }), { keys: [jwk] }, 'client', 'nonce', now),
    ).toThrow(/verify/);
  });
  it('rejects forged/unsigned tokens and unknown keys without exposing them', () => {
    const token = jwt(claims);
    expect(() =>
      verifyIdentity(token.slice(0, -20) + 'x'.repeat(20), { keys: [jwk] }, 'client', 'nonce', now),
    ).toThrow(/verify/);
    expect(() =>
      verifyIdentity(
        jwt(claims, { alg: 'none', kid: 'test-key' }),
        { keys: [jwk] },
        'client',
        'nonce',
        now,
      ),
    ).toThrow(/verify/);
    expect(() => verifyIdentity(token, { keys: [] }, 'client', 'nonce', now)).toThrow(/verify/);
    expect(() => verifyIdentity('broken', { keys: [jwk] }, 'client', 'nonce', now)).toThrow(
      /invalid/,
    );
  });
  it('accepts a verified multi-audience token only with matching authorized party', () => {
    expect(
      verifyIdentity(
        jwt({ ...claims, aud: ['client', 'other'], azp: 'client', email: undefined }),
        { keys: [jwk] },
        'client',
        'nonce',
        now,
      ).email,
    ).toBe('ChatGPT account');
  });
  it('generates fresh state, nonce and a valid PKCE challenge', () => {
    const a = oauthSecrets(),
      b = oauthSecrets();
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.verifier).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    expect(a.challenge).toHaveLength(43);
  });
});
describe('loopback browser callback', () => {
  it('settles cancellation during listener startup and accepts another attempt', async () => {
    const controller = new AbortController();
    const pending = loginCallback('state', controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    const retry = await loginCallback('state', new AbortController().signal);
    retry.close();
  });
  it('rejects malformed request targets and foreign hosts without consuming the pending login', async () => {
    const cb = await loginCallback('expected', new AbortController().signal);
    const url = new URL(cb.uri);
    const get = (path: string, host = url.host) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          { hostname: url.hostname, port: url.port, path, headers: { host } },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode!));
          },
        );
        req.on('error', reject);
        req.end();
      });
    try {
      for (const path of [
        'http://[',
        'http://evil.test/auth/callback?state=expected&code=x',
        '//evil.test/auth/callback?state=expected&code=x',
      ])
        expect(await get(path)).toBe(400);
      expect(await get('/auth/callback?state=expected&code=x', 'evil.test')).toBe(400);
      expect((await fetch(cb.uri + '?state=expected&code=real-test-code')).status).toBe(200);
      expect(await cb.result).toEqual({ code: 'real-test-code', clientId: undefined });
    } finally {
      cb.close();
    }
  });
  it('expires a forgotten browser login and releases its listener', async () => {
    vi.useFakeTimers();
    try {
      const cb = await loginCallback('state', new AbortController().signal);
      const assertion = expect(cb.result).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(300000);
      await assertion;
      cb.close();
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects wrong states, paths, methods and duplicate parameters before accepting a real callback', async () => {
    const abort = new AbortController();
    const callback = await loginCallback('expected', abort.signal);
    try {
      expect(new URL(callback.uri).hostname).toBe('127.0.0.1');
      expect((await fetch(callback.uri.replace('/auth/callback', '/wrong'))).status).toBe(404);
      expect((await fetch(callback.uri, { method: 'POST' })).status).toBe(404);
      for (const q of [
        'state=wrong&code=secret',
        'state=éééééééé&code=secret',
        'state=expected&state=expected&code=x',
        'state=expected&code=x&code=y',
      ])
        expect((await fetch(callback.uri + '?' + q)).status).toBe(400);
      const accepted = await fetch(callback.uri + '?state=expected&code=code&client_id=client');
      expect(accepted.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(accepted.headers.get('cache-control')).toBe('no-store');
      expect(accepted.headers.get('referrer-policy')).toBe('no-referrer');
      expect(accepted.headers.get('content-security-policy')).toContain("default-src 'none'");
      const html = await accepted.text();
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('Authorization received');
      expect(html).toContain('Return to Obsidian');
      expect(html).not.toContain('code&');
      expect(html).not.toContain('Connected successfully');
      expect(await callback.result).toEqual({ code: 'code', clientId: 'client' });
      expect((await fetch(callback.uri + '?state=expected&code=again')).status).toBe(409);
    } finally {
      callback.close();
    }
  });
  it('handles browser denial and cancellation and closes the listener', async () => {
    const abort = new AbortController();
    const cb = await loginCallback('expected', abort.signal);
    const denied = await fetch(
      cb.uri + '?state=expected&error=access_denied&error_description=private',
    );
    const html = await denied.text();
    expect(html).toContain('Sign-in not completed');
    expect(html).not.toContain('private');
    await expect(cb.result).rejects.toThrow(/declined/);
    cb.close();
    const cb2 = await loginCallback('expected', abort.signal);
    abort.abort();
    await expect(cb2.result).rejects.toThrow(/cancelled/);
    cb2.close();
    await expect(loginCallback('x', abort.signal)).rejects.toThrow(/cancelled/);
  });
});
describe('subscription request mapping', () => {
  it('preserves schema and messages while excluding unsupported Ollama/API fields', () => {
    const schema = { type: 'object', properties: { word: { type: 'string' } } };
    const body = responseBody(
      'gpt-6-luna',
      [
        { role: 'system', content: 'first' },
        { role: 'system', content: 'second' },
        { role: 'user', content: 'data' },
      ],
      schema,
    );
    expect(body).toMatchObject({
      model: 'gpt-6-luna',
      store: false,
      stream: true,
      instructions: 'first\n\nsecond',
      input: [{ role: 'user', content: 'data' }],
      text: { format: { strict: true, schema } },
      reasoning: { effort: 'none' },
    });
    for (const key of [
      'temperature',
      'top_p',
      'max_output_tokens',
      'previous_response_id',
      'think',
      'options',
      'keep_alive',
    ])
      expect(body).not.toHaveProperty(key);
    expect(responseBody('gpt-6.2-sol', [], {}).reasoning).toEqual({ effort: 'low' });
    expect(responseBody('gpt-4.1', [], {})).not.toHaveProperty('reasoning');
  });
});
