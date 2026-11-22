import { test, expect } from '@playwright/test';
for (const dark of [false, true]) {
  test(`themed dropdowns fit narrow panes and support the keyboard (${dark ? 'dark' : 'light'})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 340, height: 620 });
    await page.goto('/?writing=1');
    if (dark) {
      await page.addStyleTag({
        content:
          ':root{--background-primary:#1e1e1e;--background-secondary:#252525;--background-primary-alt:#292929;--background-modifier-border:#414141;--text-normal:#ddd;--text-muted:#aaa}#panel{background:var(--background-primary);color:var(--text-normal)}',
      });
    }
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('[data-writing-section=edit-details]>summary').click();
    const category = page.getByLabel('Finding category', { exact: true });
    await category.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(
      page.getByRole('menuitemcheckbox', { name: 'grammar', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(340);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(620);
    await page.screenshot({ path: `.test-artifacts/dropdown-${dark ? 'dark' : 'light'}.png` });
    await page.keyboard.press('Escape');
    await expect(category).toBeFocused();
    await category.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(category).toHaveText('vocabulary');
    await expect(menu).toHaveCount(0);
    await page.evaluate(() => (window as any).writingPreview.view.render());
    await expect(category).toHaveText('vocabulary');
    await expect(category).toBeFocused();
    await category.click();
    await page.getByRole('heading', { name: 'Edit correction', exact: true }).click();
    await expect(menu).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
test('draft chooser uses the same menu and long titles wrap without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 680 });
  await page.goto('/?writing=1');
  await page.evaluate(() => {
    const p = (window as any).writingPreview;
    const next = structuredClone(p.session);
    next.id = 'second';
    next.capture.book = 'A very long book title with many words '.repeat(7);
    p.host.writing.sessions.push(next);
    p.view.render();
  });
  await page.getByLabel('Writing review', { exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox')).toHaveCount(2);
  const bounds = (await page.getByRole('menu').boundingBox())!;
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await page.getByRole('menuitemcheckbox').last().click();
  await expect(page.getByLabel('Writing review', { exact: true })).toContainText(
    'A very long book title',
  );
  await expect(page.getByRole('menu')).toHaveCount(0);
});
test('deck suggestions use the theme and still allow a new deck name', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto('/?writing=1');
  await page.evaluate(() => {
    const p = (window as any).writingPreview;
    p.host.deckNames = ['English::Writing mistakes', 'English::Books::New book'];
    p.view.render();
  });
  const input = page.getByLabel('Writing deck', { exact: true });
  await input.fill('writing');
  const option = page.getByRole('option', { name: 'English::Writing mistakes', exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await expect(input).toHaveValue('English::Writing mistakes');
  expect(await page.evaluate(() => (window as any).writingPreview.session.deck)).toBe(
    'English::Writing mistakes',
  );
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await input.fill('English::A brand new deck');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).writingPreview.session.deck)).toBe(
    'English::A brand new deck',
  );
  await expect(input).not.toHaveAttribute('list', /.+/);
});
