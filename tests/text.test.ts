import { describe, it, expect } from 'vitest';
import { DEFAULTS, type Capture } from '../src/types';
import {
  createDraft,
  contextWindow,
  answerValid,
  updateContext,
  contextHtml,
  bookDeck,
  issues,
} from '../src/text';
import { noteFields, TEMPLATES } from '../src/templates';
function capture(text: string, target: string, from = 0): Capture {
  const start = text.indexOf(target, from);
  return {
    text,
    start,
    end: start + target.length,
    selected: target,
    file: 'Books/Animal Farm.md',
    book: 'Animal Farm',
    vault: 'A & B',
    mode: 'editor',
  };
}
describe('source text and recall answers', () => {
  it('starts with a compact source excerpt while retaining the larger capture for expansion', () => {
    const text =
      'Earlier, she was at home. She packed a bag. She brushed off the warning. Then she left. Later, it rained. She came back at night.';
    const d = createDraft(capture(text, 'brushed off'), DEFAULTS);
    expect(d.context).toBe('She packed a bag. She brushed off the warning. Then she left.');
    expect(d.capture.text).toBe(text);
    expect(answerValid(d)).toBe(true);
  });
  it('trims selection edges without removing the spaces around the gap', () => {
    const d = createDraft(capture('She brushed off the warning.', ' brushed off '), DEFAULTS);
    expect(d.answer).toBe('brushed off');
    expect(answerValid(d)).toBe(true);
    expect(contextHtml(d, true)).toBe('She <span class="cc-gap">[…]</span> the warning.');
  });
  it('also masks repeated phrases with different whitespace', () => {
    const d = createDraft(
      capture('She brushed\n off my advice, then brushed off his warning.', 'brushed\n off'),
      DEFAULTS,
    );
    const html = contextHtml(d, true);
    expect(html).not.toContain('brushed');
    expect(html.match(/cc-gap/g)).toHaveLength(2);
  });
  it('keeps the selected occurrence when a word appears several times', () => {
    const text = 'The bank by the river was quiet. The bank in town was busy.';
    const c = capture(text, 'bank', 15),
      d = createDraft(c, DEFAULTS);
    expect(d.answerStart).toBe(text.indexOf('bank', 15));
    expect(answerValid(d)).toBe(true);
    expect(contextHtml(d)).toBe(
      'The bank by the river was quiet. The <mark>bank</mark> in town was busy.',
    );
    expect(contextHtml(d, true)).not.toContain('bank');
  });
  it('never changes an inflected source form into the lemma for the typing answer', () => {
    const d = createDraft(capture('She had brushed off three warnings.', 'brushed off'), DEFAULTS);
    d.expression = 'brush off';
    expect(noteFields(d).SourceForm).toBe('brushed off');
    expect(noteFields(d).GapContext).toContain(
      'She had <span class="cc-gap">[…]</span> three warnings.',
    );
  });
  it('rebases a selected occurrence after text is inserted before it', () => {
    const d = createDraft(capture('She had brushed off three warnings.', 'brushed off'), DEFAULTS);
    updateContext(d, 'Yesterday, ' + d.context);
    expect(answerValid(d)).toBe(true);
    expect(d.context.slice(d.answerStart, d.answerStart + d.answer.length)).toBe('brushed off');
  });
  it('retains the selected occurrence when text is inserted immediately before it', () => {
    const d = createDraft(capture('a bank and a bank', 'bank'), DEFAULTS);
    updateContext(d, 'a desk and a bank and a bank');
    expect(d.answerStart).toBe(13);
    expect(answerValid(d)).toBe(true);
  });
  it('requires a new selection when an edit replaces the surrounding passage ambiguously', () => {
    const d = createDraft(capture('old bank beside a road', 'bank'), DEFAULTS);
    updateContext(d, 'new bank by a bank');
    expect(answerValid(d)).toBe(false);
    expect(issues(d).join(' ')).toContain('Select the exact answer');
  });
  it('normalizes only the typed answer when the source phrase spans lines', () => {
    const d = createDraft(capture('She brushed\n off every warning.', 'brushed\n off'), DEFAULTS);
    const fields = noteFields(d);
    expect(fields.SourceForm).toBe('brushed off');
    expect(d.context).toContain('brushed\n off');
    expect(fields.Context).toContain('brushed<br> off');
  });
  it('escapes model content and quotes without executing HTML', () => {
    const d = createDraft(capture('<img src=x onerror=alert(1)> & word', 'word'), DEFAULTS);
    d.expression = '<script>alert(1)</script>';
    d.meaning = '<b>meaning</b>';
    d.examples = ['<svg onload=alert(1)>', 'second'];
    const f = noteFields(d);
    expect(f.Expression).toContain('&lt;script&gt;');
    expect(f.Context).not.toContain('<img');
    expect(f.Examples).not.toContain('<svg');
    expect(f.Source).toContain('vault=A%20%26%20B');
  });
  it('respects the context budget without losing the selected range', () => {
    const text = 'Before. '.repeat(400) + 'brushed off' + ' After. '.repeat(400);
    const c = capture(text, 'brushed off');
    const w = contextWindow(text, c.start, c.end, 1800);
    expect(w.context.length).toBeLessThanOrEqual(1800);
    expect(w.context.slice(w.answerStart, w.answerStart + c.selected.length)).toBe(c.selected);
  });
  it('does not blank part of a larger word', () => {
    const d = createDraft(capture('He saw the other man.', 'He'), DEFAULTS);
    expect(contextHtml(d, true)).toContain('the other');
  });
  it('keeps two card types in the same book destination', () => {
    const d = createDraft(capture('She had brushed off warnings.', 'brushed off'), DEFAULTS);
    expect(d.deck).toBe('English::Books::Animal Farm');
    expect(TEMPLATES.map((t) => t.Name)).toEqual(['Recognition', 'Recall']);
    expect(TEMPLATES[1]!.Front).toContain('{{type:SourceForm}}');
    expect(TEMPLATES[1]!.Front).not.toContain('{{Expression}}');
  });
  it('remembers a book deck without changing the parent default', () => {
    const c = capture('a word', 'word');
    expect(bookDeck({ ...DEFAULTS, bookDecks: { [c.file]: 'English::Books::Orwell' } }, c)).toBe(
      'English::Books::Orwell',
    );
    expect(DEFAULTS.rootDeck).toBe('English::Books');
  });
});
