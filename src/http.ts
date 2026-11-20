import * as http from 'node:http';
import * as https from 'node:https';

export function endpoint(value: string): string {
  const url = new URL(value.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Use an HTTP server address without credentials, query parameters or a fragment.',
    );
  return url.toString().replace(/\/$/, '');
}
export function jsonRequest<T>(
  url: string,
  data?: unknown,
  signal?: AbortSignal,
  timeout = 60000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error('Invalid server address.'));
      return;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      reject(new Error('HTTP or HTTPS is required.'));
      return;
    }
    const payload = data === undefined ? undefined : JSON.stringify(data);
    const request = (parsed.protocol === 'https:' ? https : http).request(
      parsed,
      {
        method: payload === undefined ? 'GET' : 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2_000_000) {
            request.destroy(new Error('The server response is too large.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (!response.statusCode || response.statusCode >= 400) {
            let detail = text.slice(0, 300);
            try {
              detail = JSON.parse(text).error || detail;
            } catch {
              /* keep plain error */
            }
            reject(new Error(`Server returned ${response.statusCode}: ${detail}`));
            return;
          }
          try {
            resolve(JSON.parse(text) as T);
          } catch {
            reject(new Error('The server returned invalid JSON.'));
          }
        });
      },
    );
    const timer = setTimeout(
      () =>
        request.destroy(
          new Error(`The request timed out after ${Math.round(timeout / 1000)} seconds.`),
        ),
      timeout,
    );
    request.on('close', () => clearTimeout(timer));
    request.on('error', (error) => {
      if (error.name === 'AbortError') reject(new Error('Cancelled.'));
      else if ('code' in error && error.code === 'ECONNREFUSED')
        reject(
          new Error(`Cannot connect to ${parsed.host}. Start the local server and try again.`),
        );
      else reject(error);
    });
    request.end(payload);
  });
}
