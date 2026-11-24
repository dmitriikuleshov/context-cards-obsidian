import * as https from 'node:https';

export class ChatGPTError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ChatGPTError';
  }
}
export function cloudError(status: number, body?: unknown): ChatGPTError {
  const raw = body as { error?: { code?: string } | string } | undefined;
  const code = typeof raw?.error === 'string' ? raw.error : raw?.error?.code;
  const messages: Record<string, string> = {
    access_denied: 'ChatGPT sign-in was cancelled or permission was declined.',
    invalid_grant: 'Your ChatGPT session expired. Sign in again in Context Cards settings.',
    invalid_refresh_token: 'Your ChatGPT session expired. Sign in again in Context Cards settings.',
    refresh_token_expired: 'Your ChatGPT session expired. Sign in again in Context Cards settings.',
    refresh_token_reused:
      'Your ChatGPT session needs to be renewed. Sign in again in Context Cards settings.',
    token_expired: 'Your ChatGPT session expired. Sign in again in Context Cards settings.',
    refresh_token_invalidated:
      'Your ChatGPT session was disconnected. Sign in again in Context Cards settings.',
    subscription_sharing_user_not_eligible:
      'This ChatGPT account or workspace cannot share its plan with this plugin. Check your account permissions or choose Ollama.',
    subscription_sharing_usage_limit_exceeded:
      'ChatGPT plan usage limit reached. Check Settings → Usage in ChatGPT and wait for the limit shown there to reset.',
    subscription_sharing_usage_unavailable:
      'ChatGPT cannot check your remaining allowance right now. Try again later.',
    subscription_sharing_unsupported_capability:
      'This request or model is not supported by ChatGPT plan sharing. Refresh models in settings or choose another model.',
    subscription_sharing_route_not_supported:
      'ChatGPT plan sharing is unavailable for this request. Choose Ollama or try again later.',
    subscription_sharing_invalid_user:
      'ChatGPT could not validate this session. Sign in again in Context Cards settings.',
    subscription_sharing_user_unavailable:
      'ChatGPT account information is temporarily unavailable. Try again later.',
    chatpass_v2_scope_not_authorized:
      'Permission to use your ChatGPT plan was not granted. Reconnect in Context Cards settings.',
    chatpass_v2_invalid_authorization_context:
      'ChatGPT plan permission needs to be renewed. Reconnect in Context Cards settings.',
    model_not_found:
      'The selected ChatGPT model is unavailable. Refresh models and choose an available model.',
  };
  if (typeof code === 'string' && Object.hasOwn(messages, code))
    return new ChatGPTError(code, messages[code]!);
  return new ChatGPTError(
    `http_${status}`,
    status === 401
      ? 'ChatGPT did not accept this session. Reconnect in Context Cards settings.'
      : status === 403
        ? 'ChatGPT denied access for this account, workspace or serving region.'
        : status === 429
          ? 'ChatGPT is limiting requests. Check your plan usage and try again later.'
          : status >= 500
            ? 'ChatGPT is temporarily unavailable. Try again later.'
            : `ChatGPT rejected the request (HTTP ${status}). Refresh models or reconnect in settings.`,
  );
}

export interface CloudHTTP {
  json(url: string, options?: CloudOptions): Promise<any>;
  stream(url: string, options: CloudOptions): Promise<string>;
}
export interface CloudOptions {
  body?: unknown;
  form?: URLSearchParams;
  token?: string;
  signal?: AbortSignal;
  timeout?: number;
}

