import { expect, test } from '@playwright/test';

for (const mode of ['vocabulary', 'writing']) {
  test(`${mode} keeps accessible names without Obsidian aria-label hover popups, including async controls`, async ({
    page,
  }) => {
    await page.goto(mode === 'writing' ? '/?writing=1' : '/');
    const panel = page.locator('.cc-panel');
    await expect(panel.locator('[aria-label]')).toHaveCount(0);
    const settings = page.getByRole('button', { name: 'Open Context Cards settings', exact: true });
    await expect(settings).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open source', exact: true })).toHaveCount(0);
    if (mode === 'vocabulary')
      await expect(page.getByRole('group', { name: 'Draft view', exact: true })).toBeVisible();
    await page.evaluate(() => {
      const group = document.createElement('div');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Late controls');
      const button = document.createElement('button');
      button.setAttribute('aria-label', 'Late action');
      button.textContent = 'Run';
      button.addEventListener('click', () => {
        button.dataset.clicked = 'yes';
      });
      group.append(button);
      document.querySelector('.cc-panel-body')!.append(group);
      const other = document.createElement('button');
      other.setAttribute('aria-label', 'Another plugin');
      other.textContent = 'Other';
      document.body.append(other);
      // Simulate the host's aria-label tooltip trigger, separate from browser titles.
      document.addEventListener('mouseover', (event) => {
        document.querySelector('.test-host-tooltip')?.remove();
        const text = (event.target as Element).closest('[aria-label]')?.getAttribute('aria-label');
        if (text) {
          const tip = document.createElement('div');
          tip.className = 'test-host-tooltip';
          tip.textContent = text;
          document.body.append(tip);
        }
      });
    });
    const late = page.getByRole('button', { name: 'Late action', exact: true });
    await expect(page.getByRole('group', { name: 'Late controls', exact: true })).toBeVisible();
    await late.click();
    await expect(late).toHaveAttribute('data-clicked', 'yes');
    await expect(panel.locator('[aria-label]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Another plugin', exact: true }).hover();
    await expect(page.locator('.test-host-tooltip')).toHaveText('Another plugin');
    await settings.hover();
    await expect(page.locator('.test-host-tooltip')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Another plugin', exact: true })).toHaveAttribute(
      'aria-label',
      'Another plugin',
    );
  });
}
