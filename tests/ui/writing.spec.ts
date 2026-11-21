import { test, expect } from '@playwright/test';
test('writing follows Create, Preview and Add without extra visible fields', async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 1000 });
  await page.goto('/?writing=1');
  await expect(page.getByLabel('Choose a correction', { exact: true })).toHaveCount(1);
  await expect(page.getByLabel('Correction', { exact: true })).toHaveValue('written');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByLabel('Tip', { exact: true })).toBeHidden();
  await expect(page.getByLabel('Writing deck', { exact: true })).toBeHidden();
  await page.evaluate(() => {
    const second = (window as any).writingPreview.session.findings[1];
    second.kind = 'grammar';
    second.selected = true;
  });

  await page.getByRole('button', { name: 'Create card', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add to Anki', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Preview writing card', exact: true }).click();

  const card = page.frameLocator('iframe');
  await expect(card.locator('mark')).toHaveText('wrote');
  await page.getByRole('button', { name: 'Flip card', exact: true }).click();
  await expect(
    card.getByText('I have written three stories this week.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit writing review', exact: true }).click();
  await page.screenshot({ path: '.test-artifacts/writing-panel.png', fullPage: true });
  await page.getByRole('button', { name: 'Preview card', exact: true }).click();
  await page.getByRole('button', { name: 'Add to Anki', exact: true }).click();
  await expect(page.getByText('Added to Anki.', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).writingPreview.session.findings[1].noteId),
  ).toBeUndefined();
  await expect(page.getByRole('button', { name: 'Next correction', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).writingPreview.session.capture.selected)).toBe(
    'I have wrote three stories this week.',
  );
});
test('typing keeps the same input, focus and expanded sections', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 850 });
  await page.goto('/?writing=1');
  await page.locator('[data-writing-section=advanced] > summary').click();
  const input = page.getByLabel('Correction', { exact: true });
  await input.evaluate((el) => el.setAttribute('data-stable-input', 'yes'));
  await input.fill('');
  await input.pressSequentially('written again', { delay: 15 });
  await expect(input).toHaveValue('written again');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('data-stable-input', 'yes');
  await expect(page.locator('[data-writing-section=advanced]')).toHaveAttribute('open', '');
  await expect(page.locator('.cc-writing-correction')).toHaveText(
    'I have written again three stories this week.',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('gap preview works and editing its correction invalidates only that card', async ({
  page,
}) => {
  await page.goto('/?writing=1');

  await page.locator('[data-writing-section=advanced] > summary').click();
  await page.getByLabel('Card format: Past participle', { exact: true }).selectOption('gap');
  await page.getByRole('button', { name: 'Create card', exact: true }).click();
  await page.getByRole('button', { name: 'Preview writing card', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('.cc-gap')).toHaveCount(1);
  await page.getByRole('button', { name: 'Edit writing review', exact: true }).click();
  await page.getByLabel('Correction', { exact: true }).fill('written again');
  await expect(page.getByLabel('Question', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create card', exact: true })).toBeEnabled();
});
