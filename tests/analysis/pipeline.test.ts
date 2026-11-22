import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { writingPracticeFields } from '../../src/writing';
import { WritingAnki } from '../../src/writing-anki';
import { controllerFixture } from './controller-fixture';
import { SOURCE, analysisJSON, deferred, finding } from './fixtures';
const servers: Server[] = [];
async function ollama(handler: (body: any, res: ServerResponse) => void) {
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    handler(JSON.parse(raw), res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
function respond(res: ServerResponse, value: unknown) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ message: { content: JSON.stringify(value) } }));
}
function approved(body: any) {
  const input = JSON.parse(body.messages[1].content);
  return {
    decisions: input.candidates.map((c: any) => ({
      id: c.id,
      valid: true,
      original_acceptable: false,
      explanation: 'Independently verified participle rule.',
      tip: 'Use written.',
    })),
  };
}
function exercise(body: any) {
  const props = body.format.properties;
  return Object.fromEntries(
    ['question', 'target', 'answer', 'corrected_sentence', 'explanation', 'tip']
      .map((k) => [k, props[k].enum[0]])
      .concat([['hint', 'Use the correct form of write.']]),
  );
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});
describe('controller → HTTP → validation → editable exercise', () => {
  it('repairs malformed model output, independently verifies it and prepares both formats without exporting', async () => {
    const { controller, host, s, files } = controllerFixture();
    let proposals = 0,
      calls = 0;
    host.settings.ollamaUrl = await ollama((body, res) => {
      calls++;
      if (body.format.properties.findings) {
        proposals++;
        if (proposals === 1) respond(res, { summary: 'Broken', findings: [null] });
        else respond(res, JSON.parse(analysisJSON()));
      } else if (body.format.properties.decisions) respond(res, approved(body));
      else respond(res, exercise(body));
    });
    const add = vi
      .spyOn(WritingAnki.prototype, 'add')
      .mockRejectedValue(new Error('Must not export during analysis'));
    await controller.analyse(s);
    expect(s.error).toBe('');
    expect(s.findings).toHaveLength(1);
    expect(s.findings[0]!.explanation).toBe('Independently verified participle rule.');
    await controller.generate(s);
    expect(s.error).toBe('');
    expect(s.findings[0]!.card!.corrected).toBe('I have written three stories.');
    expect(writingPracticeFields(s.findings[0]!).Question).toContain('<mark>wrote</mark>');
    s.findings[0]!.format = 'gap';
    controller.editFinding(s.findings[0]!);
    await controller.generate(s);
    expect(writingPracticeFields(s.findings[0]!).Typed).toBe('yes');
    expect(s.findings[0]!.card!.question).toBe('I have [[gap]] three stories.');
    expect(calls).toBe(5);
    expect(files.size).toBe(0);
    expect(add).not.toHaveBeenCalled();
    expect(host.persist).toHaveBeenCalled();
  });
  it('uses one settings snapshot for the whole batch when settings change during an HTTP request', async () => {
    const { controller, host, s } = controllerFixture();
    const started = deferred<void>(),
      release = deferred<void>();
    const models: string[] = [];
    host.settings.model = 'original-model';
    s.findings.push(
      finding({ id: 'second', original: 'Yesterday I go home.', before: 'go', after: 'went' }),
    );
    host.settings.ollamaUrl = await ollama((body, res) => {
      models.push(body.model);
      if (models.length === 1) {
        started.resolve();
        void release.promise.then(() => respond(res, exercise(body)));
      } else respond(res, exercise(body));
    });
    const running = controller.generate(s);
    await started.promise;
    host.settings.model = 'changed-later';
    release.resolve();
    await running;
    expect(models).toEqual(['original-model', 'original-model']);
    expect(s.error).toBe('');
    expect(s.findings.every((f) => !!f.card)).toBe(true);
  });
  it('cancels during verification and keeps the previous analysis despite a late server response', async () => {
    const { controller, host, s } = controllerFixture();
    const started = deferred<{ body: any; res: ServerResponse }>();
    const previous = structuredClone(s.findings);
    host.settings.ollamaUrl = await ollama((body, res) => {
      if (body.format.properties.findings) respond(res, JSON.parse(analysisJSON()));
      else started.resolve({ body, res });
    });
    const running = controller.analyse(s);
    const { body, res } = await started.promise;
    controller.cancel(s);
    await running;
    respond(res, approved(body));
    expect(s.phase).toBe('idle');
    expect(s.error).toContain('Cancelled');
    expect(s.findings).toEqual(previous);
    expect(s.capture.selected).toBe(SOURCE);
  });
});
