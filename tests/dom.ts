/** Minimal implementation of the documented Obsidian DOM helpers for isolated UI tests. */
export function installDomHelpers() {
  Object.assign(HTMLElement.prototype, {
    empty(this: HTMLElement) {
      this.replaceChildren();
    },
    addClass(this: HTMLElement, ...values: string[]) {
      this.classList.add(...values);
    },
    toggleClass(this: HTMLElement, name: string, enabled: boolean) {
      this.classList.toggle(name, enabled);
    },
    appendText(this: HTMLElement, text: string) {
      this.append(document.createTextNode(text));
    },
    createEl(this: HTMLElement, tag: string, options: Record<string, any> = {}) {
      const element = document.createElement(tag);
      if (options.text !== undefined) element.textContent = options.text;
      if (options.cls) element.className = options.cls;
      for (const [name, value] of Object.entries(options.attr ?? {}))
        element.setAttribute(name, String(value));
      for (const name of ['type', 'value', 'placeholder'])
        if (options[name] !== undefined) (element as any)[name] = options[name];
      this.append(element);
      return element;
    },
    createDiv(this: HTMLElement, options: Record<string, unknown> = {}) {
      return this.createEl('div', options);
    },
    createSpan(this: HTMLElement, options: Record<string, unknown> = {}) {
      return this.createEl('span', options);
    },
  });
}
