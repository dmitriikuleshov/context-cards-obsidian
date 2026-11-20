import { cardFields, type Draft, type Settings } from './types';
export function visibleDraft(draft: Draft, settings?: Partial<Settings>): Draft {
  const f = cardFields(settings);
  return {
    ...draft,
    partOfSpeech: f.grammar ? draft.partOfSpeech : '',
    americanIpa: f.ipa === 'off' ? '' : draft.americanIpa,
    meaning: f.meaningSentences ? draft.meaning : '',
    generalMeaning: f.generalMeaningSentences ? draft.generalMeaning : '',
    wordFormation: f.wordFormation ? draft.wordFormation : '',
    context: f.context ? draft.context : '',
    explanation: f.explanationSentences ? draft.explanation : '',
    examples: f.examples ? draft.examples : [],
    exampleGroups: f.examples ? draft.exampleGroups : undefined,
  };
}
