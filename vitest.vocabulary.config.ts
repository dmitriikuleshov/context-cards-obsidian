import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      'tests/*.test.ts',
      'tests/vocabulary/**/*.test.ts',
      'tests/analysis/transport.test.ts',
    ],
    exclude: ['tests/writing*.test.ts', 'tests/select-menu.test.ts'],
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      include: [
        'src/main.ts',
        'src/ollama.ts',
        'src/text.ts',
        'src/target.ts',
        'src/storage.ts',
        'src/fields.ts',
        'src/templates.ts',
        'src/pronunciation.ts',
        'src/source-mark.ts',
        'src/capture.ts',
        'src/anki.ts',
        'src/http.ts',
      ],
      reportsDirectory: 'coverage/vocabulary',
      reporter: ['text', 'json', 'json-summary', 'html'],
      thresholds: {
        perFile: true,
        statements: 98,
        lines: 98,
        branches: 97,
        functions: 100,
      },
    },
  },
});
