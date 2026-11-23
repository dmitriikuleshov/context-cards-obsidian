import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/chatgpt/**/*.test.ts', 'tests/chatgpt-routing.test.ts'],
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      include: ['src/chatgpt-*.ts', 'src/model-chat.ts'],
      reportsDirectory: 'coverage/chatgpt',
      reporter: ['text', 'json', 'json-summary', 'html'],
      thresholds: { statements: 95, lines: 98, branches: 92, functions: 90 },
    },
  },
});
