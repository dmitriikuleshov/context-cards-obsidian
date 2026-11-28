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
  collapsed = new WeakSet<Usage>();
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
    state.collapsed = new WeakSet();
    state.examples = draft.examples;
    state.sourceGroups = draft.exampleGroups;
  }
  const body = section.createDiv({ cls: 'cc-examples-editor' });
  const summary = section.querySelector('summary')!;
  const button = (
    parent: HTMLElement,
    label: string,
    action: () => void,
    cls = '',
    readOnlyAction = false,
  ) => {
    const control = parent.createEl('button', { text: label, cls });
    control.type = 'button';
    control.disabled = disabled && !readOnlyAction;
    control.addEventListener('click', () => {
      if (!disabled || readOnlyAction) action();
    });
    return control;
  };
  const removeButton = (parent: HTMLElement, label: string, action: () => void) => {
    const control = button(parent, '', action, 'cc-example-delete');
    control.setAttribute('aria-label', label);
    control.title = label;
    setIcon(control, 'trash-2');
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
    const count = draft.examples.filter((v) => v.trim()).length;
    const usages = state.groups.length;
    summary.textContent = usages
      ? `Examples · ${usages} ${usages === 1 ? 'usage' : 'usages'} · ${count} ${count === 1 ? 'example' : 'examples'}`
      : 'Examples';
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
    if (state.groups.length) {
      const tools = body.createDiv({ cls: 'cc-examples-tools' });
      button(
        tools,
        'Clear examples',
        () => {
          promote();
          const removed = [...state.groups];
          deleteWithUndo(
            { label: 'Examples cleared.', kind: 'usages', index: 0, groups: removed },
            () => state.groups.splice(0),
          );
        },
        'cc-example-quiet',
      );
    } else {
      body.createEl('p', { text: 'No examples yet.', cls: 'cc-muted cc-examples-empty' });
    }
    state.groups.forEach((group, gi) => {
      const card = body.createDiv({ cls: 'cc-example-group' });
      const header = card.createDiv({ cls: 'cc-example-group-header' });
      const heading = button(
        header,
        `Usage ${gi + 1}`,
        () => {
          content.hidden = !content.hidden;
          if (content.hidden) state.collapsed.add(group);
          else state.collapsed.delete(group);
          heading.setAttribute('aria-expanded', String(!content.hidden));
        },
        'cc-usage-toggle',
        true,
      );
      heading.setAttribute('aria-label', `Usage ${gi + 1}`);
      removeButton(header, `Delete usage ${gi + 1}`, () => {
        promote();
        deleteWithUndo(
          { label: 'Usage deleted.', kind: 'usages', index: gi, groups: [group] },
          () => state.groups.splice(gi, 1),
        );
      });
      const content = card.createDiv({ cls: 'cc-example-group-body' });
      content.id = `cc-${crypto.randomUUID()}`;
      content.hidden = state.collapsed.has(group);
      heading.setAttribute('aria-expanded', String(!content.hidden));
      heading.setAttribute('aria-controls', content.id);
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
      button(
        content,
        'Add example',
        () => {
          group.examples.push('');
          redraw(
            state.legacy
              ? `Usage example ${group.examples.length}`
              : `Usage ${gi + 1}, example ${group.examples.length}`,
          );
        },
        'cc-example-quiet',
      );
    });
    button(
      body,
      'Add usage',
      () => {
        promote();
        state.groups.push({ meaning: '', examples: [''] });
        redraw(`Meaning / usage ${state.groups.length}`);
      },
      'cc-add-usage',
    );
    const last = state.undo.at(-1);
    if (last) {
      const feedback = body.createDiv({ cls: 'cc-examples-undo', attr: { role: 'status' } });
      feedback.createSpan({ text: last.label });
      button(
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
    }
  };
  updateSummary();
  draw();
}
