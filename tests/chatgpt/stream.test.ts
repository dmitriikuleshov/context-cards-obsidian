import { describe, expect, it } from 'vitest';
import { ResponsesStream, cloudError } from '../../src/chatgpt-network';
const event = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n';
function finish(events: unknown[]) {
  const stream = new ResponsesStream();
  stream.feed(Buffer.from(events.map(event).join('')));
  return stream.finish();
}
describe('ChatGPT streamed Responses', () => {
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'treats inherited error code %s as an unknown provider error',
    (code) => {
      const error = cloudError(503, { error: { code, message: 'private' } });
      expect(error.code).toBe('http_503');
      expect(error.message).toContain('temporarily unavailable');
    },
  );
  it.each([
    null,
    [],
    true,
    { type: null },
    { type: 'response.output_text.delta', delta: {} },
    { type: 'response.output_text.delta', delta: 42 },
    { type: 'response.completed', response: null },
    { type: 'response.completed', response: [] },
    { type: 'response.completed', response: { output: {} } },
    { type: 'response.completed', response: { output: [null] } },
    { type: 'response.completed', response: { output: [{ type: 'message', content: {} }] } },
    { type: 'response.completed', response: { output: [{ type: 'message', content: [null] }] } },
    {
      type: 'response.completed',
      response: { output: [{ type: 'message', content: [{ type: 'output_text', text: {} }] }] },
    },
  ])('rejects malformed streamed event %# with a safe protocol error', (bad) => {
    expect(() =>
      finish([
        { type: 'response.output_text.delta', delta: '{}' },
        bad,
        { type: 'response.completed' },
      ]),
    ).toThrow(/invalid response stream/);
  });
  it('does not silently replace invalid UTF-8 bytes in model output', () => {
    const stream = new ResponsesStream();
    expect(() => {
      stream.feed(
        Buffer.concat([
          Buffer.from('data: {"type":"response.output_text.delta","delta":"'),
          Buffer.from([0xff]),
          Buffer.from('"}\n\n'),
        ]),
      );
      stream.finish();
    }).toThrow(/invalid response stream/);
  });
  it('rejects an unfinished UTF-8 sequence at end of stream', () => {
    const stream = new ResponsesStream();
    stream.feed(Buffer.from([0xe2]));
    expect(() => stream.finish()).toThrow(/invalid response stream/);
  });
  it('accepts CR-only SSE line endings even when CRLF is split between chunks', () => {
    const stream = new ResponsesStream();
    for (const byte of Buffer.from(
      event({ type: 'response.output_text.delta', delta: 'ok' }).replaceAll('\n', '\r') +
        event({ type: 'response.completed' }).replaceAll('\n', '\r\n'),
    ))
      stream.feed(Buffer.from([byte]));
    expect(stream.finish()).toBe('ok');
  });
  it('handles UTF-8 split at every byte and returns only completed text', () => {
    const stream = new ResponsesStream();
    const bytes = Buffer.from(
      ': comment\n\n' +
        event({ type: 'response.output_text.delta', delta: '{"word":"café"}' }) +
        event({ type: 'response.completed', response: { status: 'completed' } }) +
        'data: [DONE]\n\n',
    );
    for (const b of bytes) stream.feed(Buffer.from([b]));
    expect(stream.finish()).toBe('{"word":"café"}');
  });
  it('uses terminal content when available and ignores reasoning content', () => {
    expect(
      finish([
        { type: 'response.reasoning_text.delta', delta: 'private thought' },
        { type: 'response.output_text.delta', delta: 'draft' },
        {
          type: 'response.completed',
          response: {
            output: [
              { type: 'reasoning', content: [{ text: 'private' }] },
              { type: 'message', content: [{ type: 'output_text', text: '{"answer":1}' }] },
            ],
          },
        },
      ]),
    ).toBe('{"answer":1}');
  });
  it('supports CRLF and ignores later text after completed', () => {
    const s = new ResponsesStream();
    s.feed(
      Buffer.from(
        (
          event({
            type: 'response.completed',
            response: {
              output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
            },
          }) + event({ type: 'response.output_text.delta', delta: 'ignored' })
        ).replaceAll('\n', '\r\n'),
      ),
    );
    expect(s.finish()).toBe('ok');
  });
  it('rejects a disconnected or empty response instead of accepting partial feedback', () => {
    expect(() => finish([{ type: 'response.output_text.delta', delta: '{"incomplete":' }])).toThrow(
      /before.*completed/,
    );
    expect(() =>
      finish([{ type: 'response.completed', response: { status: 'completed' } }]),
    ).toThrow(/empty/);
    expect(() =>
      finish([{ type: 'response.completed', response: { status: 'incomplete' } }]),
    ).toThrow(/not complete/);
  });
  it.each(['response.refusal.delta', 'response.refusal.done', 'response.incomplete'])(
    'handles %s explicitly',
    (type) => {
      expect(() => finish([{ type }])).toThrow(/declined|finish/);
    },
  );
  it('handles refusals on the completed response and usage errors after streaming begins', () => {
    expect(() =>
      finish([
        {
          type: 'response.completed',
          response: {
            output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private' }] }],
          },
        },
      ]),
    ).toThrow(/declined/);
    expect(() =>
      finish([
        { type: 'response.output_text.delta', delta: 'partial' },
        {
          type: 'response.failed',
          response: {
            error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'private' },
          },
        },
      ]),
    ).toThrow(/usage limit/);
    expect(() =>
      finish([{ type: 'error', code: 'subscription_sharing_user_not_eligible' }]),
    ).toThrow(/cannot share/);
  });
  it('rejects malformed and oversized streams', () => {
    const a = new ResponsesStream();
    expect(() => a.feed(Buffer.from('data: bad JSON\n\n'))).toThrow(/invalid/);
    const b = new ResponsesStream();
    expect(() => b.feed(Buffer.alloc(8000001))).toThrow(/too large/);
  });
  it.each([401, 403, 429, 503, 400])('sanitizes unknown HTTP %i errors', (status) => {
    const result = cloudError(status, {
      error: { message: 'secret-token', code: 'unknown-token' },
    });
    expect(result.message).not.toContain('secret-token');
    expect(result.message).not.toContain('unknown-token');
    expect(result.code).toBe('http_' + status);
  });
  it.each([
    'invalid_grant',
    'invalid_refresh_token',
    'refresh_token_expired',
    'refresh_token_reused',
    'token_expired',
    'refresh_token_invalidated',
    'subscription_sharing_user_not_eligible',
    'subscription_sharing_usage_limit_exceeded',
    'subscription_sharing_usage_unavailable',
    'subscription_sharing_unsupported_capability',
    'subscription_sharing_route_not_supported',
    'subscription_sharing_invalid_user',
    'subscription_sharing_user_unavailable',
    'chatpass_v2_scope_not_authorized',
    'chatpass_v2_invalid_authorization_context',
    'model_not_found',
    'access_denied',
  ])('provides a safe actionable message for %s', (code) => {
    const result = cloudError(400, { error: { code, message: 'DO NOT EXPOSE' } });
    expect(result.code).toBe(code);
    expect(result.message).not.toContain('DO NOT EXPOSE');
  });
});
