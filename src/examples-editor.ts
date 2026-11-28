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
  const icon = (parent: HTMLElement, name: string) => {
    const glyph = parent.createSpan({ attr: { 'aria-hidden': 'true' } });
    setIcon(glyph, name);
    parent.prepend(glyph);
    return glyph;
  };
  summary.empty();
  summary.setAttribute('aria-label', 'Examples');
  summary.title = 'Expand or collapse examples';
  const heading = summary.createSpan({ cls: 'cc-examples-heading' });
  const title = heading.createSpan({ cls: 'cc-examples-title', text: 'Examples' });
  icon(title, 'list-tree');
  const total = heading.createSpan({ cls: 'cc-examples-total' });
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
    summary.querySelector('.cc-examples-tools')?.remove();
    if (state.groups.length) {
      const tools = summary.createDiv({ cls: 'cc-examples-tools' });
      const clear = button(
        tools,
        'Clear examples',
        () => {
          section.open = true;
          promote();
          const removed = [...state.groups];
          deleteWithUndo(
            { label: 'Examples cleared.', kind: 'usages', index: 0, groups: removed },
            () => state.groups.splice(0),
          );
        },
        'cc-example-quiet',
      );
      icon(clear, 'trash-2');
      clear.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
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
          folded.hidden = !content.hidden;
          folded.textContent = `${group.meaning || 'New usage'} · ${group.examples.length} examples`;
          setIcon(chevron, content.hidden ? 'chevron-right' : 'chevron-down');
          if (content.hidden) state.collapsed.add(group);
          else state.collapsed.delete(group);
          heading.setAttribute('aria-expanded', String(!content.hidden));
        },
        'cc-usage-toggle',
        true,
      );
      heading.setAttribute('aria-label', `Usage ${gi + 1}`);
      const chevron = icon(heading, state.collapsed.has(group) ? 'chevron-right' : 'chevron-down');
      removeButton(
        header,
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
      const folded = card.createDiv({
        cls: 'cc-example-folded',
        text: `${group.meaning || 'New usage'} · ${group.examples.length} examples`,
      });
      folded.hidden = !state.collapsed.has(group);
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
      const addExample = button(
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
        'cc-example-quiet cc-add-example',
      );
      icon(addExample, 'plus');
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
