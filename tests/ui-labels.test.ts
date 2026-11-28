// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { suppressPluginTooltips } from '../src/ui-labels';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const stop of cleanups.splice(0)) stop();
  document.body.replaceChildren();
});
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const name = (element: Element) =>
  document.getElementById(element.getAttribute('aria-labelledby')!)?.textContent;

describe('plugin-owned accessible labels without Obsidian tooltips', () => {
  it('keeps group and icon names while leaving other apps, existing labels and iframe titles alone', () => {
    document.body.innerHTML =
      '<div aria-label="Other plugin"></div><section class="cc-panel"><div role="group" aria-label="Draft view"></div><button aria-label="Settings"></button><span id="existing">Visible name</span><button aria-label="Old hover" aria-labelledby="existing"></button><iframe title="Card preview"></iframe></section>';
    cleanups.push(suppressPluginTooltips(document));
    const panel = document.querySelector('.cc-panel')!;
    expect(panel.querySelector('[aria-label]')).toBeNull();
    expect(name(panel.querySelector('[role=group]')!)).toBe('Draft view');
    expect(name(panel.querySelector('button')!)).toBe('Settings');
    expect(panel.querySelectorAll('button')[1]!.getAttribute('aria-labelledby')).toBe('existing');
    expect(document.querySelector('[aria-label="Other plugin"]')).not.toBeNull();
    expect(panel.querySelector('iframe')!.title).toBe('Card preview');
    expect(document.querySelector<HTMLElement>('[id^=cc-label-]')!.hidden).toBe(true);
  });
  it('handles appended settings, provider controls and repeated async label changes without extra labels', async () => {
    cleanups.push(suppressPluginTooltips(document));
    const root = document.createElement('section');
    root.className = 'cc-settings';
    root.innerHTML =
      '<div class="cc-model-control"><button aria-label="Refresh models"></button></div>';
    document.body.append(root);
    await settle();
    const button = root.querySelector('button')!;
    expect(name(button)).toBe('Refresh models');
    const id = button.getAttribute('aria-labelledby');
    button.setAttribute('aria-label', 'Refresh again');
    await settle();
    expect(name(button)).toBe('Refresh again');
    expect(button.getAttribute('aria-labelledby')).toBe(id);
    expect(root.querySelectorAll('[id^=cc-label-]')).toHaveLength(1);
    expect(button.hasAttribute('aria-label')).toBe(false);
  });
  it('moves the hidden label along with a moved control and stops observing on disposal', async () => {
    const stop = suppressPluginTooltips(document);
    cleanups.push(stop);
    document.body.innerHTML =
      '<div class="cc-panel"><div id="one"><button aria-label="Delete draft"></button></div><div id="two"></div></div>';
    await settle();
    const button = document.querySelector('button')!;
    document.getElementById('two')!.append(button);
    document.getElementById('one')!.replaceChildren();
    await settle();
    expect(name(button)).toBe('Delete draft');
    expect(button.nextElementSibling!.id).toBe(button.getAttribute('aria-labelledby'));
    stop();
    button.setAttribute('aria-label', 'After disposal');
    await settle();
    expect(button.getAttribute('aria-label')).toBe('After disposal');
  });
  it('supports popout documents, pre-existing scopes and multiple scope types', async () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML =
      '<div class="cc-floating"><button aria-label="Find mistakes"></button></div><div class="cc-chatgpt-settings"><select aria-label="ChatGPT model"></select></div><button class="cc-tooltip-scope" aria-label="Ribbon"></button>';
    cleanups.push(suppressPluginTooltips(doc));
    expect(doc.querySelector('[aria-label]')).toBeNull();
    for (const e of Array.from(doc.querySelectorAll('[data-cc-quiet-label]')))
      expect(doc.getElementById(e.getAttribute('aria-labelledby')!)!.textContent).not.toBe('');
    doc.body.append(doc.createTextNode('Unrelated content'));
    await settle();
  });
});
