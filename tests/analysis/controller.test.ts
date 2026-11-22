import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { WritingModel } from '../../src/writing-model';
import { WritingAnki } from '../../src/writing-anki';
import { writingReviewMarkdown } from '../../src/writing-controller';
import { controllerFixture } from './controller-fixture';
import { SOURCE, card, deferred, finding, session } from './fixtures';
afterEach(() => vi.restoreAllMocks());
describe('starting and cancelling writing analysis', () => {
  it.each(['', ' \n ', 'x'.repeat(6001)])(
    'refuses invalid selected text before opening the panel (%#)',
    async (selected) => {
      const { controller, host, s } = controllerFixture();
      await controller.start({ ...s.capture, selected });
      expect(controller.sessions).toHaveLength(1);
      expect(host.openWritingPanel).not.toHaveBeenCalled();
    },
  );
  it('restores snapshots and opens an existing selection without overwriting its edits or launching analysis', async () => {
    const { controller, host, s, show } = controllerFixture();
    controller.restore([s]);
    const saved = controller.sessions[0]!;
    saved.findings[0]!.selected = false;
    const analyse = vi.spyOn(controller, 'analyse').mockResolvedValue();
    await controller.start({ ...s.capture });
    expect(show).toHaveBeenCalledWith(saved);
    expect(analyse).not.toHaveBeenCalled();
    expect(saved.findings[0]!.selected).toBe(false);
    expect(host.persist).not.toHaveBeenCalled();
  });
  it('clones a new source snapshot, opens it, and starts exactly one analysis', async () => {
    const { controller, host, s, show } = controllerFixture();
    const analyse = vi.spyOn(controller, 'analyse').mockResolvedValue();
    const capture = { ...s.capture, selected: 'New writing.', text: 'New writing.' };
    await controller.start(capture);
    const next = controller.sessions.at(-1)!;
    capture.selected = 'Changed later';
    expect(next.capture.selected).toBe('New writing.');
    expect(next.deck).toBe(host.settings.writingDeck);
    expect(next.phase).toBe('idle');
    expect(next.analysed).toBe(false);
    expect(show).toHaveBeenCalledWith(next);
    expect(analyse).toHaveBeenCalledTimes(1);
    expect(host.persist).toHaveBeenCalled();
  });
  it('does not revive a cleared selection if the panel finishes opening late', async () => {
    const { controller, host, s, show } = controllerFixture();
    const panel = deferred<any>();
    host.openWritingPanel.mockReturnValue(panel.promise);
    const analyse = vi.spyOn(controller, 'analyse').mockResolvedValue();
    const opening = controller.start({ ...s.capture, selected: 'New writing.' });
    await controller.clear();
    panel.resolve({ show });
    await opening;
    expect(show).not.toHaveBeenCalled();
    expect(analyse).not.toHaveBeenCalled();
    expect(controller.sessions).toEqual([]);
  });
  it('stops new work and rejects a late analysis response after unloading', async () => {
    const { controller, s, host } = controllerFixture();
    const work = deferred<any>();
    vi.spyOn(WritingModel.prototype, 'analyse').mockReturnValue(work.promise);
    const running = controller.analyse(s);
    controller.stop();
    work.resolve({ summary: 'Late', findings: [] });
    await running;
    expect(s.findings).toHaveLength(1);
    expect(s.phase).toBe('idle');
    await controller.start({ ...s.capture, selected: 'Next' });
    expect(host.openWritingPanel).not.toHaveBeenCalled();
    await controller.analyse(s);
    await controller.generate(s);
    await controller.export(s);
  });
  it('does not analyse a new draft after unloading while its panel is opening', async () => {
    const { controller, host, s, show } = controllerFixture();
    const panel = deferred<any>();
    host.openWritingPanel.mockReturnValue(panel.promise);
    const analyse = vi.spyOn(controller, 'analyse');
    const running = controller.start({ ...s.capture, selected: 'Next' });
    controller.stop();
    panel.resolve({ show });
    await running;
    expect(analyse).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });
  it('aborts an evicted analysis and prevents its response from replacing the new draft', async () => {
    const { controller, s, host } = controllerFixture();
    const old = deferred<any>();
    let oldSignal: AbortSignal | undefined;
    vi.spyOn(WritingModel.prototype, 'analyse').mockImplementation((text, signal) => {
      if (text === SOURCE) {
        oldSignal = signal;
        return old.promise;
      }
      return Promise.resolve({ summary: 'New', findings: [] });
    });
    controller.sessions.push(...['two', 'three', 'four'].map((id) => session({ id })));
    const running = controller.analyse(s);
    await controller.start({ ...s.capture, selected: 'New paragraph.' });
    expect(oldSignal!.aborted).toBe(true);
    old.resolve({ summary: 'Old late result', findings: [] });
    await running;
    expect(controller.sessions).not.toContain(s);
    expect(controller.sessions).toHaveLength(4);
    expect(s.summary).toBe('One correction.');
    expect(host.persist).toHaveBeenCalled();
  });
  it('preserves exported feedback and refuses a recheck without contacting the model', async () => {
    const { controller, s, f } = controllerFixture();
    f.noteId = 42;
    const analyse = vi.spyOn(WritingModel.prototype, 'analyse');
    await controller.analyse(s);
    expect(analyse).not.toHaveBeenCalled();
    expect(s.error).toContain('already has exported');
    expect(f.noteId).toBe(42);
  });
  it('releases the busy state on arbitrary thrown values and leaves previous results intact', async () => {
    const { controller, s, host } = controllerFixture();
    vi.spyOn(WritingModel.prototype, 'analyse').mockRejectedValue('Failure as text');
    await controller.analyse(s);
    expect(s.error).toBe('Failure as text');
    expect(s.phase).toBe('idle');
    expect(s.findings).toHaveLength(1);
    expect(host.refreshWriting).toHaveBeenCalledTimes(2);
  });
  it('does not turn a model error into a new message after explicit cancellation', async () => {
    const { controller, s } = controllerFixture();
    const work = deferred<any>();
    vi.spyOn(WritingModel.prototype, 'analyse').mockReturnValue(work.promise);
    const running = controller.analyse(s);
    controller.cancel(s);
    work.reject(new Error('late failure'));
    await running;
    expect(s.error).toContain('Cancelled');
    expect(s.error).not.toContain('late failure');
    const error = s.error;
    controller.cancel(s);
    expect(s.error).toBe(error);
  });
  it('keeps the cleared list empty even if persistence fails', async () => {
    const { controller, host } = controllerFixture();
    host.flush.mockRejectedValueOnce(new Error('Disk full'));
    await controller.clear();
    expect(controller.sessions).toEqual([]);
    expect(host.flush).toHaveBeenCalledTimes(1);
  });
});
describe('preparing selected exercises', () => {
  it('does not generate unselected, optional, spelling-only, dismissed or exported findings', async () => {
    const { controller, s } = controllerFixture();
    s.findings = [
      finding({ selected: false }),
      finding({ id: 'style', kind: 'style' }),
      finding({ id: 'typo', kind: 'typo' }),
      finding({ id: 'rejected', dismissed: true }),
      finding({ id: 'exported', noteId: 42 }),
    ];
    const exercise = vi.spyOn(WritingModel.prototype, 'exercise');
    await controller.generate(s);
    expect(exercise).not.toHaveBeenCalled();
    expect(s.error).toContain('Select at least one');
  });
  it('rebuilds an invalid draft while retaining a valid manually edited card', async () => {
    const { controller, s, f } = controllerFixture();
    f.card = card({ answer: 'wrong' });
    const edited = card({ tip: 'My own edited tip.' });
    const next = finding({ id: 'next', card: edited });
    s.findings.push(next);
    const exercise = vi.spyOn(WritingModel.prototype, 'exercise').mockResolvedValue(card());
    await controller.generate(s);
    expect(exercise).toHaveBeenCalledTimes(1);
    expect(f.card!.answer).toBe('written');
    expect(next.card).toBe(edited);
  });
  it.each(['Cannot connect to Ollama', 'The request timed out', 'Server returned 503: offline'])(
    'stops the batch after a transport failure: %s',
    async (error) => {
      const { controller, s } = controllerFixture();
      s.findings.push(finding({ id: 'next' }));
      const exercise = vi
        .spyOn(WritingModel.prototype, 'exercise')
        .mockRejectedValue(new Error(error));
      await controller.generate(s);
      expect(exercise).toHaveBeenCalledTimes(1);
      expect(s.error).toContain('Ready cards were kept');
      expect(s.findings.every((f) => !f.card)).toBe(true);
    },
  );
  it('continues after a validation error so a later usable card is not lost', async () => {
    const { controller, s } = controllerFixture();
    s.findings.push(finding({ id: 'next' }));
    vi.spyOn(WritingModel.prototype, 'exercise')
      .mockRejectedValueOnce('Invalid model answer')
      .mockResolvedValueOnce(card());
    await controller.generate(s);
    expect(s.findings[0]!.card).toBeUndefined();
    expect(s.findings[1]!.card).toEqual(card());
    expect(s.error).toContain('Invalid model answer');
  });
  it('discards late cards and errors after unloading during generation', async () => {
    const { controller, s, f } = controllerFixture();
    const work = deferred<any>();
    vi.spyOn(WritingModel.prototype, 'exercise').mockReturnValue(work.promise);
    const running = controller.generate(s);
    controller.stop();
    work.reject(new Error('late failure'));
    await running;
    expect(f.card).toBeUndefined();
    expect(s.error).toBe('');
    expect(s.phase).toBe('idle');
  });
  it('invalidates an edited unexported card but locks an already exported one', () => {
    const { controller, host, f } = controllerFixture();
    f.card = card();
    controller.editFinding(f);
    expect(f.card).toBeUndefined();
    expect(host.persist).toHaveBeenCalledTimes(1);
    f.card = card();
    f.noteId = 42;
    controller.editFinding(f);
    expect(f.card).toEqual(card());
    expect(host.persist).toHaveBeenCalledTimes(1);
  });
});
describe('saving analysis and export recovery', () => {
  it.each([
    '',
    '/outside',
    'C:/outside',
    '../outside',
    './Reviews',
    '.obsidian/reviews',
    'Reviews/../outside',
  ])('rejects a non-vault review folder: %s', async (folder) => {
    const { controller, s, host, files } = controllerFixture();
    host.settings.writingReviewFolder = folder;
    await controller.save(s);
    expect(s.error).toContain('vault-relative');
    expect(files.size).toBe(0);
  });
  it.each([
    '/outside.md',
    'C:/outside.md',
    '../outside.md',
    '.obsidian/test.md',
    'Reviews/not-markdown.txt',
  ])('rejects an invalid saved review path: %s', async (reviewPath) => {
    const { controller, s, files } = controllerFixture();
    s.reviewPath = reviewPath;
    await controller.save(s);
    expect(s.error).toContain('Markdown file inside the vault');
    expect(files.size).toBe(0);
  });
  it('never overwrites the source file or a folder at the target path', async () => {
    const { controller, s, files } = controllerFixture();
    s.reviewPath = s.capture.file;
    await controller.save(s);
    expect(s.error).toContain('cannot overwrite');
    s.reviewPath = 'Reviews/folder.md';
    files.set(s.reviewPath, { file: { path: s.reviewPath }, text: 'Folder' });
    await controller.save(s);
    expect(s.error).toContain('not a file');
    expect(files.get(s.reviewPath)!.text).toBe('Folder');
  });
  it('recovers from a folder creation race but reports a genuine folder failure', async () => {
    const { controller, s, host, files } = controllerFixture();
    host.settings.writingReviewFolder = 'Reviews';
    host.app.vault.createFolder.mockImplementationOnce(async (path: string) => {
      files.set(path, { file: { path }, text: '' });
      throw new Error('Already created');
    });
    await controller.save(s);
    expect(s.error).toBe('');
    const next = session({ id: 'next' });
    controller.sessions.push(next);
    host.settings.writingReviewFolder = 'Failed';
    host.app.vault.createFolder.mockRejectedValueOnce(new Error('Cannot create folder'));
    await controller.save(next);
    expect(next.error).toBe('Cannot create folder');
  });
  it('keeps successfully exported note IDs if saving their review fails and skips those notes on retry', async () => {
    const { controller, s, f, host } = controllerFixture();
    f.card = card();
    const add = vi
      .spyOn(WritingAnki.prototype, 'add')
      .mockResolvedValue({ noteId: 42, existing: true });
    host.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Disk full'));
    await controller.export(s);
    expect(f.noteId).toBe(42);
    expect(f.reused).toBe(true);
    expect(s.error).toBe('Disk full');
    await controller.export(s);
    expect(add).toHaveBeenCalledTimes(1);
  });
  it('validates the destination deck and prepared-card selection before any writes or Anki calls', async () => {
    const { controller, s, f, files } = controllerFixture();
    const add = vi.spyOn(WritingAnki.prototype, 'add');
    await controller.export(s);
    expect(s.error).toContain('Generate and review');
    f.card = card();
    s.deck = ' ';
    await controller.export(s);
    expect(s.error).toBe('Choose a writing deck.');
    expect(add).not.toHaveBeenCalled();
    expect(files.size).toBe(0);
  });
  it('recovers the file queue after one save fails and serializes writes for separate sessions', async () => {
    const { controller, s, host, files } = controllerFixture();
    const next = session({ id: 'next' });
    controller.sessions.push(next);
    host.app.vault.create.mockRejectedValueOnce(new Error('Disk temporarily unavailable'));
    await controller.save(s);
    expect(s.error).toContain('temporarily');
    await controller.save(next);
    expect(next.error).toBe('');
    expect(files.has(next.reviewPath!)).toBe(true);
    const firstWrite = deferred<void>();
    let active = 0,
      max = 0;
    host.app.vault.process.mockImplementation(
      async (file: any, transform: (text: string) => string) => {
        active++;
        max = Math.max(max, active);
        if (file.path === next.reviewPath) await firstWrite.promise;
        files.get(file.path)!.text = transform(files.get(file.path)!.text);
        active--;
      },
    );
    const a = controller.save(next),
      b = controller.save(s);
    firstWrite.resolve();
    await Promise.all([a, b]);
    expect(max).toBe(1);
  });
  it('keeps the managed review id and human notes while representing all feedback states', () => {
    const s = session({
      findings: [
        finding({ dismissed: true }),
        finding({ id: 'unclear', kind: 'unclear' }),
        finding({ id: 'bad', before: 'not present' }),
        finding({ id: 'ready', card: card(), noteId: 42, reused: true }),
      ],
    });
    const text = writingReviewMarkdown(s);
    expect(text).toContain('context-cards-writing:session-1');
    expect(text).toContain('Dismissed suggestion');
    expect(text).toContain('Clarification needed');
    expect(text).toContain('Correction needs review.');
    expect(text).toContain('Anki note 42 (existing)');
    expect(text).toContain('**Exercise**');
  });
  it('preserves appended notes when the source itself contains a literal managed-end marker', async () => {
    const { controller, s, files } = controllerFixture();
    s.capture.selected = SOURCE + '\n<!-- end-context-cards-writing -->\nA quoted marker.';
    await controller.save(s);
    const note = '\nMy own notes after the review.\n';
    files.get(s.reviewPath!)!.text += note;
    await controller.save(s);
    expect(s.error).toBe('');
    expect(files.get(s.reviewPath!)!.text).toBe(writingReviewMarkdown(s) + note);
  });
  it.each(['\n', '\r\n'])(
    'preserves a tail containing another marker and never accumulates blank lines (%j)',
    async (newline) => {
      const { controller, s, files } = controllerFixture();
      s.findings[0]!.explanation =
        'Quoted fence:\n```text\n<!-- end-context-cards-writing -->\n```';
      await controller.save(s);
      const note = 'Personal notes' + newline + '<!-- end-context-cards-writing -->' + newline;
      files.get(s.reviewPath!)!.text =
        files.get(s.reviewPath!)!.text.replaceAll('\n', newline) + note;
      for (let i = 0; i < 3; i++) {
        await controller.save(s);
        expect(s.error).toBe('');
        expect(files.get(s.reviewPath!)!.text).toBe(writingReviewMarkdown(s) + note);
      }
    },
  );
  it('does not overwrite personal text if an owned review has lost its end marker', async () => {
    const { controller, s, files } = controllerFixture();
    await controller.save(s);
    const saved = files.get(s.reviewPath!)!;
    saved.text = saved.text.replace('<!-- end-context-cards-writing -->', '') + 'Personal notes';
    const before = saved.text;
    await controller.save(s);
    expect(s.error).toContain('end marker is missing');
    expect(saved.text).toBe(before);
  });
});
