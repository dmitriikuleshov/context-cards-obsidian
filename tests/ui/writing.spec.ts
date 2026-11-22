import { test, expect, type Page } from '@playwright/test';
const button = (p: Page, name: string) => p.getByRole('button', { name, exact: true });
const choice = (p: Page) => p.getByRole('checkbox', { name: 'Create an Anki card', exact: true });
const word = (p: Page, text: string) => p.locator('.cc-writing-word').filter({ hasText: text });
async function selectTwo(p: Page) {
  await choice(p).check();
  await word(p, 'did').click();
  await choice(p).check();
}
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 1050 });
  await page.goto('/?writing=1');
  await page.evaluate(() => {
    const p = (window as any).writingPreview;
    p.session.findings[1].selected = false;
    p.view.show(p.session);
  });
});
test('draft controls adapt to one, multiple and empty drafts during clearing', async ({ page }) => {
  const clear = page.getByRole('button', { name: 'Clear all writing drafts', exact: true });
  await expect(clear).toBeVisible();
  await expect(page.getByLabel('Writing review')).toContainText('My story');
  await page.evaluate(() => {
    const p = (window as any).writingPreview;
    const second = structuredClone(p.session);
    second.id = 'second';
    p.host.writing.sessions.push(second);
    p.controls.deferGenerate = true;
    p.view.render();
  });
  await expect(page.getByLabel('Writing review')).toBeVisible();
  await button(page, 'Review 1 card').click();
  await expect(page.getByRole('status')).toContainText('Preparing');
  await clear.click();
  await expect(
    page.getByText('Select your English writing and choose Find mistakes.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Writing review')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No writing drafts', exact: true })).toBeVisible();
  await expect(clear).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear writing draft', exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('.cc-writing-preview')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).writingPreview.host.writing.sessions)).toEqual(
    [],
  );
});
test('clearing the only draft leaves an empty state without a clearing button', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Clear all writing drafts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No writing drafts', exact: true })).toBeVisible();
  await expect(page.locator('.cc-draft-switcher')).toHaveCount(0);
});
test('Edit and the labeled checkbox change inclusion without navigation or generation', async ({
  page,
}) => {
  await expect(page.locator('.cc-writing-decisions button')).toHaveText(['Edit']);
  await expect(button(page, 'Skip')).toHaveCount(0);
  await expect(button(page, 'Undo')).toHaveCount(0);
  await choice(page).check();
  await expect(choice(page)).toBeChecked();
  await expect(page.getByRole('heading', { name: 'wrote → written', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).writingPreview.session.findings[0].card),
  ).toBeUndefined();
  await expect(word(page, 'wrote')).toHaveClass(/is-kept/);
  await expect(button(page, 'Review 1 card')).toBeEnabled();
  await choice(page).uncheck();
  await expect(choice(page)).toBeVisible();
  await expect(word(page, 'wrote')).not.toHaveClass(/is-kept/);
  await expect(button(page, 'Review cards')).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'wrote → written', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const p = (window as any).writingPreview;
    p.session.findings = p.session.findings.slice(0, 1);
    p.view.show(p.session);
  });
  await choice(page).check();
  await choice(page).uncheck();
  await expect(button(page, 'Finish review')).toBeEnabled();
  await expect(choice(page)).toBeEnabled();
});
test('new analysis defaults to checked grammar/vocabulary, with style excluded', async ({
  page,
}) => {
  await page.goto('/?writing=1');
  await expect(choice(page)).toBeChecked();
  await expect(button(page, 'Review 2 cards')).toBeEnabled();
  await word(page, 'did').click();
  await expect(choice(page)).toBeChecked();
  await word(page, 'stories').click();
  await expect(choice(page)).not.toBeChecked();
  await expect(choice(page)).toBeDisabled();
});
test('an overlapping style finding never masks the capitalization card or gives it a copied title', async ({
  page,
}) => {
  await page.evaluate(() => {
    const p = (window as any).writingPreview,
      s = p.session,
      original = 'I started to learn english a few years ago.';
    const capital = {
      ...s.findings[0],
      id: 'capital',
      kind: 'grammar',
      title: 'Collocation: make a mistake',
      original,
      before: 'english',
      after: 'English',
      explanation: 'Names of languages are capitalized.',
      tip: 'Capitalize language names.',
      selected: true,
    };
    const style = {
      ...capital,
      id: 'style',
      kind: 'style',
      before: 'started to learn english',
      after: 'have started to learn English',
      explanation: 'An unrelated tense suggestion.',
      selected: false,
    };
    s.capture.selected = s.capture.text = original;
    s.findings = [style, capital];
    p.view.show(s);
  });
  await page.locator('.cc-writing-word').filter({ hasText: 'english' }).click();
  await expect(page.getByRole('heading', { name: 'english → English', exact: true })).toBeVisible();
  await expect(
    page.getByText('Names of languages are capitalized.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('An unrelated tense suggestion.', { exact: true })).toHaveCount(0);
  await button(page, 'Review 1 card').click();
  await expect(
    page.getByRole('heading', { name: 'Card 1 · english → English', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.cc-writing-question mark')).toHaveText('english');
  await expect(page.locator('.cc-writing-answer')).toHaveText(
    'I started to learn English a few years ago.',
  );
});
test('word navigation preserves independent choices and exports the selected batch', async ({
  page,
}) => {
  await expect(page.getByLabel('Writing deck', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(1);
  await page.screenshot({ path: '.test-artifacts/writing-panel.png', fullPage: true });
  await selectTwo(page);
  await word(page, 'wrote').click();
  await expect(choice(page)).toBeVisible();
  await button(page, 'Review 2 cards').click();
  await expect(page.locator('.cc-writing-preview')).toHaveCount(2);
  await expect(page.locator('.cc-writing-question mark')).toHaveText(['wrote', 'did']);
  await expect(page.locator('.cc-writing-answer')).toHaveText([
    'I have written three stories this week.',
    'I made a mistake yesterday.',
  ]);
  await button(page, 'Add 2 cards to Anki').click();
  await expect(page.getByRole('heading', { name: 'Added to Anki', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).writingPreview.controls.exports.length)).toBe(2);
  expect(await page.evaluate(() => (window as any).writingPreview.session.capture.selected)).toBe(
    'I have wrote three stories this week. I did a mistake yesterday.',
  );
});
test('editing keeps focus, cancels safely, validates and supports gap cards', async ({ page }) => {
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
  await page.getByLabel('Exercise type').click();
  await page
    .getByRole('menuitemcheckbox', { name: 'Fill in the missing word', exact: true })
    .click();
  await button(page, 'Save changes').click();
  await choice(page).check();
  await button(page, 'Review 1 card').click();
  await expect(page.locator('.cc-writing-question .cc-gap')).toHaveCount(1);
});
test('generation failure keeps choices and retry opens previews', async ({ page }) => {
  await choice(page).check();
  await page.evaluate(() => ((window as any).writingPreview.controls.failGenerate = true));
  await button(page, 'Review 1 card').click();
  await expect(page.getByRole('alert')).toContainText('after retry');
  await expect(word(page, 'wrote')).toHaveClass(/is-kept/);
  await button(page, 'Retry preparing cards').click();
  await expect(page.locator('.cc-writing-preview')).toHaveCount(1);
});
test('prepared fields can be edited without regenerating the correction', async ({ page }) => {
  await choice(page).check();
  await button(page, 'Review 1 card').click();
  await page
    .locator('.cc-writing-preview')
    .getByRole('button', { name: 'Edit card', exact: true })
    .click();
  await page.locator('[data-writing-section=edit-details]>summary').click();
  await page.locator('[data-writing-section=card-fields]>summary').click();
  await page.getByLabel('Card explanation', { exact: true }).fill('My own helpful explanation.');
  await button(page, 'Save changes').click();
  await expect(page.getByText('My own helpful explanation.', { exact: true })).toBeVisible();
});
test('cancellation stays on the correction and preserves the toggle state', async ({ page }) => {
  await choice(page).check();
  await page.evaluate(() => ((window as any).writingPreview.controls.deferGenerate = true));
  await button(page, 'Review 1 card').click();
  await expect(page.getByRole('status')).toContainText('Preparing');
  await button(page, 'Cancel').click();
  await expect(page.getByRole('alert')).toContainText('Cancelled');
  await expect(page.locator('.cc-writing-preview')).toHaveCount(0);
  await expect(choice(page)).toBeEnabled();
});
test('partial export retries only remaining notes and locks successful edits', async ({ page }) => {
  await selectTwo(page);
  await button(page, 'Review 2 cards').click();
  await page.evaluate(() => ((window as any).writingPreview.controls.failExport = true));
  await button(page, 'Add 2 cards to Anki').click();
  await expect(page.getByRole('alert')).toContainText('Cannot connect');
  await expect(page.getByText('✓ Already added', { exact: true })).toBeVisible();
  await expect(
    page
      .locator('.cc-writing-preview')
      .first()
      .getByRole('button', { name: 'Edit card', exact: true }),
  ).toBeDisabled();
  await button(page, 'Retry remaining cards').click();
  const ids = await page.evaluate(() => (window as any).writingPreview.controls.exports);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
});
test('excluding a correction removes it from export and preserves its prepared card for re-inclusion', async ({
  page,
}) => {
  await selectTwo(page);
  await button(page, 'Review 2 cards').click();
  await button(page, '← Corrections').click();
  await word(page, 'did').click();
  await choice(page).uncheck();
  await expect(button(page, 'Review 1 card')).toBeEnabled();
  expect(
    await page.evaluate(() => (window as any).writingPreview.session.findings[1].card),
  ).toBeTruthy();
  await choice(page).check();
  await expect(button(page, 'Review 2 cards')).toBeEnabled();
  await choice(page).uncheck();
  await button(page, 'Review 1 card').click();
  await expect(page.locator('.cc-writing-preview')).toHaveCount(1);
  await button(page, 'Add 1 card to Anki').click();
  expect(
    await page.evaluate(() => (window as any).writingPreview.session.findings[1].noteId),
  ).toBeUndefined();
});
test('editing rejects unrelated whole-sentence replacements without changing the correction', async ({
  page,
}) => {
  await button(page, 'Edit').click();
  await page.locator('[data-writing-section=edit-details]>summary').click();
  const before = await page.getByLabel('Highlighted text', { exact: true }).inputValue();
  await page
    .getByLabel('Highlighted text', { exact: true })
    .fill('I have wrote three stories this week.');
  await page.getByLabel('Correction', { exact: true }).fill('This is good.');
  await button(page, 'Save changes').click();
  await expect(page.getByRole('alert').last()).toContainText('unrelated wording');
  expect(await page.evaluate(() => (window as any).writingPreview.session.findings[0].before)).toBe(
    before,
  );
  await button(page, 'Cancel').click();
});
test('style feedback has two controls with card creation disabled and narrow layout fits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  await word(page, 'stories').click();
  await expect(page.locator('.cc-writing-decisions button')).toHaveText(['Edit']);
  await expect(choice(page)).toBeDisabled();
  await expect(button(page, 'Edit')).toBeEnabled();
  await expect(
    page.getByText('Optional style suggestion. No practice card is needed.'),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
