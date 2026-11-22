import { vi } from 'vitest';
import { TFile } from 'obsidian';
import { WritingController } from '../../src/writing-controller';
import { DEFAULTS } from '../../src/types';
import { session } from './fixtures';
export function controllerFixture() {
  const files = new Map<string, { file: unknown; text: string }>();
  const show = vi.fn();
  const host: any = {
    settings: structuredClone(DEFAULTS),
    persist: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    refreshWriting: vi.fn(),
    openWritingPanel: vi.fn().mockResolvedValue({ show }),
    app: {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => files.get(path)?.file),
        createFolder: vi.fn(async (path: string) => {
          files.set(path, { file: { path }, text: '' });
        }),
        create: vi.fn(async (path: string, text: string) => {
          const file = Object.assign(new TFile(), { path });
          files.set(path, { file, text });
          return file;
        }),
        process: vi.fn(async (file: any, update: (text: string) => string) => {
          const saved = files.get(file.path)!;
          saved.text = update(saved.text);
        }),
      },
    },
  };
  const controller = new WritingController(host),
    s = session();
  controller.sessions = [s];
  return { controller, host, s, f: s.findings[0]!, files, show };
}
