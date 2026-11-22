// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { enhanceSelects } from '../src/select-menu';
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});
function setup() {
  const root = document.createElement('div');
  root.innerHTML =
    '<label for="choice">Exercise type</label><select id="choice" data-writing-field="format"><option value="correction">Correct the mistake</option><option value="gap">Fill in the gap</option><option disabled value="disabled">Disabled choice</option></select>';
  document.body.append(root);
  const select = root.querySelector('select')!;
  const change = vi.fn();
  select.addEventListener('change', change);
  dispose = enhanceSelects(root);
  return { root, select, button: root.querySelector('button')!, change };
}
it('keeps the label and state key on the visible control and the underlying value/change handler', () => {
  const { root, select, button, change } = setup();
  expect(root.querySelector('label')!.control).toBe(button);
  expect(select.hidden).toBe(true);
  expect(button.dataset.writingField).toBe('format');
  expect(select.dataset.writingField).toBeUndefined();
  button.click();
  expect(button.getAttribute('aria-expanded')).toBe('true');
  const options = [...document.querySelectorAll<HTMLElement>('[role=menuitemcheckbox]')];
  expect(options[0]!.getAttribute('aria-checked')).toBe('true');
  options[1]!.click();
  expect(select.value).toBe('gap');
  expect(button.textContent).toBe('Fill in the gap');
  expect(change).toHaveBeenCalledTimes(1);
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelector('.cc-select-menu-host')).toBeNull();
});
it('does not change the value on Escape and restores focus without submitting the form', () => {
  const { button, select, change } = setup();
  button.click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(select.value).toBe('correction');
  expect(change).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(button);
  expect(document.querySelector('.cc-select-menu-host')).toBeNull();
});
it('tracks disabled and programmatic changes and ignores disabled choices', async () => {
  const { button, select, change } = setup();
  button.click();
  (document.querySelector('[aria-disabled=true]') as HTMLElement).click();
  expect(change).not.toHaveBeenCalled();
  select.disabled = true;
  await Promise.resolve();
  expect(button.disabled).toBe(true);
  expect(document.querySelector('.cc-select-menu-host')).toBeNull();
  select.disabled = false;
  select.value = 'gap';
  select.dispatchEvent(new Event('change'));
  expect(button.disabled).toBe(false);
  expect(button.textContent).toBe('Fill in the gap');
});
it('removes an open menu when its pane is cleared or disposed', async () => {
  const { root, button } = setup();
  button.click();
  root.remove();
  await Promise.resolve();
  expect(document.querySelector('.cc-select-menu-host')).toBeNull();
  const next = setup();
  next.button.click();
  dispose!();
  expect(document.querySelector('.cc-select-menu-host')).toBeNull();
});
it('names dropdowns in Obsidian settings using their setting name', () => {
  const root = document.createElement('div');
  root.innerHTML =
    '<div class="setting-item"><div class="setting-item-name">English variant</div><select><option>Accept both</option></select></div>';
  document.body.append(root);
  dispose = enhanceSelects(root);
  expect(root.querySelector('button')!.getAttribute('aria-label')).toBe('English variant');
});
