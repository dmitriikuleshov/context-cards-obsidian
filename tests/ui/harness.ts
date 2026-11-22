import { ReviewView } from '../../src/view';
import { mountWritingPanel } from './writing-harness';
import { createDraft } from '../../src/text';
import { DEFAULTS, type Draft } from '../../src/types';
import type ContextCardsPlugin from '../../src/main';
import { installDomHelpers } from '../dom';
import { enhanceSelects } from '../../src/select-menu';
import { ThinkingControl } from '../../src/thinking-control';
installDomHelpers();
const text =
  'Mara brushed off the first warning. By the time she reached the station, the last train had already left. She wished she had listened.';
const draft = createDraft(
  {
    text,
    start: text.indexOf('brushed off'),
    end: text.indexOf('brushed off') + 11,
    selected: 'brushed off',
    file: 'Books/The Last Train.md',
    book: 'The Last Train',
    vault: 'Preview',
    mode: 'reading',
  },
  DEFAULTS,
);
Object.assign(draft, {
  expression: 'brush off',
  partOfSpeech: 'phrasal verb',
  americanIpa: '/bɹʌʃ ɔf/',
  meaning: 'to dismiss something without considering it seriously',
  explanation: 'Mara dismissed the warning instead of taking it seriously.',
  generalMeaning:
    'To dismiss someone or something with little attention or consideration. It often suggests treating a concern, remark or person as unimportant.',
  examples: [
    'He brushed off her concerns and changed the subject.',
    'The manager brushed off my suggestion.',
    'She brushed off the criticism.',
    'We brushed off his suggestion.',
    'They brushed off our complaints.',
  ],
  notes: ['brush off a warning / a suggestion / someone’s concerns'],
  seconds: 2.4,
});
const host = {
  settings: structuredClone(DEFAULTS),
  drafts: [draft],
  deckNames: ['English::Books::The Last Train'],
  persist: () => {},
  openSettings: () => {},
  openSource: () => {},
  refreshDecks: () => {},
  openAnki: () => {},
  checkConnections: () => {},
  expandContext: () => {},
  generateWordFormation: async (d: Draft) => {
    d.wordFormation = '';
    view.render();
  },
  generateGeneralMeaning: async (d: Draft) => {
    d.generalMeaning =
      'To dismiss someone or something with little attention. This suggests treating it as unimportant.';
    view.render();
  },
  discard: () => {
    host.drafts = [];
    view.render();
  },
  clearDrafts: async () => {
    host.drafts = [];
    view.render();
  },
  generate: async (d: Draft) => {
    d.pendingContent = {
      status: 'ready',
      expression: 'brush off',
      partOfSpeech: 'phrasal verb',
      americanIpa: '/bɹʌʃ ɔf/',
      meaning: 'dismiss without giving serious attention',
      explanation: 'Mara ignored the warning.',
      examples: [
        'She brushed off the criticism.',
        'He brushed off my advice.',
        'She brushed off the criticism.',
        'We brushed off his suggestion.',
        'They brushed off our complaints.',
      ],
      notes: [],
      question: '',
    };
    view.render();
  },
  approve: async (d: Draft) => {
    d.phase = 'saved';
    d.noteId = 999;
    view.render();
  },
  cancel: () => {},
};
const view = new ReviewView({} as any, host as unknown as ContextCardsPlugin);
view.show(draft);
if (new URLSearchParams(location.search).has('writing'))
  mountWritingPanel(document.querySelector('#panel')!);
else document.querySelector('#panel')!.append(view.contentEl);
Object.assign(window, {
  contextCardsPreview: { view, draft, host, enhanceSelects, ThinkingControl },
});
