export class MarkdownView {}
export class Notice {
  constructor(public message: string) {}
}
export class ItemView {
  contentEl = document.createElement('div');
  constructor(public leaf: unknown) {}
}
export class Plugin {
  app: any;
  manifest = { id: 'context-cards' };
  commands = new Map<string, { callback: () => unknown }>();
  ribbon?: () => unknown;
  cleanups: Array<() => void> = [];
  constructor(app?: unknown) {
    this.app = app;
  }
  async saveData(_data: unknown) {}
  async loadData() {
    return null;
  }
  registerView(_type: string, _factory: unknown) {}
  addSettingTab(_tab: unknown) {}
  addRibbonIcon(_icon: string, _title: string, callback: () => unknown) {
    this.ribbon = callback;
  }
  addCommand(command: { id: string; callback: () => unknown }) {
    this.commands.set(command.id, command);
  }
  registerEvent(_event: unknown) {}
  register(callback: () => void) {
    this.cleanups.push(callback);
  }
  registerDomEvent(target: EventTarget, name: string, listener: EventListener, options?: boolean) {
    target.addEventListener(name, listener, options);
    this.cleanups.push(() => target.removeEventListener(name, listener, options));
  }
  dispose() {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}
export class PluginSettingTab {}
export class Setting {}
export class AbstractInputSuggest<T> {
  private popup?: HTMLElement;
  private generation = 0;
  constructor(
    _app: unknown,
    private input: HTMLInputElement,
  ) {
    input.addEventListener('focus', () => void this.open());
    input.addEventListener('input', () => void this.open());
    input.addEventListener('blur', () => this.close());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }
  protected getSuggestions(_query: string): T[] | Promise<T[]> {
    return [];
  }
  renderSuggestion(_value: T, _el: HTMLElement) {}
  selectSuggestion(_value: T) {}
  async open() {
    const generation = ++this.generation;
    const values = await this.getSuggestions(this.input.value);
    if (generation !== this.generation || !this.input.isConnected) return;
    this.popup?.remove();
    this.popup = undefined;
    if (!values.length || this.input.disabled) return;
    const doc = this.input.ownerDocument,
      popup = doc.createElement('div');
    popup.className = 'suggestion-container';
    popup.setAttribute('role', 'listbox');
    popup.style.position = 'fixed';
    popup.style.zIndex = '1000';
    for (const value of values) {
      const item = doc.createElement('div');
      item.className = 'suggestion-item';
      item.setAttribute('role', 'option');
      this.renderSuggestion(value, item);
      item.addEventListener('mousedown', (e) => e.preventDefault());
      item.addEventListener('click', () => this.selectSuggestion(value));
      popup.append(item);
    }
    this.popup = popup;
    doc.body.append(popup);
    const r = this.input.getBoundingClientRect(),
      win = doc.defaultView!;
    popup.style.minWidth = `${Math.min(r.width, win.innerWidth - 24)}px`;
    popup.style.left = `${Math.max(12, Math.min(r.x, win.innerWidth - popup.offsetWidth - 12))}px`;
    popup.style.top = `${Math.max(12, Math.min(r.bottom + 4, win.innerHeight - popup.offsetHeight - 12))}px`;
  }
  close() {
    this.generation++;
    this.popup?.remove();
    this.popup = undefined;
  }
}
// DOM-menu stand-in for browser tests. Production uses Obsidian Menu's public API.
class MockMenuItem {
  title = '';
  checked = false;
  disabled = false;
  callback: () => void = () => {};
  setTitle(value: string) {
    this.title = value;
    return this;
  }
  setChecked(value: boolean) {
    this.checked = value;
    return this;
  }
  setDisabled(value: boolean) {
    this.disabled = value;
    return this;
  }
  onClick(callback: () => void) {
    this.callback = callback;
    return this;
  }
}
export class Menu {
  items: MockMenuItem[] = [];
  parent?: HTMLElement;
  element?: HTMLElement;
  onHidden?: () => void;
  listeners: Array<() => void> = [];
  setUseNativeMenu(_native: boolean) {
    return this;
  }
  setParentElement(parent: HTMLElement) {
    this.parent = parent;
    return this;
  }
  addItem(callback: (item: MockMenuItem) => void) {
    const item = new MockMenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }
  onHide(callback: () => void) {
    this.onHidden = callback;
  }
  hide() {
    if (!this.element) return this;
    this.element.remove();
    this.element = undefined;
    for (const remove of this.listeners.splice(0)) remove();
    this.onHidden?.();
    return this;
  }
  showAtPosition(position: { x: number; y: number; width?: number }, doc: Document) {
    const menu = doc.createElement('div');
    this.element = menu;
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    menu.style.position = 'fixed';
    menu.style.zIndex = '1000';
    (this.parent ?? doc.body).append(menu);
    const buttons = this.items.map((item) => {
      const el = doc.createElement('div');
      el.className =
        'menu-item' + (item.checked ? ' is-checked' : '') + (item.disabled ? ' is-disabled' : '');
      el.setAttribute('role', 'menuitemcheckbox');
      el.setAttribute('aria-checked', String(item.checked));
      el.setAttribute('aria-disabled', String(item.disabled));
      el.tabIndex = -1;
      el.style.display = 'flex';
      const icon = doc.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.className = 'menu-item-icon';
      icon.textContent = item.checked ? '✓' : '';
      icon.style.width = '16px';
      icon.style.flexShrink = '0';
      const title = doc.createElement('span');
      title.className = 'menu-item-title';
      title.textContent = item.title;
      el.append(icon, title);
      menu.append(el);
      el.addEventListener('click', () => {
        if (!item.disabled) {
          this.hide();
          item.callback();
        }
      });
      return el;
    });
    const win = doc.defaultView!;
    menu.style.left = `${Math.max(12, Math.min(position.x, win.innerWidth - menu.offsetWidth - 12))}px`;
    menu.style.top = `${Math.max(12, Math.min(position.y, win.innerHeight - menu.offsetHeight - 12))}px`;
    let index = Math.max(
      0,
      this.items.findIndex((i) => i.checked && !i.disabled),
    );
    const focus = () => {
      buttons.forEach((b, i) => b.classList.toggle('is-selected', i === index));
      buttons[index]?.focus({ preventScroll: true });
    };
    focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        if (e.key === 'Escape') e.preventDefault();
        this.hide();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        buttons[index]?.click();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const step = e.key === 'ArrowUp' || e.key === 'End' ? -1 : 1;
      if (e.key === 'Home') index = -1;
      if (e.key === 'End') index = 0;
      for (let n = 0; n < this.items.length; n++) {
        index = (index + step + this.items.length) % this.items.length;
        if (!this.items[index]!.disabled) break;
      }
      focus();
    };
    const outside = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) this.hide();
    };
    doc.addEventListener('keydown', keydown);
    doc.addEventListener('pointerdown', outside);
    this.listeners.push(
      () => doc.removeEventListener('keydown', keydown),
      () => doc.removeEventListener('pointerdown', outside),
    );
    return this;
  }
}
export function setIcon(element: HTMLElement, name: string) {
  element.dataset.icon = name;
  // Render the deletion affordance for browser layout/visual checks as Obsidian does.
  if (name === 'trash-2') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    }))
      svg.setAttribute(key, value);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
      'd',
      'M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7',
    );
    svg.append(path);
    element.replaceChildren(svg);
  }
}

export class TFile {}
export const requireApiVersion = (_version: string) => true;
export const normalizePath = (path: string) =>
  path.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/$/, '');
