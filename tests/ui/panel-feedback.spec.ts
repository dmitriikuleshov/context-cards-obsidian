import { test, expect } from '@playwright/test';

for (const mode of ['vocabulary', 'writing']) {
  for (const width of [340, 740]) {
    test(`new and repeated ${mode} errors reveal the top without hijacking ordinary redraws (${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto(mode === 'writing' ? '/?writing=1' : '/');
      await page.evaluate((mode) => {
        const p = (window as any)[mode === 'writing' ? 'writingPreview' : 'contextCardsPreview'];
        const d = p.session ?? p.draft;
        if (p.session)
          p.session.capture.selected += '\nMore selected writing to review. '.repeat(80);
        d.error = '';
        p.view.render();
        const owner = () =>
          p.session
            ? p.view.contentEl.querySelector('.cc-panel-body')
            : p.view.contentEl.parentElement;
        (window as any).errorScroll = { p, d, owner };
        owner().scrollTop = owner().scrollHeight;
      }, mode);
      const position = () => page.evaluate(() => (window as any).errorScroll.owner().scrollTop);
      expect(await position()).toBeGreaterThan(100);
      await page.evaluate(() => {
        const { p, d } = (window as any).errorScroll;
        d.error = 'Cannot connect to 127.0.0.1:8765. Start the local server and try again.';
        p.view.render();
      });
      expect(await position()).toBe(0);
      await expect(page.locator('.cc-error-title')).toBeInViewport();
      await page.evaluate(() => {
        const s = (window as any).errorScroll;
        s.owner().scrollTop = 120;
        s.p.view.render();
      });
      expect(await position()).toBe(120);
      await page.evaluate((mode) => {
        const s = (window as any).errorScroll;
        s.d.phase = mode === 'writing' ? 'exporting' : 'sending';
        s.p.view.render();
      }, mode);
      expect(await position()).toBe(120);
      await page.evaluate((mode) => {
        const { p, d } = (window as any).errorScroll;
        d.phase = mode === 'writing' ? 'idle' : 'editing';
        p.view.render();
      }, mode);
      expect(await position()).toBe(0);
      await expect(page.locator('.cc-error-title')).toBeInViewport();
      await page.screenshot({ path: `.test-artifacts/error-scroll-${mode}-${width}.png` });
    });
  }
}

test('a correction validation error appears at the top of its editor', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 600 });
  await page.goto('/?writing=1');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Correction', { exact: true }).fill('wrote');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toBeInViewport();
  expect(await page.locator('.cc-panel-body').evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.getByRole('alert')).toContainText('must change');
});

for (const width of [340, 740]) {
  test(`writing footer keeps its position through first analysis and preparation (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/?writing=1');
    const footer = page.locator('.cc-footer');
    const ready = (await footer.boundingBox())!;
    for (const phase of ['analysing', 'idle', 'generating', 'exporting']) {
      await page.evaluate((phase) => {
        const p = (window as any).writingPreview;
        p.session.phase = phase;
        p.session.analysed = phase !== 'analysing';
        p.view.render();
      }, phase);
      const bounds = (await footer.boundingBox())!;
      expect(bounds.y).toBeCloseTo(ready.y, 0);
      expect(bounds.height).toBeCloseTo(ready.height, 0);
      const primary = page.locator('.cc-writing-footer-actions > button.mod-cta');
      await expect(primary).toBeVisible();
      if (phase !== 'idle') {
        await expect(primary).toBeDisabled();
        await expect(page.getByLabel('Writing deck', { exact: true })).toBeDisabled();
      }
      if (phase === 'analysing') {
        await expect(primary).toHaveText('Find mistakes');
        await page.screenshot({ path: `.test-artifacts/footer-analysing-${width}.png` });
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

for (const dark of [false, true]) {
  test(`both modes explain the same Anki error with matching alert styles (${dark ? 'dark' : 'light'})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 850 });
    const styles = [];
    for (const mode of ['vocabulary', 'writing']) {
      await page.goto(mode === 'writing' ? '/?writing=1' : '/');
      if (dark)
        await page.addStyleTag({
          content:
            ':root{--background-primary:#1e1e1e;--background-secondary:#252525;--background-modifier-hover:#333;--text-normal:#ddd;--text-muted:#aaa}#panel{background:var(--background-primary)}',
        });
      await page.evaluate((mode) => {
        const p = (window as any)[mode === 'writing' ? 'writingPreview' : 'contextCardsPreview'];
        const draft = p.session ?? p.draft;
        draft.error = 'Cannot connect to 127.0.0.1:8765. Start the local server and try again.';
        p.view.render();
      }, mode);
      const alert = page.getByRole('alert');
      await expect(alert).toBeVisible();
      await expect(alert.locator('.cc-error-title')).toHaveText('Cannot connect to AnkiConnect');
      await expect(alert.locator('.cc-error-message')).toContainText('Anki desktop app');
      const technical = alert.locator('.cc-error-details');
      await expect(technical).not.toHaveAttribute('open');
      await technical.locator('summary').click();
      await expect(technical.locator('p')).toContainText('127.0.0.1:8765');
      styles.push(
        await alert.evaluate((el) => {
          const s = getComputedStyle(el);
          return [s.backgroundColor, s.color, s.border, s.borderRadius, s.padding, s.fontSize];
        }),
      );
      await page.screenshot({
        path: `.test-artifacts/feedback-${mode}-${dark ? 'dark' : 'light'}.png`,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    expect(styles[1]).toEqual(styles[0]);
  });
}

test('error details are rendered as text and do not execute model or server markup', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const p = (window as any).contextCardsPreview;
    p.draft.error = 'Invalid JSON: <img src=x onerror="window.feedbackInjected=true">';
    p.view.render();
  });
  const alert = page.getByRole('alert');
  await alert.getByText('Technical details', { exact: true }).click();
  await expect(alert).toContainText('<img src=x');
  await expect(alert.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).feedbackInjected)).toBeUndefined();
});
