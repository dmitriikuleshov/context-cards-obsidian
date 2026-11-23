import { test, expect } from '@playwright/test';

for (const dark of [true, false]) {
  test(`preview changes do not reload the visible frame or expose a blank ${dark ? 'dark' : 'light'} canvas`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 850 });
    await page.goto('/');
    await page.evaluate((dark) => {
      document.body.classList.toggle('theme-dark', dark);
      const probe = { visible: 0, hidden: 0, bad: [] as string[], running: true };
      (window as any).previewPaintProbe = probe;
      const inspect = () => {
        const frame = document.querySelector<HTMLIFrameElement>('.cc-preview-frame');
        if (!frame) return;
        if (getComputedStyle(frame).visibility === 'hidden') {
          probe.hidden++;
          return;
        }
        probe.visible++;
        const doc = frame.contentDocument;
        const background =
          doc?.documentElement &&
          doc.defaultView?.getComputedStyle(doc.documentElement).backgroundColor;
        if (
          !frame.classList.contains('is-ready') ||
          !doc?.querySelector('.cc-card') ||
          background !== (dark ? 'rgb(32, 36, 32)' : 'rgb(250, 249, 246)')
        )
          probe.bad.push(`${frame.className}: ${background}`);
      };
      new MutationObserver(inspect).observe(document.getElementById('panel')!, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      const tick = () => {
        inspect();
        if (probe.running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, dark);
    await page.getByRole('button', { name: 'Preview cards', exact: true }).click();
    await expect(page.locator('iframe.is-ready')).toBeVisible();
    await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>('iframe')!;
      (window as any).originalCardDocument = frame.contentDocument;
      (window as any).originalCardRoot = frame.contentDocument!.querySelector('.cc-card');
    });
    const frame = page.frameLocator('iframe');
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Flip card', exact: true }).click();
      await expect(page.locator('.cc-preview-side')).toHaveText(
        i % 2 === 0 ? 'Answer' : 'Question',
      );
      expect(
        await page.evaluate(() => {
          const doc = document.querySelector<HTMLIFrameElement>('iframe')!.contentDocument;
          return (
            doc === (window as any).originalCardDocument &&
            doc!.querySelector('.cc-card') === (window as any).originalCardRoot
          );
        }),
      ).toBe(true);
    }
    await page.getByRole('button', { name: 'Recall', exact: true }).click();
    await expect(frame.getByRole('textbox', { name: 'Your answer' })).toBeVisible();
    await expect(frame.locator('.cc-expression')).toHaveCount(0);
    await page.getByRole('button', { name: 'Flip card', exact: true }).click();
    await expect(frame.locator('.cc-expression')).toHaveText('brushed off');
    await page.getByRole('button', { name: 'Flip card', exact: true }).click();
    await expect(frame.locator('.cc-expression')).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.querySelector<HTMLIFrameElement>('iframe')!.contentDocument ===
          (window as any).originalCardDocument,
      ),
    ).toBe(true);
    await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-same-origin');
    await expect(frame.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
      'content',
      /default-src 'none'/,
    );
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
      await page.getByRole('button', { name: 'Preview cards', exact: true }).click();
      await expect(page.locator('iframe.is-ready')).toBeVisible();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    }
    const probe = await page.evaluate(() => {
      const probe = (window as any).previewPaintProbe;
      probe.running = false;
      return probe;
    });
    expect(probe.visible).toBeGreaterThan(0);
    expect(probe.hidden).toBeGreaterThan(0);
    expect(probe.bad).toEqual([]);
  });
}
