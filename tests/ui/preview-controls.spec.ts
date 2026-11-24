import { test, expect } from '@playwright/test';

for (const width of [340, 1000]) {
  for (const dark of [false, true]) {
    test(`preview controls stay clear at ${width}px in ${dark ? 'dark' : 'light'} mode`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 850 });
      await page.goto('/');
      if (dark) {
        await page.evaluate(() => {
          document.body.classList.add('theme-dark');
          for (const [key, value] of Object.entries({
            '--background-primary': '#202020',
            '--background-secondary': '#292929',
            '--background-modifier-border': '#414141',
            '--text-normal': '#e5e9df',
            '--text-muted': '#a1aa98',
          }))
            document.documentElement.style.setProperty(key, value);
        });
        await page.addStyleTag({
          content: `
          body.theme-dark, body.theme-dark #panel { background: var(--background-primary); }
          body.theme-dark button, body.theme-dark select, body.theme-dark input {
            background: var(--background-secondary); border-color: var(--background-modifier-border);
          }
        `,
        });
      }
      const views = page.getByRole('group', { name: 'Draft view' });
      const edit = views.getByRole('button', { name: 'Edit draft', exact: true });
      const preview = views.getByRole('button', { name: 'Preview cards', exact: true });
      await expect(edit).toHaveAttribute('aria-pressed', 'true');
      await expect(preview).toHaveAttribute('aria-pressed', 'false');
      for (const control of [edit, preview]) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.height).toBeGreaterThanOrEqual(40);
        expect(bounds.width).toBeGreaterThan(100);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(await control.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('8px');
      }
      await preview.focus();
      await preview.press('Enter');
      await expect(preview).toHaveAttribute('aria-pressed', 'true');
      await expect(edit).toHaveAttribute('aria-pressed', 'false');
      await expect(preview).toBeFocused();
      expect(await edit.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
        await preview.evaluate((el) => getComputedStyle(el).backgroundColor),
      );
      await edit.click();
      await expect(edit).toBeFocused();
      await expect(edit).toHaveAttribute('aria-pressed', 'true');
      await preview.click();
      const modes = page.getByRole('group', { name: 'Card type' });
      const recognition = modes.getByRole('button', { name: 'Recognition', exact: true });
      const recall = modes.getByRole('button', { name: 'Recall', exact: true });
      const card = page.locator('.cc-preview-card');
      const flip = card.getByRole('button', { name: 'Flip card', exact: true });
      const frame = page.frameLocator('iframe');
      await expect(recognition).toHaveAttribute('aria-pressed', 'true');
      await expect(recall).toHaveAttribute('aria-pressed', 'false');
      await expect(modes.getByRole('button')).toHaveCount(2);
      await expect(flip).toBeVisible();
      await expect(card.locator('.cc-preview-side')).toHaveText('Question');
      expect(await recognition.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
        await recall.evaluate((el) => getComputedStyle(el).backgroundColor),
      );
      expect(
        await recognition.evaluate((el) => getComputedStyle(el, '::before').content),
      ).toContain('✓');
      await recall.click();
      await expect(recall).toHaveAttribute('aria-pressed', 'true');
      await expect(recognition).toHaveAttribute('aria-pressed', 'false');
      await expect(frame.locator('.cc-gap')).toHaveCount(1);
      await expect(frame.getByRole('textbox', { name: 'Your answer' })).toBeVisible();
      await flip.focus();
      await page.keyboard.press('Enter');
      await expect(card.locator('.cc-preview-side')).toHaveText('Answer');
      await expect(frame.locator('.cc-expression')).toHaveText('brushed off');
      await expect(flip).toBeFocused();
      await expect(recall).toHaveAttribute('aria-pressed', 'true');
      await recognition.click();
      await expect(card.locator('.cc-preview-side')).toHaveText('Question');
      await expect(recognition).toHaveAttribute('aria-pressed', 'true');
      await expect(frame.locator('.cc-expression')).toHaveText('brush off');
      const header = (await card.locator('.cc-preview-card-header').boundingBox())!;
      const button = (await flip.boundingBox())!;
      const iframe = (await card.locator('iframe').boundingBox())!;
      expect(button.y).toBeGreaterThanOrEqual(header.y);
      expect(button.y + button.height).toBeLessThanOrEqual(iframe.y + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `.test-artifacts/preview-controls-${width}-${dark ? 'dark' : 'light'}.png`,
      });
    });
  }
}
