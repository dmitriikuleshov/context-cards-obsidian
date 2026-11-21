import { WritingView } from '../../src/writing-view';
import { parseWritingAnalysis, correctedSentence } from '../../src/writing';
import type ContextCardsPlugin from '../../src/main';
export function mountWritingPanel(root: HTMLElement) {
  const first = 'I have wrote three stories this week.';
  const text = first + ' I did a mistake yesterday.';
  const result = parseWritingAnalysis(
    JSON.stringify({
      summary: 'One grammar correction and one optional style suggestion.',
      findings: [
        {
          kind: 'grammar',
          title: 'Past participle',
          original_sentence: first,
          target_before: 'wrote',
          target_after: 'written',
          explanation: 'The present perfect uses have plus a past participle.',
          tip: 'write → wrote → written',
          pattern: 'Present perfect participle',
          recommended_format: 'correction',
        },
        {
          kind: 'vocabulary',
          title: 'Make a mistake',
          original_sentence: 'I did a mistake yesterday.',
          target_before: 'did',
          target_after: 'made',
          explanation: 'Use make a mistake, not do a mistake.',
          tip: '',
          pattern: 'make a mistake',
          recommended_format: 'correction',
        },
        {
          kind: 'style',
          title: 'Optional wording',
          original_sentence: first,
          target_before: 'stories',
          target_after: 'short stories',
          explanation: 'A more specific description if that is what you mean.',
          tip: 'Optional; the original noun is acceptable.',
          pattern: 'Specific wording',
          recommended_format: 'correction',
        },
      ],
    }),
    text,
  );
  const session: any = {
    id: 'writing-preview',
    created: '2026-11-22T12:00:00Z',
    capture: {
      text,
      selected: text,
      start: 0,
      end: text.length,
      file: 'My story.md',
      book: 'My story',
      vault: 'Test',
      mode: 'editor',
    },
    summary: result.summary,
    findings: result.findings,
    phase: 'idle',
    analysed: true,
    error: '',
    deck: 'English::Writing mistakes',
  };
  let view: WritingView;
  const controls: any = {
    failGenerate: false,
    deferGenerate: false,
    failExport: false,
    exports: [],
  };
  const host: any = {
    persist: () => {},
    openPanel: () => {},
    openAnki: () => {},
    openSettings: () => {},
    app: { workspace: { openLinkText: () => {} } },
    writing: {
      sessions: [session],
      clear: async () => {
        host.writing.sessions = [];
        controls.finish?.();
        view.render();
      },
      cancel: (s: any) => {
        s.phase = 'idle';
        s.error = 'Cancelled. Your previous results and prepared cards were kept.';
        controls.finish?.();
        view.render();
      },
      analyse: () => {},
      editFinding: (f: any) => {
        delete f.card;
      },
      save: (s: any) => {
        s.reviewPath = 'English/Writing reviews/Example.md';
        view.render();
      },
      generate: async (s: any) => {
        s.error = '';
        if (controls.failGenerate) {
          controls.failGenerate = false;
          s.error = 'Could not validate the model response after retry.';
          view.render();
          return;
        }
        if (controls.deferGenerate) {
          s.phase = 'generating';
          view.render();
          await new Promise<void>((resolve) => {
            controls.finish = resolve;
          });
          return;
        }
        for (const f of s.findings.filter((f: any) => f.selected)) {
          f.card = {
            kind: f.format,
            question: f.format === 'gap' ? f.original.replace(f.before, '[[gap]]') : f.original,
            target: f.before,
            answer: f.after,
            corrected: correctedSentence(f),
            hint: f.format === 'gap' ? 'Use the correct form of write.' : '',
            explanation: f.explanation,
            tip: f.tip,
          };
        }
        view.render();
      },
      export: (s: any) => {
        s.error = '';
        for (const f of s.findings.filter(
          (f: any) => f.selected && !f.dismissed && f.card && !f.noteId,
        )) {
          if (controls.failExport && controls.exports.length === 1) {
            controls.failExport = false;
            s.error = 'Cannot connect to Anki.';
            break;
          }
          f.noteId = 123 + controls.exports.length;
          controls.exports.push(f.id);
        }
        view.render();
      },
    },
  };
  view = new WritingView({} as any, host as ContextCardsPlugin);
  view.show(session);
  root.append(view.contentEl);
  Object.assign(window, { writingPreview: { session, view, host, controls } });
}
