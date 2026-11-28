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
  summary.setAttribute('aria-label', 'Examples');
  summary.setAttribute('role', 'group');
  summary.tabIndex = -1;
  // The header contains separate controls; clicking its text or blank space
  // must not trigger the native summary's implicit toggle and page jump.
  summary.addEventListener('click', (event) => event.preventDefault());
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
  const heading = summary.createSpan({ cls: 'cc-examples-heading' });
  const toggle = button(
    heading,
    'Examples',
    () => {
      section.open = !section.open;
      updateDisclosure();
      if (!section.open) return;
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
    },
    'cc-examples-toggle',
    true,
  );
  const disclosureIcon = icon(toggle, 'chevron-right');
  const caption = toggle.createSpan({ cls: 'cc-examples-toggle-caption' });
  body.id = `cc-${crypto.randomUUID()}`;
  toggle.setAttribute('aria-controls', body.id);
  const total = heading.createSpan({ cls: 'cc-examples-total' });
  const updateDisclosure = () => {
    toggle.setAttribute('aria-expanded', String(section.open));
    toggle.setAttribute('aria-label', section.open ? 'Hide examples' : 'Show examples');
    caption.textContent = section.open ? 'Hide' : 'Show';
    setIcon(disclosureIcon, section.open ? 'chevron-down' : 'chevron-right');
  };
  section.addEventListener('toggle', updateDisclosure);
  updateDisclosure();
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
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', `Usage ${gi + 1}`);
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
