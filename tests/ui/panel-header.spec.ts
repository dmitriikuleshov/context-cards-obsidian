import { test, expect } from '@playwright/test';

for (const width of [390, 1000]) {
  test(`vocabulary and writing use the same header layout (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    const snapshots = [];
    for (const mode of ['vocabulary', 'writing']) {
      await page.goto(mode === 'writing' ? '/?writing=1' : '/');
      // Blue Topaz can load after plugin styles and reintroduce raised hover shadows.
      await page.addStyleTag({
        content:
          ':root{--input-shadow-hover:inset 0 0 0 1px #888,0 2px 3px #111}button:not(.clickable-icon):hover{box-shadow:var(--input-shadow-hover)}',
      });
      const clear = page.locator('.cc-clear-drafts');
      await clear.hover();
      await expect(clear).toHaveCSS('box-shadow', 'none');
      await expect(clear).toHaveCSS('border-top-width', '0px');
      await page.mouse.move(0, 0);
      await expect(page.locator('.cc-panel-header .cc-brand')).toHaveText('Context Cards');
      await expect(
        page.getByRole('button', { name: 'Open Context Cards settings', exact: true }),
      ).toBeVisible();
      await expect(page.locator('.cc-draft-switcher > .cc-select-button')).toHaveCount(1);
      await expect(page.locator('.cc-clear-drafts')).toHaveText('Clear all');
      await expect(page.getByRole('button', { name: 'Open source', exact: true })).toHaveCount(0);
      if (mode === 'vocabulary') {
        await expect(page.locator('.cc-draft-switcher .cc-select-value')).toHaveText(
          'brush off (The Last Train)',
        );
        const source = page.locator('.cc-draft-switcher .cc-select-source');
        await expect(source).toHaveText('(The Last Train)');
        await expect(source).toHaveCSS('font-size', '12px');
        await expect(source).toHaveCSS('font-weight', '400');
        await expect(page.locator('.cc-source-heading')).toHaveCount(0);
      } else await expect(page.locator('.cc-source-heading > span')).not.toBeEmpty();
      snapshots.push(
        await page.locator('.cc-panel').evaluate((root) => {
          const geometry = (selector: string) => {
            const element = root.querySelector<HTMLElement>(selector)!;
            const rect = element.getBoundingClientRect(),
              style = getComputedStyle(element);
            return {
              height: rect.height,
              width: rect.width,
              padding: style.padding,
              margin: style.margin,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              border: style.border,
              background: style.backgroundColor,
            };
          };
          return {
            order: [...root.children].slice(0, 2).map((el) => el.className),
            header: geometry('.cc-panel-header'),
            brand: geometry('.cc-brand'),
            settings: geometry('.cc-panel-header > button'),
            switcher: geometry('.cc-draft-switcher'),
            picker: geometry('.cc-draft-switcher > .cc-select-button'),
            clear: geometry('.cc-clear-drafts'),
          };
        }),
      );
      const root = (await page.locator('.cc-panel').boundingBox())!,
        source = (await page
          .locator(mode === 'vocabulary' ? '.cc-draft-switcher' : '.cc-source-heading')
          .boundingBox())!;
      await page.screenshot({
        path: `.test-artifacts/header-${mode}-${width}.png`,
        clip: {
          x: root.x,
          y: root.y,
          width: root.width,
          height: source.y + source.height - root.y,
        },
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    expect(snapshots[1]).toEqual(snapshots[0]);
  });
}

test('writing header actions work in both corrections and card preview', async ({ page }) => {
  await page.goto('/?writing=1');
  await page.evaluate(() => {
    const p = (window as any).writingPreview;
    p.controls.settingsOpened = 0;
    p.host.openSettings = () => p.controls.settingsOpened++;
    p.view.render();
  });
  await page.getByRole('button', { name: 'Open Context Cards settings', exact: true }).click();
  expect(await page.evaluate(() => (window as any).writingPreview.controls.settingsOpened)).toBe(1);
  for (const screen of ['corrections', 'preview']) {
    if (screen === 'preview') {
      await page.getByRole('button', { name: 'Review 2 cards', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Review your cards', exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Open source', exact: true })).toHaveCount(0);
    await expect(page.locator('.cc-source-heading')).toHaveText('My story');
    await expect(page.locator('.cc-panel-header .cc-brand')).toHaveText('Context Cards');
    await expect(page.getByLabel('Writing review', { exact: true })).toBeVisible();
  }
});