/** Incremental UTF-8 SSE decoder. Success requires the terminal completed event. */
export class ResponsesStream {
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private buffer = '';
  private output = '';
  private completed = false;
  private bytes = 0;
  feed(chunk: Uint8Array) {
    this.bytes += chunk.byteLength;
    if (this.bytes > 8_000_000)
      throw new Error('The ChatGPT response is too large. Select a shorter passage.');
    try {
      this.buffer += this.decoder.decode(chunk, { stream: true });
    } catch {
      throw new Error('ChatGPT returned an invalid response stream. Try again.');
    }
    this.parse();
  }
  private parse() {
    let split: RegExpExecArray | null;
    while ((split = /(?:\r\n|\r(?!\n)|\n)(?:\r\n|\r(?!\n)|\n)/.exec(this.buffer))) {
      const block = this.buffer.slice(0, split.index);
      this.buffer = this.buffer.slice(split.index + split[0].length);
      const data = block
        .split(/\r\n|\r|\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data || data === '[DONE]') continue;
      let event: any;
      try {
        event = JSON.parse(data);
        if (
          !event ||
          typeof event !== 'object' ||
          Array.isArray(event) ||
          typeof event.type !== 'string'
        )
          throw new Error();
      } catch {
        throw new Error('ChatGPT returned an invalid response stream. Try again.');
      }
      if (event.type === 'response.failed' || event.type === 'error')
        throw cloudError(400, { error: event.response?.error ?? event.error ?? event });
      if (event.type === 'response.incomplete')
        throw new Error('ChatGPT did not finish the response. Try a shorter passage.');
      if (event.type === 'response.refusal.delta' || event.type === 'response.refusal.done')
        throw new Error('ChatGPT declined this request. Your draft is unchanged.');
      if (this.completed) continue;
      if (event.type === 'response.output_text.delta') {
        if (typeof event.delta !== 'string')
          throw new Error('ChatGPT returned an invalid response stream. Try again.');
        this.output += event.delta;
      }
      if (event.type === 'response.completed') {
        if (
          event.response !== undefined &&
          (!event.response || typeof event.response !== 'object' || Array.isArray(event.response))
        )
          throw new Error('ChatGPT returned an invalid response stream. Try again.');
        if (event.response?.status && event.response.status !== 'completed')
          throw new Error('ChatGPT did not complete this request. Try again.');
        const output = event.response?.output;
        if (
          output !== undefined &&
          (!Array.isArray(output) ||
            output.some(
              (item: any) =>
                !item ||
                typeof item !== 'object' ||
                typeof item.type !== 'string' ||
                (item.type === 'message' &&
                  (!Array.isArray(item.content) ||
                    item.content.some(
                      (part: any) =>
                        !part ||
                        typeof part !== 'object' ||
                        typeof part.type !== 'string' ||
                        (part.type === 'output_text' && typeof part.text !== 'string'),
                    ))),
            ))
        )
          throw new Error('ChatGPT returned an invalid response stream. Try again.');
        const content = output?.flatMap((item: any) =>
          item.type === 'message' ? item.content : [],
        );
        if (content?.some((part: any) => part.type === 'refusal'))
          throw new Error('ChatGPT declined this request. Your draft is unchanged.');
        const text = content
          ?.filter((part: any) => part.type === 'output_text')
          .map((part: any) => part.text)
          .join('');
        if (text) this.output = text;
        this.completed = true;
      }
    }
  }
  finish() {
    try {
      this.buffer += this.decoder.decode();
    } catch {
      throw new Error('ChatGPT returned an invalid response stream. Try again.');
    }
    this.parse();
    if (!this.completed)
      throw new Error('The ChatGPT connection ended before the response completed. Try again.');
    if (!this.output.trim()) throw new Error('ChatGPT returned an empty response. Try again.');
    return this.output;
  }
}

