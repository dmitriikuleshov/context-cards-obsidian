import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
await mkdir('docs/images', { recursive: true });
const server = spawn(process.execPath, ['scripts/preview.mjs'], {
  env: { ...process.env, CONTEXT_CARDS_PREVIEW_PORT: '4180' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
try {
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => {
      if (d.toString().includes('Development preview:')) resolve();
    });
    server.on('exit', (code) => reject(Error('Preview exited ' + code)));
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 680, height: 1000 },
      deviceScaleFactor: 1,
    });
    await page.goto('http://127.0.0.1:4180');
    await page.evaluate(() => {
      const { draft, view } = window.contextCardsPreview;
      draft.wordFormation = '';
      draft.meaning =
        'To dismiss a warning or concern without taking it seriously. It suggests giving the issue little attention rather than carefully considering it.';
      draft.explanation =
        'Use this expression when someone treats advice, criticism or a concern as unimportant. In the passage, Mara ignored a warning that might have helped her.';
      draft.exampleGroups = [
        {
          meaning: 'Dismiss or ignore someone or something',
          examples: [
            'He brushed off her concerns and changed the subject.',
            'The manager brushed off my suggestion.',
          ],
        },
        {
          meaning: 'Remove something with a brushing movement',
          examples: [
            'She brushed the crumbs off her jacket.',
            'He brushed the snow off his shoulders.',
          ],
        },
      ];
      draft.examples = draft.exampleGroups.flatMap((g) => g.examples);
      view.render();
    });
    await page.screenshot({ path: 'docs/images/editor-fields.png' });
    await page.locator('.cc-context-tools > summary').click();
    await page.getByLabel('Context from your book', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'docs/images/context-answer.png' });
    await page.locator('[data-cc-section=explanation] > summary').click();
    await page.getByRole('button', { name: 'Show examples', exact: true }).click();
    await page.locator('.cc-examples').scrollIntoViewIfNeeded();
    await page.locator('.cc-technical > summary').click();
    await page.getByLabel('Deck', { exact: true }).scrollIntoViewIfNeeded();
    await page.getByLabel('Tags', { exact: true }).scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('.cc-panel-body,#panel,.cc-panel'))
        el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(300);
    const examples = await page.locator('[data-cc-section=examples]').boundingBox();
    const examplesTop = Math.max(0, examples.y);
    await page.screenshot({
      path: 'docs/images/examples-deck.png',
      clip: { x: 0, y: examplesTop, width: 680, height: 1000 - examplesTop },
    });
    await page.locator('.cc-footer').screenshot({ path: 'docs/images/destination.png' });
    await page.getByRole('button', { name: 'Preview cards', exact: true }).click();
    await page.getByRole('button', { name: 'Recognition', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: 'docs/images/recognition.png',
      clip: { x: 0, y: 0, width: 680, height: 550 },
    });
    await page.getByRole('button', { name: 'Recall', exact: true }).click();
    await page.frameLocator('iframe').getByText('Show definition', { exact: true }).click();
    await page
      .frameLocator('iframe')
      .getByRole('textbox', { name: 'Your answer', exact: true })
      .fill('brushed off');
    await page.screenshot({ path: 'docs/images/recall.png' });
    await page.getByRole('button', { name: 'Flip card', exact: true }).click();
    await page
      .frameLocator('iframe')
      .getByText('Meaning in this context', { exact: true })
      .waitFor();
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'docs/images/card-back.png' });
    await page.setViewportSize({ width: 680, height: 800 });
    await page.goto('http://127.0.0.1:4180/?writing=1');
    await page.getByLabel('Writing review', { exact: true }).waitFor();
    await page.evaluate(() => {
      const { session, view } = window.writingPreview;
      session.findings[1].selected = false;
      view.render();
    });
    await page.screenshot({ path: 'docs/images/writing-panel.png' });
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('heading', { name: 'Edit correction', exact: true }).waitFor();
    const editActions = await page.locator('.cc-writing-decisions').boundingBox();
    await page.screenshot({
      path: 'docs/images/writing-edit.png',
      clip: { x: 0, y: 0, width: 680, height: editActions.y + editActions.height + 20 },
    });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Review 1 card', exact: true }).click();
    await page.getByRole('heading', { name: 'Review your cards', exact: true }).waitFor();
    await page.screenshot({ path: 'docs/images/writing-card.png' });
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
