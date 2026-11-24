import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Replace only the socket destination. Exercise real IncomingMessage lifecycle
// events on loopback, without contacting OpenAI or disabling TLS verification.
const route = vi.hoisted(() => ({ origin: '' }));
vi.mock('node:https', async () => {
  const http = await import('node:http');
  return {
    request: (url: URL, options: object, callback: Parameters<typeof http.request>[2]) => {
      if (!route.origin) throw new Error('No test server');
      return http.request(new URL(url.pathname, route.origin), options, callback);
    },
  };
});
import { cloudHTTP } from '../../src/chatgpt-network';

const servers: Server[] = [];
const endpoint = 'https://api.openai.com/v1/responses';
const event = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n';
async function serve(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  route.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return server;
}
async function connections(server: Server) {
  return new Promise<number>((resolve, reject) =>
    server.getConnections((error, count) => (error ? reject(error) : resolve(count))),
  );
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  route.origin = '';
});

describe('ChatGPT transport with real loopback sockets', () => {
  it('reassembles a streamed response without Content-Type and preserves UTF-8', async () => {
    await serve(async (req, res) => {
      expect(req.headers.authorization).toBe('Bearer synthetic-test-token');
      for await (const _chunk of req) {
        /* drain request */
      }
      const body = Buffer.from(
        event({ type: 'response.output_text.delta', delta: 'café' }) +
          event({ type: 'response.completed' }),
      );
      const split = body.indexOf(Buffer.from('é')) + 1;
      res.write(body.subarray(0, split));
      await new Promise((resolve) => setImmediate(resolve));
      res.end(body.subarray(split));
    });
    expect(
      await cloudHTTP.stream(endpoint, { token: 'synthetic-test-token', body: { input: [] } }),
    ).toBe('café');
  });
  it('rejects a server disconnect after partial text instead of accepting it', async () => {
    const server = await serve((_req, res) => {
      res.write(event({ type: 'response.output_text.delta', delta: 'partial' }));
      setImmediate(() => res.destroy());
    });
    await expect(cloudHTTP.stream(endpoint, {})).rejects.toThrow(/interrupted/);
    await vi.waitFor(async () => expect(await connections(server)).toBe(0));
  });
  it('aborts a real hanging response and releases its socket', async () => {
    const controller = new AbortController();
    const server = await serve((_req, res) => {
      res.write(': waiting\n\n');
      setImmediate(() => controller.abort());
    });
    await expect(cloudHTTP.stream(endpoint, { signal: controller.signal })).rejects.toThrow(
      /Cancelled/,
    );
    await vi.waitFor(async () => expect(await connections(server)).toBe(0));
  });
  it('times out a nonterminating stream and releases its socket', async () => {
    const server = await serve((_req, res) => res.write(': waiting\n\n'));
    await expect(cloudHTTP.stream(endpoint, { timeout: 50 })).rejects.toThrow(/timed out/);
    await vi.waitFor(async () => expect(await connections(server)).toBe(0));
  });
  it('does not follow redirects or expose private server error text', async () => {
    let requests = 0;
    await serve((_req, res) => {
      requests++;
      res.writeHead(302, { location: route.origin + '/untrusted' }).end('PRIVATE details');
    });
    await expect(cloudHTTP.stream(endpoint, { token: 'synthetic-test-token' })).rejects.toThrow(
      'ChatGPT rejected the request (HTTP 302). Refresh models or reconnect in settings.',
    );
    expect(requests).toBe(1);
  });
  it('rejects oversized JSON over a real connection', async () => {
    const server = await serve((_req, res) => res.end('x'.repeat(1_000_001)));
    await expect(cloudHTTP.json('https://api.openai.com/v1/models')).rejects.toThrow(/oversized/);
    await vi.waitFor(async () => expect(await connections(server)).toBe(0));
  });
});
