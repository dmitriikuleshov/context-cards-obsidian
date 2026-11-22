import { expect, test } from '@playwright/test';
for (const width of [340, 1000]) {
  test(`installed-model selection and Refresh work without manual names (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await page.addStyleTag({
      content:
        '.model-fixture{padding:20px}.model-fixture .setting-item{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:16px 0}.model-fixture .setting-item-info{flex:1 1 200px;min-width:0}.model-fixture .setting-item-description{font-size:12px;color:var(--text-muted);line-height:1.6;margin-top:8px}.model-fixture .setting-item-control{display:flex;flex:1 1 280px}.model-fixture .setting-item-name{font-weight:600}',
    });
    await page.evaluate(async () => {
      const { view, host, ModelControl } = (window as any).contextCardsPreview;
      await view.onClose();
      const root = document.createElement('section');
      root.className = 'model-fixture';
      root.innerHTML =
        '<h2>Local model</h2><div class="setting-item"><div class="setting-item-info"><div class="setting-item-name">Model</div><div class="setting-item-description"></div></div><div class="setting-item-control"></div></div>';
      document.querySelector('#panel')!.replaceChildren(root);
      const f: any = {
        settings: structuredClone(host.settings),
        saves: 0,
        names: [
          host.settings.model,
          'qwen3:14b-q4_K_M',
          'hf.co/organisation/A-very-long-model-name-with-a-detailed-quantization-tag:Q4_K_M',
        ],
        error: '',
      };
      f.control = new ModelControl(
        root.querySelector('.setting-item-control'),
        f.settings,
        () => f.saves++,
        (text: string) => (root.querySelector('.setting-item-description')!.textContent = text),
        async () => {
          if (f.error) throw new Error(f.error);
          return f.names;
        },
      );
      (window as any).modelFixture = f;
      await f.control.load();
    });
    const picker = page.getByRole('button', { name: 'Model', exact: true });
    const refresh = page.getByRole('button', { name: 'Refresh installed models', exact: true });
    await expect(picker).toHaveText('qwen3.5:9b-q4_K_M');
    await picker.click();
    await expect(page.getByRole('menuitemcheckbox')).toHaveCount(3);
    const bounds = (await page.getByRole('menu').boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.getByRole('menuitemcheckbox', { name: 'qwen3:14b-q4_K_M', exact: true }).click();
    expect(await page.evaluate(() => (window as any).modelFixture.settings.model)).toBe(
      'qwen3:14b-q4_K_M',
    );
    await page.evaluate(() => (window as any).modelFixture.names.push('new:model'));
    await refresh.click();
    await expect(refresh).toBeEnabled();
    await picker.click();
    await expect(
      page.getByRole('menuitemcheckbox', { name: 'new:model', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await page.evaluate(() => ((window as any).modelFixture.error = 'Ollama is offline'));
    await refresh.click();
    await expect(page.locator('.setting-item-description')).toContainText('Ollama is offline');
    await expect(picker).toBeDisabled();
    await expect(picker).toHaveText('qwen3:14b-q4_K_M');
    expect(await page.evaluate(() => (window as any).modelFixture.settings.model)).toBe(
      'qwen3:14b-q4_K_M',
    );
    await page.evaluate(() => {
      const f = (window as any).modelFixture;
      f.error = '';
      f.names = ['new:model'];
    });
    await refresh.click();
    await expect(picker).toBeEnabled();
    await expect(picker).toContainText('not installed');
    await picker.click();
    await expect(page.getByRole('menuitemcheckbox', { name: /not installed/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.getByRole('menuitemcheckbox', { name: 'new:model', exact: true }).click();
    await expect(picker).toHaveText('new:model');
    expect(await page.evaluate(() => (window as any).modelFixture.saves)).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await page.locator('.cc-model-control .cc-select-button').count()).toBe(1);
    if (width === 340)
      await page.screenshot({ path: '.test-artifacts/installed-models-narrow.png' });
  });
}
