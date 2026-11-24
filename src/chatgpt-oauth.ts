import { createServer } from 'node:http';
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { callbackPage } from './chatgpt-callback-page';

export const AUTH_ORIGIN = 'https://auth.openai.com';
export const API_ORIGIN = 'https://api.openai.com/v1';
export const OAUTH_SCOPES =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export function oauthSecrets() {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
  };
}
export interface CallbackResult {
  code: string;
  clientId?: string;
}
export interface LoginCallback {
  uri: string;
  result: Promise<CallbackResult>;
  close(): void;
}
export async function loginCallback(state: string, signal: AbortSignal): Promise<LoginCallback> {
  if (signal.aborted) throw new Error('ChatGPT sign-in cancelled.');
  let resolve!: (value: CallbackResult) => void, reject!: (error: Error) => void;
  const result = new Promise<CallbackResult>((a, b) => {
    resolve = a;
    reject = b;
  });
  // The browser launcher can fail before the caller starts awaiting the callback.
  void result.catch(() => {});
  let finished = false;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    const address = server.address();
    const host = address && typeof address !== 'string' ? `127.0.0.1:${address.port}` : '';
    let url: URL;
    try {
      if (!host || req.headers.host !== host || !req.url?.startsWith('/')) throw new Error();
      url = new URL(req.url, `http://${host}`);
      if (url.origin !== `http://${host}`) throw new Error();
    } catch {
      res.writeHead(400).end(callbackPage('invalid'));
      return;
    }
    if (req.method !== 'GET' || url.pathname !== '/auth/callback') {
      res.writeHead(404).end(callbackPage('not-found'));
      return;
    }
    const received = url.searchParams.getAll('state');
    const receivedState = Buffer.from(received[0] ?? '');
    const expectedState = Buffer.from(state);
    if (
      received.length !== 1 ||
      receivedState.length !== expectedState.length ||
      !timingSafeEqual(receivedState, expectedState)
    ) {
      res.writeHead(400).end(callbackPage('invalid'));
      return;
    }
    if (finished) {
      res.writeHead(409).end(callbackPage('already-received'));
      return;
    }
    const code = url.searchParams.getAll('code'),
      clients = url.searchParams.getAll('client_id');
    if (url.searchParams.has('error')) {
      finished = true;
      res.end(callbackPage('declined'));
      reject(new Error('ChatGPT sign-in was cancelled or permission was declined.'));
      return;
    }
    if (
      code.length !== 1 ||
      !code[0] ||
      code[0].length > 10000 ||
      clients.length > 1 ||
      (clients[0]?.length ?? 0) > 1000
    ) {
      res.writeHead(400).end(callbackPage('invalid'));
      return;
    }
    finished = true;
    res.end(callbackPage('received'));
    resolve({ code: code[0], clientId: clients[0] });
  });
  server.maxConnections = 16;
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 1000;
  const close = () => {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    server.close();
    server.closeAllConnections();
  };
  const abort = () => {
    finished = true;
    reject(new Error('ChatGPT sign-in cancelled.'));
    close();
  };
  const timer = setTimeout(() => {
    finished = true;
    reject(new Error('ChatGPT sign-in timed out. Click Continue with ChatGPT to try again.'));
    close();
  }, 300000);
  signal.addEventListener('abort', abort, { once: true });
  try {
    await new Promise<void>((done, fail) => {
      const cleanup = () => {
        server.removeListener('error', failed);
        signal.removeEventListener('abort', cancelled);
      };
      const failed = () => {
        cleanup();
        fail(new Error('Could not open the local sign-in callback.'));
      };
      const cancelled = () => {
        cleanup();
        fail(new Error('ChatGPT sign-in cancelled.'));
      };
      server.once('error', failed);
      signal.addEventListener('abort', cancelled, { once: true });
      server.listen(0, '127.0.0.1', () => {
        cleanup();
        done();
      });
    });
    if (signal.aborted) {
      abort();
      throw new Error('ChatGPT sign-in cancelled.');
    }
    server.on('error', () => {
      reject(new Error('Could not receive the ChatGPT sign-in response. Try again.'));
      close();
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Could not open the local sign-in callback.');
    return { uri: `http://127.0.0.1:${address.port}/auth/callback`, result, close };
  } catch (error) {
    close();
    throw error;
  }
}

export function verifyIdentity(
  token: string,
  keys: { keys?: unknown[] },
  clientId: string,
  nonce?: string,
  now = Date.now(),
) {
  if (typeof token !== 'string') throw new Error('ChatGPT returned an invalid identity token.');
  const parts = token.split('.');
  if (parts.length !== 3 || token.length > 30000)
    throw new Error('ChatGPT returned an invalid identity token.');
  try {
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    if (!['RS256', 'ES256'].includes(header.alg) || typeof header.kid !== 'string')
      throw new Error();
    const key: any = keys.keys?.find(
      (key: any) =>
        key.kid === header.kid &&
        (!key.use || key.use === 'sig') &&
        (!key.alg || key.alg === header.alg),
    );
    if (!key || (header.alg === 'RS256' ? key.kty !== 'RSA' : key.kty !== 'EC')) throw new Error();
    const publicKey = createPublicKey({ key, format: 'jwk' });
    if (
      !verify(
        'sha256',
        Buffer.from(`${parts[0]}.${parts[1]}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(parts[2]!, 'base64url'),
      )
    )
      throw new Error();
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      claims.iss !== AUTH_ORIGIN ||
      !audiences.includes(clientId) ||
      (audiences.length > 1 && claims.azp !== clientId) ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= now / 1000 ||
      (claims.iat !== undefined &&
        (typeof claims.iat !== 'number' || claims.iat > now / 1000 + 60)) ||
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      (nonce !== undefined && claims.nonce !== nonce)
    )
      throw new Error();
    return {
      subject: claims.sub as string,
      email: typeof claims.email === 'string' ? claims.email.slice(0, 254) : 'ChatGPT account',
    };
  } catch {
    throw new Error('Could not verify the ChatGPT sign-in identity. Sign in again.');
  }
}

export function responseBody(
  model: string,
  messages: { role: string; content: string }[],
  schema: object,
) {
  const instructions = messages
    .filter((m) => m.role === 'system' || m.role === 'developer')
    .map((m) => m.content)
    .join('\n\n');
  return {
    model,
    instructions,
    input: messages
      .filter((m) => m.role !== 'system' && m.role !== 'developer')
      .map((m) => ({ role: m.role, content: m.content })),
    store: false,
    stream: true,
    text: { format: { type: 'json_schema', name: 'context_cards', strict: true, schema } },
    ...(/^(gpt-[5-9]|o[134])/.test(model)
      ? {
          reasoning: {
            effort: /^gpt-6(?:\.\d+)?-(?:luna|terra)(?:-|$)/.test(model) ? 'none' : 'low',
          },
        }
      : {}),
  };
}