function request(url: string, options: CloudOptions = {}, streaming = false): Promise<any> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return reject(new Error('Invalid ChatGPT service address.'));
    }
    if (
      target.protocol !== 'https:' ||
      !['auth.openai.com', 'api.openai.com'].includes(target.hostname) ||
      target.username ||
      target.password ||
      target.port
    )
      return reject(new Error('Invalid ChatGPT service address.'));
    if (options.signal?.aborted) return reject(new Error('Cancelled.'));
    const payload = options.form
      ? options.form.toString()
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body);
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (error?: unknown, value?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error !== undefined) reject(error);
      else resolve(value);
    };
    let req: ReturnType<typeof https.request>;
    try {
      req = https.request(
        target,
        {
          method: payload === undefined ? 'GET' : 'POST',
          signal: options.signal,
          headers: {
            Accept: streaming ? 'text/event-stream' : 'application/json',
            ...(payload !== undefined
              ? {
                  'Content-Type': options.form
                    ? 'application/x-www-form-urlencoded'
                    : 'application/json',
                  'Content-Length': Buffer.byteLength(payload),
                }
              : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          },
        },
        (res) => {
          let ended = false;
          const stream = new ResponsesStream();
          const chunks: Buffer[] = [];
          let streamPrefix = Buffer.alloc(0);
          let isSSE = false;
          let size = 0;
          const status = res.statusCode ?? 500;
          const ok = status >= 200 && status < 300;
          res.on('data', (chunk: Buffer) => {
            try {
              if (ok && streaming) {
                // Some ChatGPT responses omit Content-Type, or label SSE as JSON.
                // Inspect a bounded prefix; never parse an entire event stream as JSON.
                if (!isSSE) {
                  const prefix = Buffer.concat([
                    streamPrefix,
                    chunk.subarray(0, 4096 - streamPrefix.length),
                  ]);
                  const text = new TextDecoder().decode(prefix, { stream: true });
                  const firstLine = text.replace(/^[\r\n]*/, '');
                  const fields = ['data:', 'event:', 'id:', 'retry:', ':'];
                  if (fields.some((field) => firstLine.startsWith(field))) {
                    isSSE = true;
                    if (streamPrefix.length) stream.feed(streamPrefix);
                    streamPrefix = Buffer.alloc(0);
                  } else if (
                    prefix.length === 4096 ||
                    (firstLine && !fields.some((field) => field.startsWith(firstLine)))
                  ) {
                    throw new Error(
                      'ChatGPT did not return the required response stream. Try again.',
                    );
                  } else {
                    streamPrefix = prefix;
                    return;
                  }
                }
                stream.feed(chunk);
              } else {
                size += chunk.length;
                if (size > 1_000_000) throw new Error('ChatGPT returned an oversized response.');
                chunks.push(chunk);
              }
            } catch (error) {
              settle(error);
              req.destroy();
            }
          });
          const interrupted = () => {
            settle(new Error('The ChatGPT connection was interrupted. Try again.'));
            req.destroy();
          };
          res.on('error', interrupted);
          res.on('aborted', interrupted);
          res.on('close', () => {
            if (!ended) interrupted();
          });
          res.on('end', () => {
            ended = true;
            try {
              if (ok && streaming) {
                if (!isSSE)
                  throw new Error(
                    'ChatGPT did not return the required response stream. Try again.',
                  );
                settle(undefined, stream.finish());
                return;
              }
              const raw = Buffer.concat(chunks).toString('utf8');
              let data: any;
              if (raw) {
                try {
                  data = JSON.parse(raw);
                } catch {
                  if (ok) throw new Error('ChatGPT returned invalid JSON. Try again.');
                }
              }
              if (!ok) throw cloudError(status, data);
              settle(undefined, data ?? {});
            } catch (error) {
              settle(error);
            }
          });
        },
      );
    } catch {
      settle(new Error('Cannot connect to ChatGPT. Check your internet connection and try again.'));
      return;
    }
    timer = setTimeout(() => {
      settle(new Error('ChatGPT timed out. Increase Request timeout or select a shorter passage.'));
      req.destroy();
    }, options.timeout ?? 30000);
    req.on('close', () => settle(new Error('The ChatGPT connection was interrupted. Try again.')));
    req.on('error', (error) =>
      settle(
        error.name === 'AbortError'
          ? new Error('Cancelled.')
          : new Error('Cannot connect to ChatGPT. Check your internet connection and try again.'),
      ),
    );
    req.end(payload);
  });
}
export const cloudHTTP: CloudHTTP = {
  json: (url, options) => request(url, options),
  stream: (url, options) => request(url, options, true),
};
