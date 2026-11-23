// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDomHelpers } from '../dom';
vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<any>();
  class PluginSettingTab {
    containerEl = document.createElement('div');
    hide() {}
  }
  class Setting {
    settingEl: HTMLElement;
    controlEl: HTMLElement;
    name: HTMLElement;
    desc: HTMLElement;
    constructor(root: HTMLElement) {
      this.settingEl = root.createDiv({ cls: 'setting-item' });
      this.name = this.settingEl.createDiv({ cls: 'setting-item-name' });
      this.desc = this.settingEl.createDiv({ cls: 'setting-item-description' });
      this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
    }
    setName(value: string) {
      this.name.textContent = value;
      return this;
    }
    setDesc(value: string) {
      this.desc.textContent = value;
      return this;
    }
    setHeading() {
      return this;
    }
    addDropdown(fn: any) {
      const el = document.createElement('select');
      this.controlEl.append(el);
      const c: any = {
        addOptions: (items: any) => {
          for (const [k, v] of Object.entries(items)) c.addOption(k, v);
          return c;
        },
        addOption: (k: string, v: string) => {
          const o = document.createElement('option');
          o.value = k;
          o.textContent = v;
          el.append(o);
          return c;
        },
        setValue: (v: string) => {
          el.value = v;
          return c;
        },
        onChange: (f: any) => {
          el.addEventListener('change', () => f(el.value));
          return c;
        },
      };
      fn(c);
      return this;
    }
    addText(fn: any) {
      const el = document.createElement('input');
      this.controlEl.append(el);
      const c: any = {
        inputEl: el,
        setPlaceholder: (s: string) => {
          el.placeholder = s;
          return c;
        },
        setValue: (s: string) => {
          el.value = s;
          return c;
        },
        getValue: () => el.value,
        onChange: (f: any) => {
          el.addEventListener('input', () => f(el.value));
          return c;
        },
      };
      fn(c);
      return this;
    }
    addToggle(fn: any) {
      const el = document.createElement('input');
      el.type = 'checkbox';
      this.controlEl.append(el);
      const c: any = {
        setValue: (s: boolean) => {
          el.checked = s;
          return c;
        },
        onChange: (f: any) => {
          el.addEventListener('change', () => f(el.checked));
          return c;
        },
      };
      fn(c);
      return this;
    }
    addButton(fn: any) {
      const el = document.createElement('button');
      this.controlEl.append(el);
      const c: any = {
        setButtonText: (s: string) => {
          el.textContent = s;
          return c;
        },
        onClick: (f: any) => {
          el.addEventListener('click', f);
          return c;
        },
      };
      fn(c);
      return this;
    }
  }
  return { ...actual, PluginSettingTab, Setting };
});
import { ContextSettings } from '../../src/settings';
import { Ollama } from '../../src/ollama';
import { DEFAULTS } from '../../src/types';
installDomHelpers();
const tabs: ContextSettings[] = [];
afterEach(() => {
  tabs.splice(0).forEach((t) => t.hide());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function setup() {
  const models = vi.spyOn(Ollama.prototype, 'models').mockResolvedValue([DEFAULTS.model]);
  const account = {
    state: vi.fn(() => ({ active: '', accounts: [], signingIn: false, error: '' })),
    subscribe: vi.fn(() => () => {}),
    select: vi.fn(),
    signIn: vi.fn(),
    cancelSignIn: vi.fn(),
    signOut: vi.fn(),
    models: vi.fn(),
  };
  const plugin: any = {
    settings: structuredClone(DEFAULTS),
    persist: vi.fn(),
    refresh: vi.fn(),
    chatgpt: account,
  };
  const tab = new ContextSettings({} as any, plugin);
  tabs.push(tab);
  document.body.append(tab.containerEl);
  tab.display();
  const row = (name: string) =>
    Array.from(tab.containerEl.querySelectorAll<HTMLElement>('.setting-item')).find(
      (el) => el.querySelector('.setting-item-name')?.textContent === name,
    )!;
  const provider = (value: string) => {
    const select = row('Provider').querySelector('select')!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
  };
  return { tab, plugin, account, models, row, provider };
}
describe('full provider settings integration', () => {
  it('preserves local configuration when switching providers and hides unsupported controls', async () => {
    const f = setup();
    await flush();
    expect(f.row('Ollama server')).toBeDefined();
    expect(f.row('Generation temperature')).toBeDefined();
    expect(f.models).toHaveBeenCalledOnce();
    f.provider('chatgpt');
    await flush();
    expect(f.row('Ollama server')).toBeUndefined();
    expect(f.row('Generation temperature')).toBeUndefined();
    expect(f.tab.containerEl.textContent).toContain('Sends selected text and context to OpenAI');
    expect(f.models).toHaveBeenCalledOnce();
    expect(f.row('Request timeout')).toBeDefined();
    expect(f.row('AnkiConnect server')).toBeDefined();
    f.provider('ollama');
    await flush();
    expect(f.plugin.settings.model).toBe(DEFAULTS.model);
    expect(f.row('Ollama server')).toBeDefined();
    expect(f.account.cancelSignIn).toHaveBeenCalled();
  });
  it('keeps shared timeout/card settings and resets to local defaults without disconnecting the account', () => {
    const f = setup();
    f.provider('chatgpt');
    const timeout = f.row('Request timeout').querySelector('input')!;
    timeout.value = '300';
    timeout.dispatchEvent(new Event('input'));
    expect(f.plugin.settings.timeoutSeconds).toBe(300);
    const reset = Array.from(f.tab.containerEl.querySelectorAll('button')).find(
      (b) => b.textContent === 'Reset to defaults',
    )!;
    reset.click();
    expect(f.plugin.settings.provider).toBe('ollama');
    expect(f.plugin.settings.timeoutSeconds).toBe(60);
    expect(f.account.signOut).not.toHaveBeenCalled();
    expect(f.plugin.persist).toHaveBeenCalled();
  });
  it('shows an actionable Secret storage error while retaining the provider selector', () => {
    const f = setup();
    f.account.state.mockImplementation(() => {
      throw new Error('ChatGPT sign-in requires Obsidian 1.11.5 or newer.');
    });
    f.provider('chatgpt');
    expect(f.tab.containerEl.textContent).toContain('1.11.5');
    expect(f.row('Provider')).toBeDefined();
    expect(
      Array.from(f.tab.containerEl.querySelectorAll('button')).some(
        (b) => b.textContent === 'Continue with ChatGPT',
      ),
    ).toBe(false);
    f.provider('ollama');
    expect(f.row('Ollama server')).toBeDefined();
  });
});
