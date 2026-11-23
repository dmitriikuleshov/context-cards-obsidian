import { test, expect } from '@playwright/test';
import { callbackPage } from '../../src/chatgpt-callback-page';

for (const colorScheme of ['dark', 'light'] as const) {
  for (const width of [360, 1200]) {
    test(`sign-in callback is readable in ${colorScheme} mode at ${width}px`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 800 });
      await page.route('**/callback-preview', (route) =>
        route.fulfill({ contentType: 'text/html', body: callbackPage('received') }),
      );
      await page.goto('/callback-preview');
      await expect(page.getByRole('heading', { name: 'Return to Obsidian' })).toBeVisible();
      await expect(page.getByText('Authorization received', { exact: true })).toBeVisible();
      await expect(page.getByText('You can close this tab.', { exact: false })).toBeVisible();
      const layout = await page.evaluate(() => {
        const main = document.querySelector('main')!;
        const text = getComputedStyle(document.querySelector('.message')!);
        return {
          fits: document.documentElement.scrollWidth <= innerWidth,
          bottom: main.getBoundingClientRect().bottom,
          foreground: text.color,
          background: getComputedStyle(main).backgroundColor,
        };
      });
      expect(layout.fits).toBe(true);
      expect(layout.bottom).toBeLessThanOrEqual(800);
      const luminance = (rgb: string) => {
        const channels = rgb
          .match(/\d+/g)!
          .slice(0, 3)
          .map(Number)
          .map((n) => {
            const c = n / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      };
      const values = [luminance(layout.foreground), luminance(layout.background)].sort(
        (a, b) => a - b,
      );
      expect((values[1]! + 0.05) / (values[0]! + 0.05)).toBeGreaterThanOrEqual(4.5);
      if (width === 1200)
        await page.screenshot({ path: `.test-artifacts/chatgpt-callback-${colorScheme}.png` });
    });
  }
}
