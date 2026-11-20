import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { endpoint, jsonRequest } from '../src/http';
let server: Server;
async function serve(handler: RequestListener) {
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((r) => server.close(() => r()));
});
describe('local JSON transport', () => {
  it('cancels an in-flight generation', async () => {
    const url = await serve((_req, _res) => {}),
      controller = new AbortController();
    const request = jsonRequest(url, {}, controller.signal);
    controller.abort();
    await expect(request).rejects.toThrow('Cancelled');
  });
  it('enforces a deadline even if the server never responds', async () => {
    const url = await serve((_req, _res) => {});
    await expect(jsonRequest(url, {}, undefined, 30)).rejects.toThrow('timed out');
  });
  it('reports malformed model JSON and server error messages', async () => {
    const url = await serve((req, res) => {
      if (req.url === '/error') {
        res.statusCode = 404;
        res.end('{"error":"model not found"}');
      } else res.end('broken');
    });
    await expect(jsonRequest(url)).rejects.toThrow('invalid JSON');
    await expect(jsonRequest(`${url}/error`)).rejects.toThrow('model not found');
  });
  it('rejects credentials and non-HTTP endpoints', () => {
    expect(() => endpoint('file:///tmp/file')).toThrow();
    expect(() => endpoint('http://user:secret@localhost')).toThrow();
    expect(endpoint(' http://localhost:11434/ ')).toBe('http://localhost:11434');
  });
});
