import { test, expect, type Page } from '@playwright/test';
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 1050 });
  await page.goto('/?writing=1');
});
test('Skip on the only suggestion completes the review, Undo restores it, and Keep completes it too', async ({
  page,
}) => {
  await page.evaluate(() => {
    const p = (window as any).writingPreview;
    p.session.findings = p.session.findings.slice(0, 1);
    p.view.show(p.session);
  });
  await expect(button(page, 'Skip')).toBeEnabled();
  await button(page, 'Skip').click();
  expect(
    await page.evaluate(() => (window as any).writingPreview.session.findings[0].dismissed),
  ).toBe(true);
  await expect(
    page.getByRole('heading', { name: 'All corrections reviewed', exact: true }),
  ).toBeVisible();
  await expect(button(page, 'Skip')).toHaveCount(0);
  await expect(button(page, 'Finish review')).toBeEnabled();
  await expect(page.getByText('0 cards selected · 1 skipped.', { exact: true })).toBeVisible();
  await button(page, 'Undo').click();
  await expect(button(page, 'Skip')).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).writingPreview.session.findings[0].dismissed),
  ).toBe(false);
  await button(page, 'Keep & next').click();
  await expect(page.getByText('1 card selected · 0 skipped.', { exact: true })).toBeVisible();
  await expect(button(page, 'Review 1 card')).toBeEnabled();
});
test('a skipped suggestion can be revisited without offering a second no-op Skip', async ({
  page,
}) => {
  const mark = page.locator('.cc-writing-word').filter({ hasText: 'wrote' });
  await button(page, 'Skip').click();
  await mark.click();
  await expect(button(page, 'Skip')).toHaveCount(0);
  await expect(button(page, 'Keep & next')).toBeEnabled();
  await button(page, 'Keep & next').click();
  expect(
    await page.evaluate(() => (window as any).writingPreview.session.findings[0].selected),
  ).toBe(true);
});
test('highlight, keep, undo, skip and batch preview follow the approved design', async ({
  page,
}) => {
  await expect(page.getByRole('textbox')).toBeHidden();
  await expect(button(page, 'Review cards')).toBeDisabled();
  await page.screenshot({ path: '.test-artifacts/writing-panel.png', fullPage: true });
  await button(page, 'Keep & next').click();
  await expect(page.locator('.cc-writing-word.is-kept')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Make a mistake', exact: true })).toBeVisible();
  await button(page, 'Undo').click();
  await expect(page.locator('.cc-writing-word.is-kept')).toHaveCount(0);
  await button(page, 'Keep & next').click();
  await button(page, 'Keep & next').click();
  await button(page, 'Skip').click();
  await expect(page.locator('.cc-writing-word.is-skipped')).toHaveCount(1);
  await button(page, 'Review 2 cards').click();
  await expect(page.locator('.cc-writing-preview')).toHaveCount(2);
  await expect(page.locator('.cc-writing-question mark')).toHaveText(['wrote', 'did']);
  await expect(page.locator('.cc-writing-answer')).toHaveText([
    'I have written three stories this week.',
    'I made a mistake yesterday.',
  ]);
  await button(page, 'Add 2 cards to Anki').click();
  await expect(page.getByRole('heading', { name: 'Added to Anki' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).writingPreview.controls.exports.length)).toBe(2);
  expect(await page.evaluate(() => (window as any).writingPreview.session.capture.selected)).toBe(
    'I have wrote three stories this week. I did a mistake yesterday.',
  );
});
test('editing is explicit, keeps focus, validates and cancel discards changes', async ({
  page,
}) => {
  await button(page, 'Edit').click();
  const input = page.getByLabel('Correction', { exact: true });
  await input.evaluate((el) => el.setAttribute('data-stable', 'yes'));
  await input.fill('');
  await input.pressSequentially('written again', { delay: 10 });
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('data-stable', 'yes');
  await button(page, 'Cancel').click();
  expect(await page.evaluate(() => (window as any).writingPreview.session.findings[0].after)).toBe(
    'written',
  );
  await button(page, 'Edit').click();
  await input.fill('wrote');
  await button(page, 'Save changes').click();
  await expect(page.getByRole('alert').last()).toContainText('must change');
  await input.fill('written');
  await page.locator('[data-writing-section=edit-details]>summary').click();
  await page.getByLabel('Exercise type').selectOption('gap');
  await button(page, 'Save changes').click();
  await button(page, 'Keep & next').click();
  await button(page, 'Review 1 card').click();
  await expect(page.locator('.cc-writing-question .cc-gap')).toHaveCount(1);
  await page
    .locator('.cc-writing-preview')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await input.fill('written again');
  await button(page, 'Save changes').click();
  expect(
    await page.evaluate(() => (window as any).writingPreview.session.findings[0].card),
  ).toBeUndefined();
  await expect(button(page, 'Review 1 card')).toBeVisible();
});
test('generation failures preserve choices and retry opens previews', async ({ page }) => {
  await button(page, 'Keep & next').click();
  await page.evaluate(() => ((window as any).writingPreview.controls.failGenerate = true));
  await button(page, 'Review 1 card').click();
  await expect(page.getByRole('alert')).toContainText('after retry');
  await expect(page.locator('.cc-writing-word.is-kept')).toHaveCount(1);
  await button(page, 'Retry preparing cards').click();
  await expect(page.locator('.cc-writing-preview')).toHaveCount(1);
});
test('prepared card fields can be edited without regenerating the correction', async ({ page }) => {
  await button(page, 'Keep & next').click();
  await button(page, 'Review 1 card').click();
  await page
    .locator('.cc-writing-preview')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await page.locator('[data-writing-section=edit-details]>summary').click();
  await page.locator('[data-writing-section=card-fields]>summary').click();
  await page.getByLabel('Card explanation', { exact: true }).fill('My own helpful explanation.');
  await button(page, 'Save changes').click();
  await button(page, 'Review 1 card').click();
  await expect(page.getByText('My own helpful explanation.', { exact: true })).toBeVisible();
});
test('cancellation does not advance to previews or accept late results', async ({ page }) => {
  await button(page, 'Keep & next').click();
  await page.evaluate(() => ((window as any).writingPreview.controls.deferGenerate = true));
  await button(page, 'Review 1 card').click();
  await expect(page.getByRole('status')).toContainText('Preparing');
  await button(page, 'Cancel').click();
  await expect(page.getByRole('alert')).toContainText('Cancelled');
  await expect(page.locator('.cc-writing-preview')).toHaveCount(0);
  await expect(button(page, 'Keep & next')).toBeEnabled();
});
test('partial Anki failure retries only missing cards and locks exported edits', async ({
  page,
}) => {
  await button(page, 'Keep & next').click();
  await button(page, 'Keep & next').click();
  await button(page, 'Review 2 cards').click();
  await page.evaluate(() => ((window as any).writingPreview.controls.failExport = true));
  await button(page, 'Add 2 cards to Anki').click();
  await expect(page.getByRole('alert')).toContainText('Cannot connect');
  await expect(page.getByText('✓ Already added', { exact: true })).toBeVisible();
  await expect(
    page.locator('.cc-writing-preview').first().getByRole('button', { name: 'Edit', exact: true }),
  ).toBeDisabled();
  await button(page, 'Retry remaining cards').click();
  await expect(page.getByRole('heading', { name: 'Added to Anki' })).toBeVisible();
  const ids = await page.evaluate(() => (window as any).writingPreview.controls.exports);
  expect(new Set(ids).size).toBe(2);
  expect(ids).toHaveLength(2);
});
test('removing a preview changes the export batch and all-skipped review can finish', async ({
  page,
}) => {
  await button(page, 'Keep & next').click();
  await button(page, 'Keep & next').click();
  await button(page, 'Review 2 cards').click();
  await page
    .locator('.cc-writing-preview')
    .last()
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
  await expect(page.locator('.cc-writing-preview')).toHaveCount(1);
  await expect(button(page, 'Add 1 card to Anki')).toBeEnabled();
  await button(page, '← Corrections').click();
  await page.locator('.cc-writing-word').filter({ hasText: 'wrote' }).click();
  await button(page, 'Remove from cards').click();
  await button(page, 'Skip').click();
  await button(page, 'Skip').click();
  await button(page, 'Finish review').click();
  await expect(page.getByRole('heading', { name: 'Review finished' })).toBeVisible();
});
test('optional style has no Keep action and narrow sidebar does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.locator('.cc-writing-word').filter({ hasText: 'stories' }).click();
  await expect(button(page, 'Keep & next')).toHaveCount(0);
  await expect(
    page.getByText('Optional style suggestion. No practice card is needed.'),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
