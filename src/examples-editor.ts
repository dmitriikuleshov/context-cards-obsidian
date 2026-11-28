import { setIcon } from 'obsidian';
import type { Content, Draft } from './types';

type Usage = NonNullable<Content['exampleGroups']>[number];
type Deletion = { label: string; index: number } & (
  { kind: 'usages'; groups: Usage[] } | { kind: 'example'; group: Usage; value: string }
);

/** Retained across panel redraws, but discarded when generation replaces the content. */
export class ExamplesEditorState {
  examples?: string[];
  sourceGroups?: Content['exampleGroups'];
  groups: Usage[] = [];
  legacy = false;
  undo: Deletion[] = [];
}

export function renderExamplesEditor(
  section: HTMLDetailsElement,
  draft: Draft,
  state: ExamplesEditorState,
  changed: () => void,
  disabled: boolean,
) {
  if (state.examples !== draft.examples || state.sourceGroups !== draft.exampleGroups) {
    state.groups =
      draft.exampleGroups ??
      (draft.examples.length ? [{ meaning: '', examples: draft.examples }] : []);
    state.legacy = draft.exampleGroups === undefined && draft.examples.length > 0;
    state.undo = [];
    state.examples = draft.examples;
    state.sourceGroups = draft.exampleGroups;
  }
  const body = section.createDiv({ cls: 'cc-examples-editor' });
  const summary = section.querySelector('summary')!;
  const icon = (parent: HTMLElement, name: string) => {
    const glyph = parent.createSpan({ attr: { 'aria-hidden': 'true' } });
    setIcon(glyph, name);
    parent.prepend(glyph);
    return glyph;
  };
  summary.empty();
  const button = (parent: HTMLElement, label: string, action: () => void, cls = '') => {
    const control = parent.createEl('button', { text: label, cls });
    control.type = 'button';
    control.disabled = disabled;
    control.addEventListener('click', () => {
      if (!disabled) action();
    });
    return control;
  };
  const heading = summary.createSpan({ cls: 'cc-examples-heading' });
  heading.createSpan({ cls: 'cc-examples-title', text: 'Examples' });
  const total = heading.createSpan({ cls: 'cc-examples-total' });
  summary.addEventListener('click', () => {
    if (section.open) return;
    section.ownerDocument.defaultView?.requestAnimationFrame(() => {
      if (!section.isConnected || !section.open) return;
      const first = body.querySelector<HTMLElement>(
        '.cc-usage-meaning, .cc-example, .cc-examples-empty',
      );
      const footer = section.closest('.cc-panel')?.querySelector('.cc-footer');
      if (
        first &&
        footer &&
        first.getBoundingClientRect().bottom > footer.getBoundingClientRect().top
      ) {
        first.style.scrollMarginBottom = `${footer.getBoundingClientRect().height + 12}px`;
        first.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
    });
  });
  const removeButton = (parent: HTMLElement, label: string, action: () => void, usage = false) => {
    const control = button(
      parent,
      usage ? 'Delete usage' : '',
      action,
      usage ? 'cc-example-quiet cc-delete-usage' : 'cc-example-delete',
    );
    control.setAttribute('aria-label', label);
    control.title = label;
    icon(control, usage ? 'trash-2' : 'x');
  };
  const field = (
    parent: HTMLElement,
    label: string,
    value: string,
    action: (s: string) => void,
  ) => {
    const id = `cc-${crypto.randomUUID()}`;
    parent.createEl('label', { text: label, cls: 'cc-sr-only', attr: { for: id } });
    const input = parent.createEl('textarea', { attr: { id, rows: '1' } });
    input.value = value;
    input.dataset.ccField = label;
    input.disabled = disabled;
    input.spellcheck = true;
    input.addEventListener('input', () => {
      action(input.value);
      save();
    });
    return input;
  };
  const promote = () => {
    if (state.legacy) {
      state.groups[0]!.meaning = draft.meaning || draft.expression;
      state.legacy = false;
    }
  };
  const updateSummary = () => {
    const count = state.groups.reduce((n, group) => n + group.examples.length, 0);
    const usages = state.groups.length;
    total.textContent = `${usages} ${usages === 1 ? 'usage' : 'usages'} · ${count} ${count === 1 ? 'example' : 'examples'}`;
  };
  const save = () => {
    draft.exampleGroups = state.legacy ? undefined : state.groups;
    draft.examples = state.groups.flatMap((g) => g.examples);
    state.examples = draft.examples;
    state.sourceGroups = draft.exampleGroups;
    updateSummary();
    changed();
  };
  const redraw = (focusLabel?: string) => {
    save();
    draw();
    if (focusLabel) {
      const target = Array.from(body.querySelectorAll<HTMLElement>('[data-cc-field],button')).find(
        (el) =>
          el.dataset.ccField === focusLabel ||
          el.getAttribute('aria-label') === focusLabel ||
          el.textContent === focusLabel,
      );
      target?.focus({ preventScroll: true });
      if (target) {
        const footer = section.closest('.cc-panel')?.querySelector('.cc-footer');
        target.style.scrollMarginBottom = `${(footer?.getBoundingClientRect().height ?? 0) + 12}px`;
        target.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
    }
  };
  const deleteWithUndo = (deletion: Deletion, remove: () => void) => {
    remove();
    state.undo.push(deletion);
    redraw('Undo');
  };
  const draw = () => {
    body.empty();
    if (!state.groups.length) {
      body.createEl('p', { text: 'No examples yet.', cls: 'cc-muted cc-examples-empty' });
    }
    state.groups.forEach((group, gi) => {
      const card = body.createDiv({ cls: 'cc-example-group' });
      const groupLabel = card.createSpan({ cls: 'cc-sr-only', text: `Usage ${gi + 1}` });
      groupLabel.id = `cc-${crypto.randomUUID()}`;
      card.setAttribute('role', 'group');
      // Obsidian treats aria-label as a hover tooltip, even on passive groups.
      card.setAttribute('aria-labelledby', groupLabel.id);
      const content = card.createDiv({ cls: 'cc-example-group-body' });
      if (!state.legacy) {
        const meaning = field(content, `Meaning / usage ${gi + 1}`, group.meaning, (v) => {
          group.meaning = v;
        });
        meaning.addClass('cc-usage-meaning');
        meaning.placeholder = 'Describe this meaning or usage';
      }
      const list = content.createEl('ol', { cls: 'cc-example-list' });
      group.examples.forEach((value, ei) => {
        const row = list.createEl('li', { cls: 'cc-example' });
        row.createSpan({
          text: String(ei + 1),
          cls: 'cc-example-number',
          attr: { 'aria-hidden': 'true' },
        });
        const label = state.legacy
          ? `Usage example ${ei + 1}`
          : `Usage ${gi + 1}, example ${ei + 1}`;
        const input = field(row, label, value, (v) => {
          group.examples[ei] = v;
        });
        input.placeholder = 'Write an example sentence';
        removeButton(row, `Delete usage ${gi + 1}, example ${ei + 1}`, () => {
          const removed = group.examples[ei]!;
          deleteWithUndo(
            { label: 'Example deleted.', kind: 'example', index: ei, group, value: removed },
            () => group.examples.splice(ei, 1),
          );
        });
      });
      const actions = content.createDiv({ cls: 'cc-example-group-actions' });
      const addExample = button(
        actions,
        'Add example',
        () => {
          group.examples.push('');
          redraw(
            state.legacy
              ? `Usage example ${group.examples.length}`
              : `Usage ${gi + 1}, example ${group.examples.length}`,
          );
        },
        'cc-example-quiet cc-add-example',
      );
      icon(addExample, 'plus');
      removeButton(
        actions,
        `Delete usage ${gi + 1}`,
        () => {
          promote();
          deleteWithUndo(
            { label: 'Usage deleted.', kind: 'usages', index: gi, groups: [group] },
            () => state.groups.splice(gi, 1),
          );
        },
        true,
      );
    });
    const addUsage = button(
      body,
      'Add usage',
      () => {
        promote();
        state.groups.push({ meaning: '', examples: [''] });
        redraw(`Meaning / usage ${state.groups.length}`);
      },
      'cc-add-usage',
    );
    icon(addUsage, 'plus');
    const last = state.undo.at(-1);
    if (last) {
      const feedback = body.createDiv({ cls: 'cc-examples-undo', attr: { role: 'status' } });
      feedback.createSpan({ text: last.label });
      const undo = button(
        feedback,
        'Undo',
        () => {
          const deletion = state.undo.pop()!;
          if (deletion.kind === 'usages')
            state.groups.splice(
              Math.min(deletion.index, state.groups.length),
              0,
              ...deletion.groups,
            );
          else
            deletion.group.examples.splice(
              Math.min(deletion.index, deletion.group.examples.length),
              0,
              deletion.value,
            );
          redraw('Add usage');
        },
        'cc-example-quiet',
      );
      icon(undo, 'undo-2');
    }
  };
  updateSummary();
  draw();
}
