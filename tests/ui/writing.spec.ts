import { test, expect } from '@playwright/test';
test('writing selection, reviewed card and export remain separate deliberate actions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 440, height: 1000 });
  await page.goto('/?writing=1');
  await expect(page.getByRole('heading', { name: 'Grammar · Past participle' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Create a practice card' })).toHaveCount(1);
  await expect(page.getByRole('checkbox', { name: 'Create a practice card' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Create a practice card' }).check();
  await page.getByRole('button', { name: 'Prepare 1 card', exact: true }).click();
  await expect(page.getByLabel('Answer', { exact: true })).toHaveValue('written');
  await expect(
    page.getByRole('button', { name: 'Save review & add 1 card', exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: '.test-artifacts/writing-panel.png', fullPage: true });
  await page.getByRole('button', { name: 'Save review & add 1 card', exact: true }).click();
  await expect(page.getByText('Added to Anki.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).writingPreview.session.capture.selected)).toBe(
    'I have wrote three stories this week.',
  );
});
test('editing a correction invalidates its exercise and gap cards preview correctly', async ({
  page,
}) => {
  await page.setViewportSize({ width: 340, height: 850 });
  await page.goto('/?writing=1');
  await page.getByRole('checkbox', { name: 'Create a practice card' }).check();
  await page.getByLabel('Card format: Past participle', { exact: true }).selectOption('gap');
  await page.getByRole('button', { name: 'Prepare 1 card', exact: true }).click();
  await expect(page.getByLabel('Question', { exact: true })).toHaveValue(
    'I have [[gap]] three stories this week.',
  );
  await page.getByLabel('Replace with', { exact: true }).first().fill('written again');
  await expect(page.getByLabel('Question', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Save review & add 1 card', exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
