import { setIcon } from 'obsidian';

/** Both modes share the same brand, settings control and source-row markup. */
export function renderPanelHeader(root: HTMLElement, openSettings: () => void) {
  const header = root.createDiv({ cls: 'cc-panel-header' });
  const brand = header.createDiv({ cls: 'cc-brand' });
  setIcon(brand.createSpan(), 'book-open-check');
  brand.createSpan({ text: 'Context Cards' });
  const settings = header.createEl('button', {
    cls: 'clickable-icon',
    attr: { type: 'button', 'aria-label': 'Open Context Cards settings' },
  });
  setIcon(settings, 'settings-2');
  settings.addEventListener('click', openSettings);
}

export function renderSourceHeading(root: HTMLElement, book: string, openSource: () => void) {
  const source = root.createDiv({ cls: 'cc-source-heading' });
  source.createSpan({ text: book });
  const button = source.createEl('button', {
    cls: 'cc-source-button',
    attr: { type: 'button', 'aria-label': 'Open source', title: 'Open the original note' },
  });
  setIcon(button.createSpan({ attr: { 'aria-hidden': 'true' } }), 'file-text');
  button.createSpan({ text: 'Open source' });
  button.addEventListener('click', openSource);
}
