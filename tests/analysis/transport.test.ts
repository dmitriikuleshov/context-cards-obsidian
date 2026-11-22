import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { endpoint, jsonRequest } from '../../src/http';
import { deferred } from './fixtures';
const servers: Server[] = [];
async function serve(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
describe('model transport contracts', () => {
  it.each([
    'not an address',
    'ftp://localhost',
    'file:///etc/passwd',
    'http://user@localhost',
    'http://user:pass@localhost',
    'http://localhost/?token=x',
    'http://localhost/#fragment',
  ])('rejects unsupported or ambiguous endpoints: %s', (value) =>
    expect(() => endpoint(value)).toThrow(),
  );
  it('preserves HTTPS and proxy base paths while normalizing surrounding whitespace', () => {
    expect(endpoint(' https://localhost:8443/ollama/ ')).toBe('https://localhost:8443/ollama');
  });
  it.each(['invalid address', 'file:///tmp/test'])(
    'rejects an invalid request URL without starting network work: %s',
    async (url) => {
      await expect(jsonRequest(url)).rejects.toThrow(/Invalid server address|HTTP or HTTPS/);
    },
  );
  it('uses GET without a payload and POST with exact UTF-8 JSON byte length', async () => {
    const seen: Array<{ method: string | undefined; length: string | undefined; body: string }> =
      [];
    const { url } = await serve(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      seen.push({
        method: req.method,
        length: req.headers['content-length'],
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.end('{"ok":true}');
    });
    expect(await jsonRequest(url)).toEqual({ ok: true });
    const payload = { text: 'café 🙂 русский', value: 0 };
    expect(await jsonRequest(url, payload)).toEqual({ ok: true });
    expect(seen[0]).toEqual({ method: 'GET', length: undefined, body: '' });
    expect(seen[1]).toEqual({
      method: 'POST',
      length: String(Buffer.byteLength(JSON.stringify(payload))),
      body: JSON.stringify(payload),
    });
  });
  it('reassembles chunked JSON including a split Unicode character', async () => {
    const value = { text: '🙂 café' };
    const bytes = Buffer.from(JSON.stringify(value));
    const { url } = await serve((_req, res) => {
      res.write(bytes.subarray(0, 10));
      res.end(bytes.subarray(10));
    });
    expect(await jsonRequest(url)).toEqual(value);
  });
  it.each([
    ['upstream unavailable', 'upstream unavailable'],
    ['{}', '{}'],
    ['', ''],
    ['{"error":"missing model"}', 'missing model'],
  ])('preserves server status and useful error details for %s', async (body, detail) => {
    const { url } = await serve((_req, res) => {
      res.statusCode = 503;
      res.end(body);
    });
    await expect(jsonRequest(url)).rejects.toThrow(`Server returned 503: ${detail}`);
  });
  it('rejects oversized model responses instead of buffering an unbounded body', async () => {
    const { url } = await serve((_req, res) =>
      res.end(JSON.stringify({ text: 'x'.repeat(2_000_001) })),
    );
    await expect(jsonRequest(url)).rejects.toThrow('response is too large');
  });
  it('reports connection refusal with an actionable message', async () => {
    const { server, url } = await serve((_req, res) => res.end('{}'));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(jsonRequest(url)).rejects.toThrow(/Cannot connect.*Start the local server/);
  });
  it('does not downgrade HTTPS when the server is not speaking TLS', async () => {
    const { url } = await serve((_req, res) => res.end('{}'));
    await expect(
      jsonRequest(url.replace('http:', 'https:'), undefined, undefined, 1000),
    ).rejects.toMatchObject({ code: 'EPROTO' });
  });
  it('cancels a request after the server has begun handling it', async () => {
    const handling = deferred<void>();
    const { url } = await serve((_req, _res) => handling.resolve());
    const abort = new AbortController();
    const result = jsonRequest(url, { text: 'hello' }, abort.signal);
    await handling.promise;
    abort.abort();
    await expect(result).rejects.toThrow('Cancelled');
  });
  it('rejects an already cancelled request before the server receives a payload', async () => {
    let calls = 0;
    const { url } = await serve((_req, res) => {
      calls++;
      res.end('{}');
    });
    const abort = new AbortController();
    abort.abort();
    await expect(jsonRequest(url, {}, abort.signal)).rejects.toThrow('Cancelled');
    expect(calls).toBe(0);
  });
  it('enforces the total deadline even while response chunks keep arriving', async () => {
    let chunks = 0;
    const { url } = await serve((_req, res) => {
      res.write('{');
      chunks++;
      const timer = setInterval(() => {
        res.write(' ');
        chunks++;
      }, 5);
      res.on('close', () => clearInterval(timer));
    });
    await expect(jsonRequest(url, {}, undefined, 60)).rejects.toThrow('timed out');
    expect(chunks).toBeGreaterThan(1);
  });
  it('reports an interrupted response rather than hanging until the deadline', async () => {
    const { url } = await serve((_req, res) => {
      res.write('{"value":');
      setImmediate(() => res.destroy());
    });
    await expect(jsonRequest(url, undefined, undefined, 1000)).rejects.toThrow(
      /aborted|socket hang up|reset/i,
    );
  });
});
