import { AbstractInputSuggest, type App } from 'obsidian';

/** Obsidian's themed autocomplete, with free text preserved for new deck names. */
export class DeckSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private input: HTMLInputElement,
    private names: () => string[],
  ) {
    super(app, input);
    input.removeAttribute('list');
  }
  protected getSuggestions(query: string): string[] {
    const needle = query.trim().toLowerCase();
    return this.names()
      .filter((name) => name.toLowerCase().includes(needle))
      .slice(0, 100);
  }
  renderSuggestion(value: string, el: HTMLElement) {
    el.textContent = value;
    el.classList.add('cc-deck-suggestion');
  }
  selectSuggestion(value: string) {
    this.input.value = value;
    this.input.dispatchEvent(
      new this.input.ownerDocument.defaultView!.Event('input', { bubbles: true }),
    );
    this.close();
  }
}
