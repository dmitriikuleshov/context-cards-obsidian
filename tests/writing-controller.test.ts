import { WritingModel } from '../src/writing-model';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { WritingController, writingReviewMarkdown } from '../src/writing-controller';
import { WritingAnki } from '../src/writing-anki';
import { parseWritingAnalysis, type WritingSession } from '../src/writing';
import { DEFAULTS } from '../src/types';
const original = 'I have wrote three stories.';
function setup() {
  const files = new Map<string, { file: any; text: string }>();
  const host: any = {
    settings: structuredClone(DEFAULTS),
    persist: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    refreshWriting: vi.fn(),
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => files.get(path)?.file,
        createFolder: async (path: string) => {
          files.set(path, { file: { path }, text: '' });
        },
        create: async (path: string, text: string) => {
          const file = Object.assign(new TFile(), { path });
          files.set(path, { file, text });
          return file;
        },
        process: async (file: any, fn: (s: string) => string) => {
          const saved = files.get(file.path)!;
          saved.text = fn(saved.text);
        },
      },
    },
  };
  const manager = new WritingController(host);
  const f = parseWritingAnalysis(
    JSON.stringify({
      summary: 'One issue.',
      findings: [
        {
          kind: 'grammar',
          title: 'Participle',
          original_sentence: original,
          target_before: 'wrote',
          target_after: 'written',
          explanation: 'Use a participle.',
          tip: '',
          pattern: 'perfect',
          recommended_format: 'correction',
        },
      ],
    }),
    original,
  ).findings[0]!;
  const session: WritingSession = {
    id: 'abc12345-test',
    created: '2026-11-22T12:00:00Z',
    capture: {
      text: original,
      selected: original,
      start: 0,
      end: original.length,
      file: 'Story.md',
      book: 'Story',
      vault: 'Test',
      mode: 'editor',
    },
    findings: [f],
    summary: 'One issue.',
    phase: 'idle',
    analysed: true,
    error: '',
    deck: 'English::Writing mistakes',
  };
  manager.sessions = [session];
  return { host, manager, session, f, files };
}
afterEach(() => vi.restoreAllMocks());
describe('writing review lifecycle', () => {
  it('clears all drafts, aborts model jobs and rejects late responses without deleting saved reviews', async () => {
    const { manager, session, f, host, files } = setup();
    await manager.save(session);
    const saved = [...files.entries()].map(([path, item]) => [path, item.text]);
    const second = structuredClone(session);
    second.id = 'second';
    second.findings[0]!.selected = true;
    manager.sessions.push(second);
    let analyse!: (v: any) => void, generate!: (v: any) => void;
    vi.spyOn(WritingModel.prototype, 'analyse').mockImplementation(
      () => new Promise((r) => (analyse = r)),
    );
    vi.spyOn(WritingModel.prototype, 'exercise').mockImplementation(
      () => new Promise((r) => (generate = r)),
    );
    const jobs = [manager.analyse(session), manager.generate(second)];
    await manager.clear();
    expect(manager.sessions).toEqual([]);
    expect(host.flush).toHaveBeenCalled();
    analyse({ summary: 'Late response', findings: [] });
    generate({ question: 'Late card' });
    await Promise.all(jobs);
    expect(manager.sessions).toEqual([]);
    expect(session.findings).toContain(f);
    expect(second.findings[0]!.card).toBeUndefined();
    expect([...files.entries()].map(([path, item]) => [path, item.text])).toEqual(saved);
  });
  it('does not clear drafts during a save/export and ignores stale session requests after clearing', async () => {
    const { manager, session } = setup();
    for (const phase of ['saving', 'exporting'] as const) {
      session.phase = phase;
      await manager.clear();
      expect(manager.sessions).toEqual([session]);
    }
    session.phase = 'idle';
    await manager.clear();
    const analyse = vi.spyOn(WritingModel.prototype, 'analyse');
    await manager.analyse(session);
    expect(analyse).not.toHaveBeenCalled();
  });
  it('validates every card before writing files or exporting the first note', async () => {
    const { manager, session, f, files } = setup();
    f.selected = true;
    f.card = {
      kind: 'correction',
      question: original,
      target: 'wrote',
      answer: 'written',
      corrected: 'I have written three stories.',
      explanation: 'Use a participle.',
      hint: '',
      tip: '',
    };
    const second = structuredClone(f);
    second.id = 'invalid';
    second.card!.answer = 'wrong';
    session.findings.push(second);
    const add = vi.spyOn(WritingAnki.prototype, 'add');
    await manager.export(session);
    expect(add).not.toHaveBeenCalled();
    expect(files.size).toBe(0);
    expect(session.error).toContain('approved correction');
  });
  it('cancels generation and rejects a late successful response', async () => {
    const { manager, session, f } = setup();
    f.selected = true;
    let resolve!: (v: any) => void;
    vi.spyOn(WritingModel.prototype, 'exercise').mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
    const job = manager.generate(session);
    manager.cancel(session);
    resolve({ question: 'late' });
    await job;
    expect(f.card).toBeUndefined();
    expect(session.phase).toBe('idle');
    expect(session.error).toContain('Cancelled');
  });
  it('does not start two overlapping batch exports', async () => {
    const { manager, session, f } = setup();
    f.selected = true;
    f.card = {
      kind: 'correction',
      question: original,
      target: 'wrote',
      answer: 'written',
      corrected: 'I have written three stories.',
      explanation: 'Use a participle.',
      hint: '',
      tip: '',
    };
    const add = vi
      .spyOn(WritingAnki.prototype, 'add')
      .mockResolvedValue({ noteId: 5, existing: false });
    await Promise.all([manager.export(session), manager.export(session)]);
    expect(add).toHaveBeenCalledTimes(1);
  });
  it('keeps prepared cards after a generation failure and retries only missing drafts', async () => {
    const { manager, session, f } = setup();
    f.selected = true;
    const second = { ...structuredClone(f), id: 'second' };
    session.findings.push(second);
    const card = {
      kind: 'correction' as const,
      question: original,
      target: 'wrote',
      answer: 'written',
      corrected: 'I have written three stories.',
      explanation: 'Use a participle.',
      hint: '',
      tip: '',
    };
    const exercise = vi
      .spyOn(WritingModel.prototype, 'exercise')
      .mockResolvedValueOnce(card)
      .mockRejectedValueOnce(new Error('Invalid writing explanation'))
      .mockResolvedValueOnce({ ...card, tip: 'Retried' });
    await manager.generate(session);
    expect(f.card).toBe(card);
    expect(session.error).toContain('Ready cards were kept');
    expect(second.card).toBeUndefined();
    await manager.generate(session);
    expect(exercise).toHaveBeenCalledTimes(3);
    expect(f.card).toBe(card);
    expect(second.card?.tip).toBe('Retried');
    expect(session.error).toBe('');
  });
  it('saves a separate review without modifying the source', async () => {
    const { manager, session, files } = setup();
    await manager.save(session);
    expect(session.error).toBe('');
    expect(session.reviewPath).toContain('English/Writing reviews/');
    const text = files.get(session.reviewPath!)!.text;
    expect(text).toContain(original);
    expect(text).toContain('I have written three stories.');
    expect(files.has('Story.md')).toBe(false);
  });
  it('exports one reviewed card and never repeats a successfully exported finding', async () => {
    const { manager, session, f } = setup();
    f.selected = true;
    f.card = {
      kind: 'correction',
      question: original,
      target: 'wrote',
      answer: 'written',
      corrected: 'I have written three stories.',
      explanation: 'Use a participle.',
      hint: '',
      tip: '',
    };
    const add = vi
      .spyOn(WritingAnki.prototype, 'add')
      .mockResolvedValue({ noteId: 77, existing: false });
    await manager.export(session);
    await manager.export(session);
    expect(add).toHaveBeenCalledTimes(1);
    expect(f.noteId).toBe(77);
  });
  it('preserves successful cards if a later export fails and retries only the remaining one', async () => {
    const { manager, session, f } = setup();
    f.selected = true;
    f.card = {
      kind: 'correction',
      question: original,
      target: 'wrote',
      answer: 'written',
      corrected: 'I have written three stories.',
      explanation: 'Use a participle.',
      hint: '',
      tip: '',
    };
    const second = { ...structuredClone(f), id: 'second' };
    session.findings.push(second);
    const add = vi
      .spyOn(WritingAnki.prototype, 'add')
      .mockResolvedValueOnce({ noteId: 10, existing: false })
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce({ noteId: 11, existing: false });
    await manager.export(session);
    expect(f.noteId).toBe(10);
    expect(second.noteId).toBeUndefined();
    await manager.export(session);
    expect(add).toHaveBeenCalledTimes(3);
    expect(second.noteId).toBe(11);
  });
  it('does not accept an analysis response after cancellation', async () => {
    const { manager, session } = setup();
    let resolve!: (v: any) => void;
    vi.spyOn(WritingModel.prototype, 'analyse').mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const work = manager.analyse(session);
    manager.cancel(session);
    resolve({ summary: 'Should not replace', findings: [] });
    await work;
    expect(session.findings).toHaveLength(1);
    expect(session.phase).toBe('idle');
  });
  it('refuses a review destination outside the vault and protects unowned files', async () => {
    const { host, manager, session, files } = setup();
    host.settings.writingReviewFolder = '../outside';
    await manager.save(session);
    expect(session.error).toContain('vault-relative');
    host.settings.writingReviewFolder = 'Reviews';
    session.reviewPath = 'Reviews/existing.md';
    files.set(session.reviewPath, {
      file: Object.assign(new TFile(), { path: session.reviewPath }),
      text: 'My own note',
    });
    await manager.save(session);
    expect(session.error).toContain('not owned');
    expect(files.get(session.reviewPath)!.text).toBe('My own note');
  });
  it('preserves user notes appended after the managed review', async () => {
    const { manager, session, files } = setup();
    await manager.save(session);
    files.get(session.reviewPath!)!.text += '\nMy own follow-up notes.\n';
    await manager.save(session);
    expect(files.get(session.reviewPath!)!.text).toContain('My own follow-up notes.');
  });
  it('puts selected text inside a fence it cannot break out of', () => {
    const { session } = setup();
    session.capture.selected = '```\n<script>bad()</script>';
    const text = writingReviewMarkdown(session);
    expect(text).toContain('````text');
  });
});
