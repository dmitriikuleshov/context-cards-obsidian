import { WritingModel } from './writing-model';
import { Notice, normalizePath, TFile } from 'obsidian';
import type ContextCardsPlugin from './main';
import type { Capture } from './types';
import { cleanDeck, sourceUri } from './text';
import {
  canPractise,
  correctedSentence,
  writingPracticeFields,
  restoreWritingSessions,
  type WritingSession,
  type WritingFinding,
} from './writing';
import { WritingAnki } from './writing-anki';

const escapeMd = (text: string) => text.replace(/[\\`*_[\]<>#!]/g, '\\$&');
const code = (text: string) => {
  const fence = '`'.repeat(
    Math.max(3, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length + 1)),
  );
  return `${fence}text\n${text}\n${fence}`;
};
function reviewTail(text: string): string {
  let fence: string | undefined,
    offset = 0;
  for (const segment of text.split(/(?<=\n)/)) {
    const line = segment.replace(/\r?\n$/, '');
    if (fence) {
      if (line === fence) fence = undefined;
    } else if (line === '<!-- end-context-cards-writing -->') {
      return text.slice(offset + segment.length);
    } else {
      fence = /^(`{3,})text$/.exec(line)?.[1];
    }
    offset += segment.length;
  }
  throw new Error(
    'The writing review end marker is missing. Restore it before updating this review.',
  );
}
export function writingReviewMarkdown(s: WritingSession): string {
  const lines = [
    `<!-- context-cards-writing:${s.id} -->`,
    '# Writing review',
    `Created: ${s.created}`,
    `Source: [${escapeMd(s.capture.book)}](${sourceUri(s.capture)})`,
    '## Original selection',
    code(s.capture.selected),
    '## Feedback',
    escapeMd(s.summary),
  ];
  for (const f of s.findings) {
    lines.push(
      `### ${escapeMd(f.title)} · ${f.kind}`,
      '**Your sentence**',
      code(f.original),
      '**Suggested correction**',
      code(
        f.dismissed
          ? 'Dismissed suggestion'
          : f.kind === 'unclear'
            ? 'Clarification needed'
            : (() => {
                try {
                  return correctedSentence(f);
                } catch {
                  return 'Correction needs review.';
                }
              })(),
      ),
      '**Why**',
      code(f.explanation),
      '**Tip**',
      code(f.tip),
      `Practice: ${f.noteId ? `Anki note ${f.noteId}${f.reused ? ' (existing)' : ''}` : f.selected ? 'Selected' : 'Not selected'}`,
    );
    if (f.card)
      lines.push('**Exercise**', code(f.card.question), '**Model answer**', code(f.card.answer));
  }
  return lines.join('\n\n') + '\n\n<!-- end-context-cards-writing -->\n';
}
export class WritingController {
  sessions: WritingSession[] = [];
  private jobs = new Map<string, AbortController>();
  private exports: Promise<unknown> = Promise.resolve();
  private files: Promise<unknown> = Promise.resolve();
  private stopped = false;
  constructor(private host: ContextCardsPlugin) {}
  restore(value: unknown) {
    this.sessions = restoreWritingSessions(value);
  }
  refresh() {
    this.host.refreshWriting();
  }
  async start(capture: Capture) {
    if (this.stopped) return;
    if (!capture.selected.trim() || capture.selected.length > 6000) {
      new Notice('Select up to 6,000 characters of your writing.');
      return;
    }
    let s = this.sessions.find(
      (s) =>
        s.capture.file === capture.file &&
        s.capture.start === capture.start &&
        s.capture.selected === capture.selected,
    );
    const fresh = !s;
    if (!s) {
      if (this.sessions.length >= 4) {
        const index = this.sessions.findIndex(
          (old) => old.phase !== 'exporting' && old.phase !== 'saving',
        );
        if (index < 0) {
          new Notice('Wait for a writing export or save to finish before starting another draft.');
          return;
        }
        const [old] = this.sessions.splice(index, 1);
        this.jobs.get(old!.id)?.abort();
      }
      s = {
        id: crypto.randomUUID(),
        created: new Date().toISOString(),
        capture: structuredClone(capture),
        findings: [],
        summary: '',
        phase: 'idle',
        analysed: false,
        error: '',
        deck: this.host.settings.writingDeck,
      };
      this.sessions.push(s);
      this.host.persist();
    }
    const view = await this.host.openWritingPanel();
    if (this.stopped || !this.sessions.includes(s)) return;
    view.show(s);
    if (fresh) void this.analyse(s);
  }
  cancel(s: WritingSession) {
    if (this.jobs.has(s.id))
      s.error = 'Cancelled. Your previous results and prepared cards were kept.';
    this.jobs.get(s.id)?.abort();
  }
  async clear() {
    if (this.sessions.some((s) => s.phase === 'exporting' || s.phase === 'saving')) {
      new Notice('Wait for the writing export or save to finish before clearing drafts.');
      return;
    }
    for (const job of this.jobs.values()) job.abort();
    this.sessions = [];
    this.host.persist();
    this.refresh();
    try {
      await this.host.flush();
    } catch (error) {
      new Notice(`Could not save the cleared writing draft list: ${String(error)}`);
    }
  }
  stop() {
    this.stopped = true;
    for (const job of this.jobs.values()) job.abort();
  }
  private async run(
    s: WritingSession,
    phase: WritingSession['phase'],
    work: (signal: AbortSignal) => Promise<void>,
  ) {
    if (this.stopped || s.phase !== 'idle' || !this.sessions.includes(s)) return;
    const controller = new AbortController();
    this.jobs.set(s.id, controller);
    s.phase = phase;
    s.error = '';
    this.refresh();
    try {
      await work(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted)
        s.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.jobs.delete(s.id);
      s.phase = 'idle';
      this.host.persist();
      this.refresh();
    }
  }
  async analyse(s: WritingSession) {
    if (this.stopped || s.phase !== 'idle' || !this.sessions.includes(s)) return;
    if (s.findings.some((f) => f.noteId)) {
      s.error = 'Start a new selection to recheck text that already has exported cards.';
      this.refresh();
      return;
    }
    await this.run(s, 'analysing', async (signal) => {
      const result = await new WritingModel(
        structuredClone(this.host.settings),
        this.host.modelConnection,
      ).analyse(s.capture.selected, signal);
      if (signal.aborted || this.stopped) return;
      s.findings = result.findings;
      s.summary = result.summary;
      s.analysed = true;
    });
  }
  async generate(s: WritingSession) {
    if (this.stopped || s.phase !== 'idle' || !this.sessions.includes(s)) return;
    const selected = s.findings.filter((f) => f.selected && canPractise(f) && !f.noteId);
    if (!selected.length) {
      s.error = 'Select at least one grammar or vocabulary correction.';
      this.refresh();
      return;
    }
    const model = new WritingModel(structuredClone(this.host.settings), this.host.modelConnection);
    await this.run(s, 'generating', async (signal) => {
      const failures: string[] = [];
      for (const f of selected) {
        // Preserve valid prepared cards, including the user's manual edits, on retry.
        if (f.card) {
          try {
            writingPracticeFields(f);
            continue;
          } catch {
            /* Rebuild an invalid draft. */
          }
        }
        try {
          const card = await model.exercise(f, signal, s.findings);
          if (signal.aborted || this.stopped) return;
          f.card = card;
          this.host.persist();
        } catch (error) {
          if (signal.aborted || this.stopped) return;
          const message = error instanceof Error ? error.message : String(error);
          failures.push(`${f.title}: ${message}`);
          if (/cannot connect|timed out|server returned/i.test(message)) break;
        }
      }
      if (failures.length)
        throw new Error(
          `Some cards could not be prepared. Ready cards were kept. Retry to prepare the remaining cards.\n${failures.join('\n')}`,
        );
    });
  }
  private async writeReview(s: WritingSession): Promise<void> {
    const operation = this.files
      .catch(() => {})
      .then(async () => {
        const folder = normalizePath(this.host.settings.writingReviewFolder.trim());
        if (
          !folder ||
          folder.startsWith('/') ||
          /^[A-Za-z]:/.test(folder) ||
          folder.split('/').some((p) => p === '..' || p === '.' || p === '.obsidian')
        )
          throw new Error('Choose a normal vault-relative folder for writing reviews.');
        if (!s.reviewPath) {
          let path = '';
          for (const part of folder.split('/')) {
            path = path ? `${path}/${part}` : part;
            if (!this.host.app.vault.getAbstractFileByPath(path)) {
              try {
                await this.host.app.vault.createFolder(path);
              } catch (error) {
                if (!this.host.app.vault.getAbstractFileByPath(path)) throw error;
              }
            }
          }
          s.reviewPath = `${folder}/Writing review ${s.created.slice(0, 19).replaceAll(':', '-')}-${s.id.slice(0, 8)}.md`;
        }
        const path = s.reviewPath;
        if (
          !path ||
          path.startsWith('/') ||
          /^[A-Za-z]:/.test(path) ||
          path.split('/').some((p) => p === '..' || p === '.' || p === '.obsidian') ||
          !path.endsWith('.md')
        )
          throw new Error('The saved review path must be a Markdown file inside the vault.');
        if (path === s.capture.file)
          throw new Error('A writing review cannot overwrite the source.');
        const file = this.host.app.vault.getAbstractFileByPath(path);
        const markdown = writingReviewMarkdown(s);
        if (file) {
          if (!(file instanceof TFile)) throw new Error('The writing review path is not a file.');
          await this.host.app.vault.process(file, (text) => {
            if (!text.startsWith(`<!-- context-cards-writing:${s.id} -->`))
              throw new Error(
                'This file is not owned by this writing review. Choose a new review destination.',
              );
            return markdown + reviewTail(text);
          });
        } else await this.host.app.vault.create(path, markdown);
        await this.host.flush();
      });
    this.files = operation;
    await operation;
  }
  async save(s: WritingSession) {
    await this.run(s, 'saving', async () => {
      await this.writeReview(s);
      new Notice('Writing review saved.');
    });
  }
  async export(s: WritingSession) {
    if (this.stopped || s.phase !== 'idle' || !this.sessions.includes(s)) return;
    const selected = s.findings.filter((f) => f.selected && canPractise(f) && !f.noteId);
    if (!selected.length || selected.some((f) => !f.card)) {
      s.error = 'Generate and review a card for each selected correction first.';
      this.refresh();
      return;
    }
    const deck = cleanDeck(s.deck);
    if (!deck) {
      s.error = 'Choose a writing deck.';
      this.refresh();
      return;
    }
    const settings = structuredClone(this.host.settings);
    await this.run(s, 'exporting', async () => {
      const operation = this.exports
        .catch(() => {})
        .then(async () => {
          // Validate the whole batch before creating a review or sending its first note.
          for (const f of selected) writingPracticeFields(f);
          await this.writeReview(s);
          const uri = `obsidian://open?vault=${encodeURIComponent(s.capture.vault)}&file=${encodeURIComponent(s.reviewPath!)}`;
          for (const f of selected) {
            if (f.noteId) continue;
            const result = await new WritingAnki(settings).add(f, deck, uri);
            f.noteId = result.noteId;
            f.reused = result.existing;
            await this.host.flush();
            await this.writeReview(s);
          }
        });
      this.exports = operation;
      await operation;
      new Notice('Writing practice saved to Anki.');
    });
  }
  editFinding(f: WritingFinding) {
    if (f.noteId) return;
    delete f.card;
    this.host.persist();
  }
}
