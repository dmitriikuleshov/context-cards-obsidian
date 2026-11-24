import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('node:https', () => ({ request }));
import { cloudHTTP } from '../../src/chatgpt-network';

interface Script {
  status?: number;
  type?: string | null;
  chunks?: (string | Buffer)[];
  error?: Error;
  responseError?: boolean;
  wait?: boolean;
  closeEarly?: 'aborted' | 'close';
  closeWithoutResponse?: boolean;
}
function serve(script: Script = {}) {
  let sent: string | undefined;
  request.mockImplementation((_url, options, callback) => {
    const req: any = new EventEmitter();
    req.destroyed = false;
    req.destroy = (error?: Error) => {
      if (req.destroyed) return;
      req.destroyed = true;
      if (error) req.emit('error', error);
      req.emit('close');
    };
    const abort = () => req.destroy(Object.assign(new Error('secret'), { name: 'AbortError' }));
    options.signal?.addEventListener('abort', abort, { once: true });
    req.once('close', () => options.signal?.removeEventListener('abort', abort));
    req.end = (payload: string) => {
      sent = payload;
      queueMicrotask(() => {
        if (req.destroyed || script.wait) return;
        if (script.closeWithoutResponse) {
          req.emit('close');
          return;
        }
        if (script.error) {
          req.destroy(script.error);
          return;
        }
        const res: any = new EventEmitter();
        res.statusCode = script.status ?? 200;
        res.headers =
          script.type === null ? {} : { 'content-type': script.type ?? 'application/json' };
        callback(res);
        if (script.responseError) {
          res.emit('error', new Error('private server data'));
          req.emit('close');
          return;
        }
        for (const chunk of script.chunks ?? ['{}']) {
          if (req.destroyed) return;
          res.emit('data', Buffer.from(chunk));
        }
        if (!req.destroyed) {
          if (script.closeEarly) {
            res.emit(script.closeEarly);
            req.emit('close');
            return;
          }
          res.emit('end');
          res.emit('close');
          req.emit('close');
        }
      });
    };
    return req;
  });
  return () => sent;
}
afterEach(() => {
  vi.useRealTimers();
  request.mockReset();
});
describe('authenticated HTTPS transport', () => {
  it('rejects a request closed before receiving headers', async () => {
    serve({ closeWithoutResponse: true });
    await expect(cloudHTTP.json('https://api.openai.com/v1/models')).rejects.toThrow(/interrupted/);
  });
  it('rejects malformed addresses and sanitizes synchronous request setup failures', async () => {
    await expect(cloudHTTP.json('not a URL')).rejects.toThrow('Invalid ChatGPT service address.');
    expect(request).not.toHaveBeenCalled();
    request.mockImplementationOnce(() => {
      throw new Error('PRIVATE-TOKEN');
    });
    await expect(cloudHTTP.json('https://api.openai.com/v1/models')).rejects.toThrow(
      'Cannot connect to ChatGPT. Check your internet connection and try again.',
    );
  });
  it('never trusts a network error merely because its message starts with ChatGPT', async () => {
    serve({ error: new Error('ChatGPT PRIVATE-TOKEN') });
    await expect(cloudHTTP.json('https://api.openai.com/v1/models')).rejects.toThrow(
      'Cannot connect to ChatGPT. Check your internet connection and try again.',
    );
  });
  it('clears the total deadline after a completed response', async () => {
    vi.useFakeTimers();
    serve();
    await cloudHTTP.json('https://api.openai.com/v1/models');
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['aborted', 'close'] as const)(
    'rejects an early response %s without waiting for a timeout',
    async (closeEarly) => {
      serve({
        closeEarly,
        chunks: ['data: {"type":"response.output_text.delta","delta":"partial"}\n\n'],
      });
      const outcome = await Promise.race([
        cloudHTTP.stream('https://api.openai.com/v1/responses', {}).catch((error) => error.message),
        new Promise((resolve) => setTimeout(() => resolve('still pending'), 60)),
      ]);
      expect(outcome).toMatch(/interrupted/);
    },
  );
  it('sends exact JSON/form byte lengths with credentials only in headers or form bodies', async () => {
    const sent = serve({ chunks: ['{"ok":true}'] });
    expect(
      await cloudHTTP.json('https://api.openai.com/v1/models', { token: 'private-token' }),
    ).toEqual({ ok: true });
    expect(request.mock.calls[0]![1]).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer private-token' },
    });
    expect(sent()).toBeUndefined();
    await cloudHTTP.json('https://api.openai.com/v1/responses', { body: { word: 'café' } });
    expect(request.mock.calls[1]![1].headers['Content-Length']).toBe(Buffer.byteLength(sent()!));
    await cloudHTTP.json('https://auth.openai.com/token', {
      form: new URLSearchParams({ code: 'a+b' }),
    });
    expect(sent()).toBe('code=a%2Bb');
    expect(request.mock.calls[2]![1].headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
  });
  it.each([
    'http://api.openai.com/v1/models',
    'https://evil.test/',
    'https://user@api.openai.com/',
    'https://api.openai.com:8443/',
  ])('rejects credential-leaking destinations %s', async (url) => {
    await expect(cloudHTTP.json(url, { token: 'private' })).rejects.toThrow(/Invalid ChatGPT/);
    expect(request).not.toHaveBeenCalled();
  });
  it('handles SSE and requires the final completion event', async () => {
    serve({
      type: 'text/event-stream',
      chunks: [
        'data: {"type":"response.output_text.delta","delta":"answer"}\n\n',
        'data: {"type":"response.completed"}\n\n',
      ],
    });
    expect(await cloudHTTP.stream('https://api.openai.com/v1/responses', {})).toBe('answer');
    serve({
      type: 'text/event-stream',
      chunks: ['data: {"type":"response.output_text.delta","delta":"partial"}\n\n'],
    });
    await expect(cloudHTTP.stream('https://api.openai.com/v1/responses', {})).rejects.toThrow(
      /before.*completed/,
    );
  });
  it.each([null, 'application/json', 'text/plain', 'Text/Event-Stream; charset=utf-8'])(
    'reads successful SSE from its body when Content-Type is %s',
    async (type) => {
      serve({
        type,
        chunks: [
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"consciousness"}\n\n',
          'event: response.completed\ndata: {"type":"response.completed"}\n\n',
        ],
      });
      expect(await cloudHTTP.stream('https://api.openai.com/v1/responses', {})).toBe(
        'consciousness',
      );
    },
  );
  it.each(['data:', 'event: response.created\n', ': keepalive\n\n', 'id: 1\n', 'retry: 1000\n'])(
    'detects SSE across byte boundaries, starting with %s',
    async (prefix) => {
      const body = Buffer.from(
        '\uFEFF\r\n' +
          prefix +
          (prefix === 'data:' ? ' {"type":"response.created"}\n\n' : '') +
          'data: {"type":"response.output_text.delta","delta":"café"}\n\n' +
          'data: {"type":"response.completed"}\n\n',
      );
      serve({ type: null, chunks: Array.from(body, (byte) => Buffer.from([byte])) });
      expect(await cloudHTTP.stream('https://api.openai.com/v1/responses', {})).toBe('café');
    },
  );
  it('keeps streaming responses above the JSON body limit bounded by the SSE limit', async () => {
    serve({
      type: null,
      chunks: [
        ': ' + 'x'.repeat(1_000_000) + '\n\n',
        'data: {"type":"response.output_text.delta","delta":"answer"}\n\n',
        'data: {"type":"response.completed"}\n\n',
      ],
    });
    expect(await cloudHTTP.stream('https://api.openai.com/v1/responses', {})).toBe('answer');
    serve({ type: null, chunks: [': ' + 'x'.repeat(8_000_000)] });
    await expect(cloudHTTP.stream('https://api.openai.com/v1/responses', {})).rejects.toThrow(
      /too large/,
    );
  });
  it.each(['', 'da', '\n', '\n'.repeat(4097), '<html>PRIVATE</html>', '{"private":"body"}'])(
    'rejects empty, incomplete or non-SSE bodies safely (%j)',
    async (body) => {
      serve({ type: 'text/event-stream', chunks: [body] });
      await expect(cloudHTTP.stream('https://api.openai.com/v1/responses', {})).rejects.toThrow(
        'ChatGPT did not return the required response stream. Try again.',
      );
    },
  );
  it('does not mistake JSON error responses for successful streams', async () => {
    serve({
      status: 429,
      type: null,
      chunks: ['{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}'],
    });
    await expect(cloudHTTP.stream('https://api.openai.com/v1/responses', {})).rejects.toThrow(
      /plan usage limit reached/,
    );
    serve({
      type: null,
      chunks: ['data: {"type":"response.output_text.delta","delta":"partial"}\n\n'],
    });
    await expect(cloudHTTP.stream('https://api.openai.com/v1/responses', {})).rejects.toThrow(
      /before.*completed/,
    );
  });
  it('surfaces safe API errors and never follows redirects with bearer credentials', async () => {
    serve({
      status: 403,
      chunks: ['{"error":{"code":"subscription_sharing_user_not_eligible","message":"private"}}'],
    });
    await expect(cloudHTTP.json('https://api.openai.com/v1/models')).rejects.toThrow(
      /cannot share/,
    );
    serve({ status: 302, chunks: ['secret-url'] });
    await expect(cloudHTTP.json('https://api.openai.com/v1/models')).rejects.toThrow(/HTTP 302/);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('rejects bad JSON, wrong content type and oversized bodies', async () => {
    serve({ chunks: ['not JSON'] });
    await expect(cloudHTTP.json('https://api.openai.com/')).rejects.toThrow(/invalid JSON/);
    serve({ chunks: ['{}'] });
    await expect(cloudHTTP.stream('https://api.openai.com/', {})).rejects.toThrow(
      /required response stream/,
    );
    serve({ chunks: [Buffer.alloc(1000001)] });
    await expect(cloudHTTP.json('https://api.openai.com/')).rejects.toThrow(/oversized/);
    serve({ type: 'text/event-stream', chunks: ['data: bad\n\n'] });
    await expect(cloudHTTP.stream('https://api.openai.com/', {})).rejects.toThrow(
      /invalid response stream/,
    );
  });
  it('sanitizes network failures and interrupted responses', async () => {
    serve({ error: new Error('PRIVATE-TOKEN') });
    await expect(cloudHTTP.json('https://api.openai.com/')).rejects.toThrow(/Cannot connect/);
    serve({ responseError: true });
    await expect(cloudHTTP.json('https://api.openai.com/')).rejects.toThrow(/interrupted/);
  });
  it('cancels a waiting request and handles a pre-aborted signal without connecting', async () => {
    serve({ wait: true });
    const abort = new AbortController();
    const work = cloudHTTP.json('https://api.openai.com/', { signal: abort.signal });
    abort.abort();
    await expect(work).rejects.toThrow('Cancelled');
    await expect(
      cloudHTTP.json('https://api.openai.com/', { signal: abort.signal }),
    ).rejects.toThrow('Cancelled');
    expect(request).toHaveBeenCalledOnce();
  });
  it('uses a bounded request timeout', async () => {
    vi.useFakeTimers();
    serve({ wait: true });
    const work = cloudHTTP.json('https://api.openai.com/', { timeout: 100 });
    const assertion = expect(work).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});
