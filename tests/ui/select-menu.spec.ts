import { test, expect } from '@playwright/test';
for (const width of [390, 1000]) {
  test(`settings show one control per DropdownComponent, excluding measurement selects (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await page.addStyleTag({
      content: `
      .cc-settings-fixture{padding:16px}
      .cc-settings-fixture .setting-item{display:flex;align-items:center;gap:12px;margin-bottom:12px;padding:12px;border:1px solid var(--background-modifier-border);border-radius:10px}
      .cc-settings-fixture .setting-item-name{flex:1;min-width:0}
      .cc-settings-fixture .setting-item-control{display:flex;min-width:0;max-width:65%}
      .cc-settings-fixture select.is-measuring{position:absolute;visibility:hidden;pointer-events:none}
    `,
    });
    await page.evaluate(async () => {
      const { view, enhanceSelects } = (window as any).contextCardsPreview;
      await view.onClose();
      const root = document.createElement('section');
      root.className = 'cc-settings-fixture';
      document.querySelector('#panel')!.replaceChildren(root);
      const state = { changes: 0, measureChanges: 0 };
      (window as any).dropdownFixtureState = state;
      for (const [name, choices] of [
        ['Context length', ['Balanced', 'Long']],
        ['IPA', ['American', 'British', 'Off']],
        ['Explanation · sentences', ['2', '3']],
      ] as Array<[string, string[]]>) {
        const row = document.createElement('div');
        row.className = 'setting-item';
        const label = document.createElement('div');
        label.className = 'setting-item-name';
        label.textContent = name;
        const control = document.createElement('div');
        control.className = 'setting-item-control';
        const select = document.createElement('select');
        select.className = 'dropdown';
        for (const choice of choices) select.add(new Option(choice, choice));
        const measure = document.createElement('select');
        measure.className = 'dropdown is-measuring';
        measure.setAttribute('aria-hidden', 'true');
        measure.tabIndex = -1;
        measure.add(new Option(choices[0], choices[0]));
        select.addEventListener('change', () => {
          state.changes++;
          measure.options[0]!.textContent = select.selectedOptions[0]!.textContent;
        });
        measure.addEventListener('change', () => state.measureChanges++);
        control.append(select, measure);
        row.append(label, control);
        root.append(row);
      }
      enhanceSelects(root);
      enhanceSelects(root);
    });
    const rows = page.locator('.cc-settings-fixture .setting-item');
    await expect(rows).toHaveCount(3);
    for (const row of await rows.all()) {
      await expect(row.locator('button.cc-select-button')).toHaveCount(1);
      await expect(row.locator('select.is-measuring')).toHaveCount(1);
      await expect(row.locator('select:visible')).toHaveCount(0);
    }
    const context = page.getByRole('button', { name: 'Context length', exact: true });
    await context.click();
    await expect(page.getByRole('menuitemcheckbox')).toHaveCount(2);
    await page.getByRole('menuitemcheckbox', { name: 'Long', exact: true }).click();
    await expect(context).toHaveText('Long');
    expect(await page.evaluate(() => (window as any).dropdownFixtureState)).toEqual({
      changes: 1,
      measureChanges: 0,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.test-artifacts/settings-single-selects-${width}.png` });
  });
}
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
