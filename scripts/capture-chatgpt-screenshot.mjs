// Real settings control, simulated account. Never opens OAuth or calls OpenAI.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
const server = spawn(process.execPath, ['scripts/preview.mjs'], {
  env: { ...process.env, CONTEXT_CARDS_PREVIEW_PORT: '4181' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview startup timed out.')), 15000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Development preview:')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on('exit', () => {
      clearTimeout(timer);
      reject(new Error('Preview exited.'));
    });
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 680, height: 680 },
      deviceScaleFactor: 1,
    });
    await page.goto('http://127.0.0.1:4181/?chatgpt');
    await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Connected' }).waitFor();
    await page.getByRole('button', { name: 'ChatGPT model', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'GPT-6 Luna', exact: true }).click();
    await page.locator('#panel').screenshot({ path: 'docs/images/chatgpt-connection.png' });
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
