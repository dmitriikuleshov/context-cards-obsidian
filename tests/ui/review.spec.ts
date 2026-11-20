import { test, expect } from '@playwright/test';
test('compact sections retain all fields and context editing actions', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 850 });
  await page.goto('/');
  await page.locator('[data-cc-section=explanation] > summary').click();
  await page.locator('[data-cc-section=examples] > summary').click();
  for (const name of [
    'Grammar',
    'American IPA',
    'Usage example 1',
    'Usage example 5',
    'Usage notes',
  ])
    await expect(page.getByLabel(name, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Deck', { exact: true })).toBeVisible();
  await page.locator('.cc-technical > summary').click();
  await page.getByLabel('Deck', { exact: true }).fill('English::Books::Shared');
  await page.getByLabel('Tags', { exact: true }).fill('reading');
  await page.evaluate(() => (window as any).contextCardsPreview.view.render());
  await expect(page.getByLabel('Deck', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Deck', { exact: true })).toHaveValue('English::Books::Shared');
  await expect(page.getByLabel('Tags', { exact: true })).toHaveValue('reading');
  await page.locator('.cc-context-tools > summary').click();
  const context = page.getByLabel('Context from your book', { exact: true });
  await context.evaluate((node) => {
    const text = node as HTMLTextAreaElement;
    const start = text.value.indexOf('warning');
    text.focus();
    text.setSelectionRange(start, start + 7);
  });
  await page.getByRole('button', { name: 'Use selection as answer', exact: true }).click();
  await expect(page.locator('.cc-context-tools > summary')).toHaveText('Answer: warning');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.test-artifacts/compact-narrow.png', fullPage: true });
  await context.fill(
    'Mara brushed off the warning. ' + 'A long passage from the book. '.repeat(100),
  );
  expect((await context.boundingBox())!.height).toBeLessThanOrEqual(241);
});
test('clears all drafts from the top of the panel', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Clear all drafts', exact: true }).click();
  await expect(page.getByLabel('Choose a draft')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Keep the words worth keeping.' })).toBeVisible();
});
test('review, edit and both expandable hints work in a real browser', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByLabel('Word or expression', { exact: true })).toHaveValue('brush off');
  await page.locator('[data-cc-section=explanation] > summary').click();
  await page.getByLabel('Explanation', { exact: true }).fill('Mara dismissed the warning.');
  await page.getByRole('button', { name: 'Preview cards', exact: true }).click();
  const card = page.frameLocator('iframe');
  await expect(card.getByText('Mara', { exact: false })).toBeHidden();
  await card.getByText('Show context', { exact: true }).click();
  await expect(card.locator('mark')).toHaveText('brushed off');
  await page.getByRole('button', { name: 'Recall', exact: true }).click();
  await expect(card.locator('.cc-gap')).toHaveCount(1);
  await expect(
    card.getByText('to dismiss something without considering it seriously', { exact: true }),
  ).toBeHidden();
  await card.getByText('Show definition', { exact: true }).click();
  await expect(
    card.getByText('to dismiss something without considering it seriously', { exact: true }),
  ).toBeVisible();
  await card.getByRole('textbox', { name: 'Your answer', exact: true }).fill('brushed off');
  await page.getByRole('button', { name: 'Flip card', exact: true }).click();
  await expect(card.locator('.cc-expression')).toHaveText('brushed off');
  await expect(card.getByText('Mara dismissed the warning.', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.test-artifacts/recall-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await page.screenshot({ path: '.test-artifacts/edit-draft.png', fullPage: true });
  await page.getByRole('button', { name: 'Add to Anki', exact: true }).click();
  await expect(page.getByText('Two cards added to Anki.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('regeneration preserves edits until accepted, including in a narrow sidebar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('[data-cc-section=explanation] > summary').click();
  await page.getByLabel('Explanation', { exact: true }).fill('My own explanation.');
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(page.getByLabel('Explanation', { exact: true })).toHaveValue('My own explanation.');
  await expect(page.getByRole('button', { name: 'Add to Anki', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep my draft', exact: true }).click();
  await expect(page.getByLabel('Explanation', { exact: true })).toHaveValue('My own explanation.');
  await expect(page.getByRole('button', { name: 'Add to Anki', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('grouped examples stay editable and appear on the card back', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 850 });
  await page.goto('/');
  await page.evaluate(() => {
    const { draft, view } = (window as any).contextCardsPreview;
    draft.exampleGroups = [
      {
        meaning: 'Dismiss a concern',
        examples: ['She brushed off the warning.', 'He brushed off my advice.'],
      },
      {
        meaning: 'Remove by brushing',
        examples: ['She brushed off the dust.', 'He brushed off the crumbs.'],
      },
    ];
    view.render();
  });
  await page.locator('[data-cc-section=examples] > summary').click();
  await page.getByLabel('Meaning / usage 2', { exact: true }).fill('Remove dust or dirt');
  await page.getByLabel('Usage 2, example 1', { exact: true }).fill('She brushed off the dirt.');
  await expect(page.getByLabel('Meaning / usage 2', { exact: true })).toHaveValue(
    'Remove dust or dirt',
  );
  await page.screenshot({ path: '.test-artifacts/grouped-examples.png', fullPage: true });
  await page.getByRole('button', { name: 'Preview cards', exact: true }).click();
  await page.getByRole('button', { name: 'Flip card', exact: true }).click();
  const card = page.frameLocator('iframe');
  await expect(card.getByText('Remove dust or dirt', { exact: true })).toBeVisible();
  await expect(card.getByText('She brushed off the dirt.', { exact: true })).toBeVisible();
});

test('disabled fields disappear from editor and preview while recall keeps its gap', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const { host, view } = (window as any).contextCardsPreview;
    host.settings.fields = {
      ...host.settings.fields,
      grammar: false,
      ipa: 'off',
      meaningSentences: 0,
      generalMeaningSentences: 0,
      wordFormation: false,
      context: false,
      explanationSentences: 0,
      examples: false,
    };
    view.render();
  });
  for (const name of [
    'Grammar',
    'American IPA',
    'Meaning in this context',
    'General meaning',
    'Word formation',
    'Context from your book',
    'Explanation',
    'Usage example 1',
  ])
    await expect(page.getByLabel(name, { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Preview cards', exact: true }).click();
  const card = page.frameLocator('iframe');
  await expect(card.getByText('Show context', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Recall', exact: true }).click();
  await expect(card.locator('.cc-gap')).toHaveCount(1);
  await expect(card.getByText('Show definition', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Flip card', exact: true }).click();
  await expect(card.getByText('Explanation', { exact: true })).toHaveCount(0);
  await expect(card.getByText('Usage examples', { exact: true })).toHaveCount(0);
});

test('opening teaching sections reveals their content above the footer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto('/');
  for (const key of ['explanation', 'examples']) {
    const summary = page.locator(`[data-cc-section=${key}] > summary`);
    await summary.click();
    const section = page.locator(`[data-cc-section=${key}]`);
    await expect
      .poll(async () => {
        const rect = await section.boundingBox();
        const footer = await page.locator('.cc-footer').boundingBox();
        return !!rect && !!footer && rect.y >= -2 && rect.y + 100 < footer.y;
      })
      .toBe(true);
  }
  await expect(page.locator('.cc-destination-tools')).toHaveCSS('border-top-width', '0px');
  await page.screenshot({ path: '.test-artifacts/expanded-section-scroll.png' });
});
