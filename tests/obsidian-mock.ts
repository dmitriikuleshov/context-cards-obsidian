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
export function setIcon(element: HTMLElement, name: string) {
  element.dataset.icon = name;
}

export class TFile {}
export const normalizePath = (path: string) =>
  path.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/$/, '');
