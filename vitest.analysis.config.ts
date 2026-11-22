import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      'tests/writing*.test.ts',
      'tests/http.test.ts',
      'tests/thinking.test.ts',
      'tests/analysis/**/*.test.ts',
    ],
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      include: [
        'src/writing.ts',
        'src/writing-model.ts',
        'src/writing-controller.ts',
        'src/writing-workflow.ts',
        'src/http.ts',
        'src/thinking.ts',
        'src/thinking-options.ts',
      ],
      reportsDirectory: 'coverage/analysis',
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
