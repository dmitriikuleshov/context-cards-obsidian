import { afterEach, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WritingModel } from '../src/writing-model';
import { DEFAULTS } from '../src/types';
let server: Server;
afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((r) => server.close(() => r()));
});
async function serve(handler: (data: any) => unknown) {
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const value = handler(JSON.parse(raw));
    if (value !== undefined) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(value));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
it('repairs invalid analysis over HTTP and prepares both formats using the approved answer', async () => {
  let calls = 0;
  const source = 'I have wrote stories.';
  const url = await serve((data) => {
    calls++;
    if (calls === 1) return { message: { content: '{"findings":[{}]}' } };
    const fields = data.format.properties;
    if (fields.decisions) {
      const { candidates } = JSON.parse(data.messages[1].content);
      return {
        message: {
          content: JSON.stringify({
            decisions: candidates.map((c: any) => ({
              id: c.id,
              valid: true,
              explanation: 'Use the participle.',
              tip: '',
            })),
          }),
        },
      };
    }
    if (fields.findings)
      return {
        message: {
          content: JSON.stringify({
            summary: 'One issue.',
            findings: [
              {
                kind: 'grammar',
                title: 'Participle',
                original_sentence: source,
                target_before: 'wrote',
                target_after: 'written',
                corrected_sentence: 'I have written stories.',
                explanation: 'Use a participle.',
                tip: 'write → written',
                pattern: 'perfect',
                recommended_format: 'correction',
              },
            ],
          }),
        },
      };
    const result: any = { hint: 'Use write.', explanation: 'Use the participle.', tip: '' };
    for (const key of ['question', 'target', 'answer', 'corrected_sentence', 'explanation', 'tip'])
      result[key] = fields[key].enum[0];
    return { message: { content: JSON.stringify(result) } };
  });
  const model = new WritingModel({ ...DEFAULTS, ollamaUrl: url });
  const signal = new AbortController().signal;
  const result = await model.analyse(source, signal);
  expect(result.findings).toHaveLength(1);
  const f = result.findings[0]!;
  expect((await model.exercise(f, signal)).answer).toBe('written');
  f.format = 'gap';
  expect((await model.exercise(f, signal)).question).toContain('[[gap]]');
  expect(calls).toBe(5);
});
it('honours timeout and cancellation against an unresponsive model server', async () => {
  const url = await serve(() => undefined);
  await expect(
    new WritingModel({ ...DEFAULTS, ollamaUrl: url, timeoutSeconds: 0.05 }).analyse(
      'I go.',
      new AbortController().signal,
    ),
  ).rejects.toThrow('timed out');
  const controller = new AbortController();
  const job = new WritingModel({ ...DEFAULTS, ollamaUrl: url }).analyse('I go.', controller.signal);
  controller.abort();
  await expect(job).rejects.toThrow('Cancelled');
});
