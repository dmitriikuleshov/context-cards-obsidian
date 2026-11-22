import { expect, test } from '@playwright/test';
for (const width of [340, 1000]) {
  test(`Thinking choices are clear, themed and adapt to the selected model (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await page.addStyleTag({
      content:
        '.thinking-fixture{padding:20px}.thinking-fixture .setting-item{display:flex;align-items:center;gap:16px;padding:16px 0}.thinking-fixture .setting-item-info{flex:1;min-width:0}.thinking-fixture .setting-item-description{font-size:12px;color:var(--text-muted);line-height:1.6;margin-top:8px}.thinking-fixture .setting-item-control{max-width:50%;min-width:0}.thinking-fixture .setting-item-name{font-weight:600}',
    });
    await page.evaluate(async () => {
      const { view, host, ThinkingControl, enhanceSelects } = (window as any).contextCardsPreview;
      await view.onClose();
      const root = document.createElement('section');
      root.className = 'thinking-fixture';
      root.innerHTML =
        '<h2>Local model</h2><div class="setting-item"><div class="setting-item-info"><div class="setting-item-name">Thinking</div><div class="setting-item-description"></div></div><div class="setting-item-control"></div></div>';
      document.querySelector('#panel')!.replaceChildren(root);
      const temperatureRow = document.createElement('div');
      temperatureRow.className = 'setting-item';
      temperatureRow.innerHTML =
        '<div class="setting-item-info"><div class="setting-item-name">Generation temperature</div></div><div class="setting-item-control"><select aria-label="Generation temperature"><option value="0.2">0.2</option><option value="0.4">0.4</option></select></div>';
      root.append(temperatureRow);
      const temperature = temperatureRow.querySelector<HTMLSelectElement>('select')!;
      enhanceSelects(temperatureRow);
      const fixture: any = {
        settings: structuredClone(host.settings),
        support: { known: true, values: [false, true], default: true },
        saves: 0,
      };
      fixture.control = new ThinkingControl(
        root.querySelector('.setting-item-control'),
        fixture.settings,
        () => fixture.saves++,
        (description: string) =>
          (root.querySelector('.setting-item-description')!.textContent = description),
        async () => fixture.support,
        (active: boolean) => (temperature.disabled = active),
      );
      (window as any).thinkingFixture = fixture;
      await fixture.control.load();
    });
    const control = page.getByRole('button', { name: 'Thinking', exact: true });
    await expect(control).toHaveText('Off');
    const temperature = page.getByRole('button', { name: 'Generation temperature', exact: true });
    await expect(temperature).toBeEnabled();
    await control.click();
    await expect(page.getByRole('menuitemcheckbox')).toHaveCount(3);
    await page.getByRole('menuitemcheckbox', { name: 'On', exact: true }).click();
    await expect(control).toHaveText('On');
    await expect(temperature).toBeDisabled();
    expect(await page.evaluate(() => (window as any).thinkingFixture.settings.thinking)).toBe('on');
    await page.evaluate(() => {
      const f = (window as any).thinkingFixture;
      f.settings.model = 'levels:model';
      f.support = { known: true, values: ['low', 'medium', 'high'], default: 'medium' };
      f.control.schedule();
    });
    await expect(control).toHaveText('Model default');
    await control.click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Off', exact: true })).toHaveCount(0);
    await page.getByRole('menuitemcheckbox', { name: 'High', exact: true }).click();
    await expect(control).toHaveText('High');
    if (width === 340)
      await page.screenshot({ path: '.test-artifacts/thinking-settings-narrow.png' });
    await page.evaluate(async () => {
      const f = (window as any).thinkingFixture;
      f.support = { known: true, values: [false] };
      await f.control.load(true);
    });
    await expect(control).toBeDisabled();
    await expect(control).toHaveText('Not supported');
    await expect(temperature).toBeEnabled();
    await page.evaluate(async () => {
      const f = (window as any).thinkingFixture;
      f.support = { known: false, values: [] };
      await f.control.load(true);
    });
    await expect(control).toBeDisabled();
    await expect(control).toHaveText('Model default');
    await expect(page.locator('.setting-item-description')).toContainText('Support unknown');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await page.locator('button.cc-select-button').count()).toBe(2);
  });
}
