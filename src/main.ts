import { WritingController } from './writing-controller';
import { WritingView, WRITING_VIEW } from './writing-view';
import { MarkdownView, Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import { sourceMarkRange } from './source-mark';
import { activeCapture, readCapture } from './capture';
import { Anki, DuplicateError } from './anki';
import { Ollama } from './ollama';
import { ContextSettings } from './settings';
import { ReviewView, VIEW_TYPE } from './view';
import { restoreData } from './storage';
import { createDraft, contextWindow, cleanDeck, issues, answerValid, trimCapture } from './text';
import {
  DEFAULTS,
  MAX_DRAFTS,
  type Capture,
  type Draft,
  type Settings,
  type StoredData,
} from './types';

export default class ContextCardsPlugin extends Plugin {
  settings: Settings = structuredClone(DEFAULTS);
  drafts: Draft[] = [];
  deckNames: string[] = [];
  writing = new WritingController(this);
  private jobs = new Map<string, AbortController>();
  private lastCapture: Capture | null = null;
  private floating = new Map<Document, HTMLElement>();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private writes: Promise<void> = Promise.resolve();
  private exports: Promise<unknown> = Promise.resolve();
  private unloaded = false;
  private captureEpoch = 0;
  private panelChanges: Promise<unknown> = Promise.resolve();

  async onload() {
    const raw = await this.loadData();
    const stored = restoreData(raw);
    this.settings = stored.settings;
    this.drafts = stored.drafts;
    if (this.settings.restoreDrafts) this.writing.restore(raw?.writingSessions);
    this.registerView(WRITING_VIEW, (leaf) => new WritingView(leaf, this));
    this.addCommand({
      id: 'check-writing',
      name: 'Find mistakes',
      callback: () => {
        const captured = activeCapture(this.app) ?? this.lastCapture;
        if (captured) void this.writing.start(captured);
        else new Notice('Select your writing first.');
      },
    });
    this.addCommand({
      id: 'open-writing',
      name: 'Open writing review',
      callback: () => void this.openWritingPanel(),
    });
    if (stored.skipped)
      new Notice(
        `Could not restore ${stored.skipped} damaged draft(s). Other drafts are available.`,
      );
    this.registerView(VIEW_TYPE, (leaf) => new ReviewView(leaf, this));
    this.addSettingTab(new ContextSettings(this.app, this));
    this.addRibbonIcon('book-open-check', 'Context Cards: Explain word / phrase', () => {
      const capture = activeCapture(this.app) ?? this.lastCapture;
      if (capture) void this.capture(capture);
      else void this.openPanel();
    });
    this.addCommand({
      id: 'create-from-selection',
      name: 'Explain word / phrase',
      callback: () => {
        const captured = activeCapture(this.app) ?? this.lastCapture;
        if (captured) void this.capture(captured);
        else new Notice('Select a word or expression in a Markdown book first.');
      },
    });
    this.addCommand({
      id: 'open-review',
      name: 'Open review panel',
      callback: () => void this.openPanel(),
    });
    this.addCommand({
      id: 'check-connections',
      name: 'Check connections',
      callback: () => void this.checkConnections(),
    });
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        const markdown =
          view instanceof MarkdownView
            ? view
            : this.app.workspace.getActiveViewOfType(MarkdownView);
        const captured = markdown ? readCapture(this.app, markdown) : null;
        if (captured)
          menu.addItem((item) =>
            item
              .setTitle('Find mistakes')
              .setIcon('spell-check')
              .onClick(() => void this.writing.start(captured)),
          );
        if (captured && captured.selected.length <= 240)
          menu.addItem((item) =>
            item
              .setTitle('Explain word / phrase')
              .setIcon('book-open-check')
              .onClick(() => void this.capture(captured)),
          );
      }),
    );
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file?.path !== this.lastCapture?.file) this.lastCapture = null;
        this.hideFloating();
      }),
    );
    this.setupDocument(document);
    this.registerEvent(
      this.app.workspace.on('window-open', (_workspaceWindow, win) =>
        this.setupDocument(win.document),
      ),
    );
    this.registerEvent(
      this.app.workspace.on('window-close', (_workspaceWindow, win) => {
        this.floating.get(win.document)?.remove();
        this.floating.delete(win.document);
      }),
    );
    this.register(() => {
      for (const el of this.floating.values()) el.remove();
      this.floating.clear();
    });
  }
  private setupDocument(doc: Document) {
    if (this.floating.has(doc)) return;
    const button = doc.createElement('div');
    const vocabulary = doc.createElement('button');
    vocabulary.textContent = 'Explain word / phrase';
    vocabulary.setAttribute('aria-label', 'Explain word / phrase');
    const writing = doc.createElement('button');
    writing.textContent = 'Find mistakes';
    writing.setAttribute('aria-label', 'Find mistakes');
    button.append(vocabulary, writing);
    button.className = 'cc-floating';
    button.hidden = true;
    doc.body.appendChild(button);
    this.floating.set(doc, button);
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    writing.addEventListener('click', () => {
      const captured = this.lastCapture;
      if (captured) {
        this.hideFloating();
        void this.writing.start(captured);
      }
    });
    vocabulary.addEventListener('click', () => {
      const capture = this.lastCapture;
      if (capture) void this.capture(capture);
    });
    const update = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.('.cc-panel,.cc-floating,.modal-container')) return;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.contentEl.ownerDocument !== doc) {
        button.hidden = true;
        return;
      }
      const captured = readCapture(this.app, view);
      if (!captured || captured.selected.length > 6000) {
        button.hidden = true;
        return;
      }
      this.lastCapture = captured;
      vocabulary.hidden = captured.selected.length > 240;
      if (!this.settings.floatingButton) {
        button.hidden = true;
        return;
      }
      const selection = doc.defaultView?.getSelection();
      if (!selection?.rangeCount) {
        button.hidden = true;
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) {
        button.hidden = true;
        return;
      }
      // The formatting toolbar occupies the space immediately above the selection.
      // Prefer below the text; leave room for that toolbar when flipping upward.
      button.hidden = false;
      const width = button.offsetWidth || 140;
      const height = button.offsetHeight || 34;
      const viewportWidth = doc.defaultView?.innerWidth ?? 1000;
      const viewportHeight = doc.defaultView?.innerHeight ?? 800;
      const below = rect.bottom + 10;
      const top = below + height <= viewportHeight - 40 ? below : rect.top - height - 72;
      button.style.left = `${Math.max(8, Math.min(rect.left, viewportWidth - width - 8))}px`;
      button.style.top = `${Math.max(8, Math.min(top, viewportHeight - height - 40))}px`;
    };
    this.registerDomEvent(doc, 'mouseup', update);
    this.registerDomEvent(doc, 'keyup', update);
    this.registerDomEvent(
      doc,
      'scroll',
      () => {
        button.hidden = true;
      },
      true,
    );
    this.registerDomEvent(doc, 'keydown', (event) => {
      if (event.key === 'Escape') button.hidden = true;
    });
  }
  hideFloating() {
    for (const button of this.floating.values()) button.hidden = true;
  }
  refreshWriting() {
    if (this.unloaded) return;
    for (const leaf of this.app.workspace.getLeavesOfType(WRITING_VIEW))
      (leaf.view as WritingView).render();
  }
  private async openMode(type: string): Promise<WorkspaceLeaf> {
    const operation = this.panelChanges
      .catch(() => {})
      .then(async () => {
        const workspace = this.app.workspace;
        const current = workspace.getLeavesOfType(type);
        const other = workspace.getLeavesOfType(type === WRITING_VIEW ? VIEW_TYPE : WRITING_VIEW);
        const leaf =
          current[0] ?? other[0] ?? workspace.getRightLeaf(false) ?? workspace.getLeaf('split');
        if (!current.includes(leaf)) await leaf.setViewState({ type, active: true });
        // Also clean up panes left stacked by older versions, without touching other plugins.
        for (const extra of [...current, ...other]) if (extra !== leaf) extra.detach();
        await workspace.revealLeaf(leaf);
        return leaf;
      });
    this.panelChanges = operation;
    return operation;
  }
  async openWritingPanel(): Promise<WritingView> {
    return (await this.openMode(WRITING_VIEW)).view as WritingView;
  }
  async openPanel(): Promise<ReviewView> {
    return (await this.openMode(VIEW_TYPE)).view as ReviewView;
  }
  private captureCapacityAvailable(): boolean {
    if (this.drafts.length < MAX_DRAFTS || this.drafts.some((d) => d.phase !== 'sending'))
      return true;
    new Notice('Wait for an Anki export to finish before starting another draft.');
    return false;
  }
  async capture(captured: Capture) {
    if (this.unloaded) return;
    const epoch = this.captureEpoch;
    captured = trimCapture(captured);
    if (!captured.selected.trim() || captured.selected.length > 240) {
      new Notice('Select a word or a short expression, up to 240 characters.');
      return;
    }
    this.hideFloating();
    // Do not accumulate duplicates from repeated clicks on the same selection.
    const findExisting = () =>
      this.drafts.find(
        (d) =>
          d.phase !== 'saved' &&
          d.capture.file === captured.file &&
          d.capture.start === captured.start &&
          d.capture.selected === captured.selected &&
          d.capture.text === captured.text,
      );
    let same = findExisting();
    if (!same && !this.captureCapacityAvailable()) return;
    if (this.settings.markSourceWord && !same) {
      const sourceView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (sourceView?.file?.path === captured.file) {
        try {
          if (sourceView.getMode() !== 'preview') {
            const editor = sourceView.editor;
            const text = editor.getValue();
            const selection = editor.getSelection();
            const preferredStart =
              selection.trim() === captured.selected
                ? editor.posToOffset(editor.getCursor('from')) +
                  selection.length -
                  selection.trimStart().length
                : undefined;
            const range =
              preferredStart === undefined ? null : sourceMarkRange(text, captured, preferredStart);
            if (range)
              editor.replaceRange(
                '`' + text.slice(range.start, range.end) + '`',
                editor.offsetToPos(range.start),
                editor.offsetToPos(range.end),
              );
          } else {
            await this.app.vault.process(sourceView.file, (text) => {
              const range = sourceMarkRange(text, captured);
              return range
                ? text.slice(0, range.start) +
                    '`' +
                    text.slice(range.start, range.end) +
                    '`' +
                    text.slice(range.end)
                : text;
            });
          }
        } catch (error) {
          new Notice(
            `Cards will still be created. Could not mark the source word: ${String(error)}`,
          );
        }
      }
    }
    if (this.unloaded || epoch !== this.captureEpoch) return;
    same ??= findExisting();
    // Source marking can await disk I/O; other captures/exports may have filled the list.
    if (!same && !this.captureCapacityAvailable()) return;
    const draft = same ?? createDraft(captured, this.settings);
    if (!same) {
      // An in-flight export cannot be cancelled safely: keep its result in the panel.
      while (this.drafts.length >= MAX_DRAFTS) {
        const index = this.drafts.findIndex((d) => d.phase !== 'sending');
        const [old] = this.drafts.splice(index, 1);
        this.cancel(old!);
      }
      this.drafts.push(draft);
      this.persist();
    }
    const view = await this.openPanel();
    if (!this.drafts.includes(draft)) return;
    view.show(draft);
    if (!same) void this.generate(draft);
  }
  refresh() {
    if (this.unloaded) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE))
      (leaf.view as ReviewView).render();
  }
  async generate(draft: Draft) {
    if (this.unloaded || this.jobs.has(draft.id) || ['sending', 'saved'].includes(draft.phase))
      return;
    if (!answerValid(draft)) {
      new Notice('Select the expected answer in the context before generating.');
      return;
    }
    if (draft.context.length > 6000) {
      new Notice('Shorten the context to 6,000 characters or fewer before generating.');
      return;
    }
    const controller = new AbortController();
    this.jobs.set(draft.id, controller);
    const revision = draft.revision,
      hadContent =
        draft.seconds !== undefined ||
        !!draft.meaning ||
        !!draft.explanation ||
        !!draft.generalMeaning;
    const target = draft.answer,
      source = draft.context;
    draft.phase = 'generating';
    draft.error = '';
    this.refresh();
    try {
      const result = await new Ollama(structuredClone(this.settings)).generate(
        target,
        source,
        controller.signal,
      );
      if (controller.signal.aborted || this.unloaded) return;
      if (draft.answer !== target || draft.context !== source) {
        draft.error =
          'The context or answer changed while generating. Generate again for the updated passage.';
        return;
      }
      if (hadContent || draft.revision !== revision) {
        draft.pendingContent = result.content;
        draft.pendingSource = { context: source, answer: target };
      } else {
        const expression = result.content.expression || draft.expression;
        Object.assign(draft, result.content, { expression });
      }
      draft.seconds = result.seconds;
    } catch (error) {
      if (!controller.signal.aborted)
        draft.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.jobs.delete(draft.id);
      draft.phase = 'editing';
      this.persist();
      this.refresh();
    }
  }
  async generateGeneralMeaning(draft: Draft) {
    if (
      this.unloaded ||
      this.jobs.has(draft.id) ||
      ['sending', 'saved'].includes(draft.phase) ||
      !draft.expression.trim()
    )
      return;
    const controller = new AbortController();
    this.jobs.set(draft.id, controller);
    const word = draft.expression,
      grammar = draft.partOfSpeech,
      previous = draft.generalMeaning ?? '';
    draft.phase = 'generating';
    draft.error = '';
    this.refresh();
    try {
      const result = await new Ollama(structuredClone(this.settings)).generalMeaning(
        word,
        grammar,
        controller.signal,
      );
      if (controller.signal.aborted || this.unloaded) return;
      if (
        draft.expression !== word ||
        draft.partOfSpeech !== grammar ||
        (draft.generalMeaning ?? '') !== previous
      ) {
        draft.error =
          'The word or general meaning changed while generating. Your edits have been kept.';
        return;
      }
      draft.generalMeaning = result;
    } catch (error) {
      if (!controller.signal.aborted)
        draft.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.jobs.delete(draft.id);
      draft.phase = 'editing';
      this.persist();
      this.refresh();
    }
  }
  async generateWordFormation(draft: Draft) {
    if (
      this.unloaded ||
      this.jobs.has(draft.id) ||
      ['sending', 'saved'].includes(draft.phase) ||
      !draft.expression.trim()
    )
      return;
    const controller = new AbortController();
    this.jobs.set(draft.id, controller);
    const word = draft.expression,
      grammar = draft.partOfSpeech,
      previous = draft.wordFormation ?? '';
    draft.phase = 'generating';
    draft.error = '';
    this.refresh();
    try {
      const result = await new Ollama(structuredClone(this.settings)).wordFormation(
        word,
        grammar,
        controller.signal,
      );
      if (controller.signal.aborted || this.unloaded) return;
      if (
        draft.expression !== word ||
        draft.partOfSpeech !== grammar ||
        (draft.wordFormation ?? '') !== previous
      ) {
        draft.error =
          'The word or word formation changed while generating. Your edits have been kept.';
        return;
      }
      draft.wordFormation = result;
    } catch (error) {
      if (!controller.signal.aborted)
        draft.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.jobs.delete(draft.id);
      draft.phase = 'editing';
      this.persist();
      this.refresh();
    }
  }
  cancel(draft: Draft) {
    this.jobs.get(draft.id)?.abort();
  }
  async clearDrafts() {
    if (this.drafts.some((d) => d.phase === 'sending')) {
      new Notice('Wait for the Anki export to finish before clearing drafts.');
      return;
    }
    this.captureEpoch++;
    for (const controller of this.jobs.values()) controller.abort();
    this.drafts = [];
    this.lastCapture = null;
    this.hideFloating();
    this.refresh();
    try {
      await this.flush();
    } catch (error) {
      new Notice(`Could not save the cleared draft list: ${String(error)}`);
    }
  }
  discard(draft: Draft) {
    if (draft.phase === 'sending') return;
    this.cancel(draft);
    this.drafts = this.drafts.filter((d) => d.id !== draft.id);
    this.persist();
    this.refresh();
  }
  expandContext(draft: Draft) {
    if (draft.phase === 'saved' || draft.phase === 'sending') return;
    const occurrences: number[] = [];
    if (answerValid(draft))
      for (
        let offset = draft.capture.text.indexOf(draft.context);
        offset >= 0;
        offset = draft.capture.text.indexOf(draft.context, offset + 1)
      )
        occurrences.push(offset);
    const original = occurrences.find(
      (offset) =>
        offset <= draft.capture.start && offset + draft.context.length >= draft.capture.end,
    );
    const offset = original ?? (occurrences.length === 1 ? occurrences[0] : undefined);
    if (offset === undefined) {
      new Notice(
        'This context has been edited. Capture a new selection from the book to include more source text without losing your edits.',
      );
      return;
    }
    const start = offset + draft.answerStart;
    const expanded = contextWindow(
      draft.capture.text,
      start,
      start + draft.answer.length,
      Math.min(6000, Math.max(600, draft.context.length * 2)),
    );
    if (expanded.context === draft.context) {
      new Notice('All captured surrounding text is already included.');
      return;
    }
    draft.context = expanded.context;
    draft.answerStart = expanded.answerStart;
    draft.revision++;
    draft.error = '';
    this.persist();
    this.refresh();
  }
  async approve(draft: Draft) {
    if (
      this.unloaded ||
      ['sending', 'generating', 'saved'].includes(draft.phase) ||
      draft.pendingContent
    )
      return;
    const problems = issues(draft, this.settings);
    if (problems.length) {
      new Notice(problems[0]!);
      return;
    }
    draft.deck = cleanDeck(draft.deck);
    draft.phase = 'sending';
    draft.error = '';
    this.refresh();
    const snapshot = structuredClone(draft),
      settings = structuredClone(this.settings);
    try {
      await this.flush();
      // Serialize approvals so two simultaneous drafts cannot race past the duplicate check.
      const operation = this.exports.catch(() => {}).then(() => new Anki(settings).add(snapshot));
      this.exports = operation;
      const noteId = await operation;
      draft.noteId = noteId;
      draft.phase = 'saved';
      draft.duplicates = undefined;
      if (this.unloaded) return; // A retry after reload can recover the note by its immutable key.
      this.settings.bookDecks[draft.capture.file] = draft.deck;
      await this.flush();
      new Notice('Added Recognition and Recall cards to Anki.');
    } catch (error) {
      if (!draft.noteId) draft.phase = 'editing';
      if (error instanceof DuplicateError) draft.duplicates = error.ids;
      draft.error = error instanceof Error ? error.message : String(error);
      this.persist();
    } finally {
      this.refresh();
    }
  }
  async openAnki(ids: number[]) {
    try {
      await new Anki(this.settings).open(ids);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }
  async openSource(draft: Draft) {
    const file = this.app.vault.getFileByPath(draft.capture.file);
    if (!file) {
      new Notice(
        'The source file was moved or is no longer available. The quote is preserved in the card.',
      );
      return;
    }
    const existing = this.app.workspace
      .getLeavesOfType('markdown')
      .find((leaf) => (leaf.view as MarkdownView).file?.path === file.path);
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }
  async refreshDecks() {
    try {
      this.deckNames = await new Anki(this.settings).decks();
      new Notice(`Loaded ${this.deckNames.length} Anki decks.`);
      this.refresh();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }
  async checkConnections() {
    const results = await Promise.allSettled([
      new Ollama(this.settings).models(),
      new Anki(this.settings).decks(),
    ]);
    const model = results[0],
      anki = results[1];
    if (anki.status === 'fulfilled') this.deckNames = anki.value;
    new Notice(
      [
        model.status === 'fulfilled'
          ? model.value.includes(this.settings.model)
            ? 'Ollama: selected model is installed.'
            : 'Ollama: connected; selected model is not installed.'
          : `Ollama: ${String(model.reason)}`,
        anki.status === 'fulfilled' ? 'Anki: connected.' : `Anki: ${String(anki.reason)}`,
      ].join('\n'),
      10000,
    );
  }
  openSettings() {
    // Obsidian exposes settings navigation at runtime but not in the public typings.
    const app = this.app as typeof this.app & {
      setting?: { open(): void; openTabById(id: string): void };
    };
    app.setting?.open();
    app.setting?.openTabById(this.manifest.id);
  }
  persist() {
    if (this.unloaded) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flush().catch((error) => new Notice(`Could not save draft: ${String(error)}`));
    }, 250);
  }
  async flush() {
    clearTimeout(this.saveTimer);
    const snapshot: StoredData = structuredClone({
      settings: this.settings,
      drafts: this.settings.restoreDrafts ? this.drafts.slice(-MAX_DRAFTS) : [],
      writingSessions: this.settings.restoreDrafts ? this.writing.sessions : [],
    });
    this.writes = this.writes.catch(() => {}).then(() => this.saveData(snapshot));
    return this.writes;
  }
  onunload() {
    this.unloaded = true;
    this.writing.stop();
    for (const controller of this.jobs.values()) controller.abort();
    clearTimeout(this.saveTimer);
    void this.flush().catch((error) =>
      console.error('Context Cards: could not save on unload.', error),
    );
  }
}
