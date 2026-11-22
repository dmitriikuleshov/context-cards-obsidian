import { test, expect } from '@playwright/test';

test('narrow picker makes the exact target explicit and fits a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 740 });
  await page.goto('/?target-picker');
  const dialog = page.getByRole('dialog'),
    text = dialog.getByRole('textbox');
  await expect(dialog.getByRole('heading', { name: 'Choose what to learn' })).toBeVisible();
  await expect(text).toHaveAttribute('aria-readonly', 'true');
  await expect(dialog.getByRole('button', { name: 'Create cards', exact: true })).toBeDisabled();
  await text.focus();
  await text.press('Control+End');
  for (let i = 0; i < 4; i++) await text.press('Shift+ArrowLeft');
  await expect(dialog.getByRole('status')).toHaveText('good');
  await expect(dialog.getByRole('button', { name: 'Create cards', exact: true })).toBeEnabled();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '.test-artifacts/target-picker-narrow.png' });
  await dialog.getByRole('button', { name: 'Create cards', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const choice = await page.evaluate(() => (window as any).contextCardsPreview.targetChoice);
  expect(choice.selected).toBe('good');
  expect(choice.text.slice(choice.start, choice.end)).toBe('good');
  expect(choice.text).toContain('hand-written');
});
test('a long idiom can be kept whole and Escape cancels a later choice', async ({ page }) => {
  await page.goto('/');
  const idiom = 'You cannot have your cake and eat it too';
  await page.evaluate((value) => (window as any).openTargetPicker(value), idiom);
  await page.getByRole('button', { name: 'Use whole phrase', exact: true }).click();
  expect(await page.evaluate(() => (window as any).contextCardsPreview.targetChoice.selected)).toBe(
    idiom,
  );
  await page.evaluate(() =>
    (window as any).openTargetPicker('Another sentence. A different word.'),
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).contextCardsPreview.targetChoice)).toBeNull();
});
test('an old passage draft has an obvious recovery action and cannot be exported', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const { draft, view } = (window as any).contextCardsPreview;
    draft.answer = 'This is a sentence. Another sentence follows.';
    draft.context = draft.answer;
    draft.answerStart = 0;
    view.render();
  });
  await expect(page.getByRole('button', { name: 'Add to Anki', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Choose word or phrase', exact: true }).click();
  const text = page.getByRole('dialog').getByRole('textbox');
  await text.evaluate((el) => {
    const t = el as HTMLTextAreaElement;
    const start = t.value.indexOf('sentence');
    t.setSelectionRange(start, start + 8);
    t.dispatchEvent(new Event('select'));
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Create cards', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).contextCardsPreview.draft.answer)).toBe(
    'sentence',
  );
  await expect(page.getByRole('button', { name: 'Add to Anki', exact: true })).toBeDisabled();
});
