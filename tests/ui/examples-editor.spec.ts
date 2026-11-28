import { expect, test } from '@playwright/test';

for (const width of [320, 736]) {
  for (const theme of ['dark', 'light']) {
    test(`compact example lists support manual editing, deletion and undo (${width}px, ${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 980 });
      await page.goto('/');
      if (theme === 'dark')
        await page.addStyleTag({
          content:
            ':root{--background-primary:#1e1e1e;--background-secondary:#252525;--background-modifier-border:#363636;--background-modifier-hover:#333;--background-modifier-form-field:#242424;--text-normal:#ddd;--text-muted:#999}#panel{background:var(--background-primary)}input,textarea,button{background:#252525;border-color:#363636}',
        });
      await page.evaluate((theme) => {
        document.body.classList.toggle('theme-light', theme === 'light');
        document.body.classList.toggle('theme-dark', theme === 'dark');
        const { draft, view, host } = (window as any).contextCardsPreview;
        host.settings.fields.maxUsages = 1;
        draft.exampleGroups = [
          {
            meaning:
              'Electrical energy used to operate machinery, lighting, and other equipment in homes and workplaces',
            examples: [
              'The storm knocked out the power across the entire city.',
              'We need a generator to provide backup power.',
            ],
          },
          {
            meaning: 'Authority, control, or influence over people or situations',
            examples: [
              'The new government promised to redistribute political power.',
              'She rose through the ranks to gain significant power in the corporation.',
            ],
          },
          {
            meaning: 'The ability or capacity to do something',
            examples: [
              'The experience changed my powers of observation.',
              'He has the power to inspire others.',
            ],
          },
        ];
        draft.examples = draft.exampleGroups.flatMap((g: any) => g.examples);
        view.render();
      }, theme);
      const section = page.locator('[data-cc-section=examples]');
      await section.locator('.cc-examples-toggle').click();
      // The approved prototype's exact palette and compact geometry are the UI contract.
      const colors =
        theme === 'dark'
          ? {
              region: 'rgb(37, 42, 35)',
              card: 'rgb(32, 32, 32)',
              surface: 'rgb(41, 43, 39)',
              line: 'rgb(60, 64, 55)',
              accent: 'rgb(161, 183, 133)',
              ink: 'rgb(224, 226, 221)',
              onAccent: 'rgb(25, 34, 17)',
            }
          : {
              region: 'rgb(241, 244, 235)',
              card: 'rgb(248, 247, 243)',
              surface: 'rgb(238, 238, 231)',
              line: 'rgb(216, 220, 209)',
              accent: 'rgb(101, 121, 79)',
              ink: 'rgb(44, 51, 45)',
              onAccent: 'rgb(255, 255, 255)',
            };
      await expect(section).toHaveCSS('background-color', colors.region);
      await expect(section).toHaveCSS('color', colors.ink);
      await expect(section.locator('.cc-examples-toggle')).toHaveCSS('color', colors.ink);
      await expect(section).toHaveCSS('border-color', colors.line);
      await expect(section).toHaveCSS('padding', '12px');
      await expect(section).toHaveCSS('border-radius', '10px');
      const firstUsage = section.locator('.cc-example-group').first();
      await expect(firstUsage).toHaveCSS('background-color', colors.card);
      await expect(firstUsage).toHaveCSS('padding', '8px 10px');
      await expect(firstUsage.locator('.cc-usage-meaning')).toHaveCSS(
        'background-color',
        colors.surface,
      );
      await expect(section.getByRole('button', { name: 'Add usage', exact: true })).toHaveCSS(
        'background-color',
        colors.accent,
      );
      await expect(section.getByRole('button', { name: 'Add usage', exact: true })).toHaveCSS(
        'color',
        colors.onAccent,
      );
      await section.getByRole('button', { name: 'Add usage', exact: true }).hover();
      await expect(section.getByRole('button', { name: 'Add usage', exact: true })).toHaveCSS(
        'background-color',
        colors.accent,
      );
      await expect(
        firstUsage.getByRole('button', { name: 'Delete usage 1', exact: true }),
      ).toHaveText('Delete usage');
      await expect(
        firstUsage
          .getByRole('button', { name: 'Delete usage 1, example 1', exact: true })
          .locator('[data-icon=x]'),
      ).toHaveCount(1);
      await expect(section.locator('summary .cc-examples-total')).toHaveText(
        '3 usages · 6 examples',
      );
      await expect(
        section.locator('.cc-usage-toggle,.cc-example-group-header,.cc-example-folded'),
      ).toHaveCount(0);
      const meaningBox = (await firstUsage.locator('.cc-usage-meaning').boundingBox())!;
      expect(meaningBox.y - (await firstUsage.boundingBox())!.y).toBeCloseTo(9, 0);
      const actions = firstUsage.locator('.cc-example-group-actions');
      const add = (await actions
        .getByRole('button', { name: 'Add example', exact: true })
        .boundingBox())!;
      const remove = (await actions
        .getByRole('button', { name: 'Delete usage 1', exact: true })
        .boundingBox())!;
      expect(remove.y).toBeCloseTo(add.y, 0);
      expect(remove.x).toBeGreaterThan(add.x + add.width);
      const list = (await firstUsage.locator('.cc-example-list').boundingBox())!;
      expect(remove.y).toBeGreaterThanOrEqual(list.y + list.height);
      for (const textarea of await section.locator('textarea').all()) {
        expect(
          await textarea.evaluate(
            (el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1,
          ),
        ).toBe(true);
      }
      expect(
        await page.locator('.cc-teaching-section').last().getAttribute('data-cc-section'),
      ).toBe('examples');
      await page.evaluate(() => (window as any).contextCardsPreview.view.render());
      await expect(section.getByLabel('Meaning / usage 3', { exact: true })).toBeVisible();
      await expect(section.getByLabel('Usage 3, example 2', { exact: true })).toBeVisible();
      await section.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const pinnedFooter = (await page.locator('.cc-footer').boundingBox())!;
      expect(pinnedFooter.y + pinnedFooter.height).toBeCloseTo(980, 0);
      await page.screenshot({ path: `.test-artifacts/examples-compact-${width}-${theme}.png` });
      // One list instead of separate boxes for every sentence, without overflow.
      expect(await section.locator('.cc-example-list').count()).toBe(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const footer = page.locator('.cc-footer');
      expect((await footer.boundingBox())!.x).toBeGreaterThanOrEqual(0);
      await section.getByRole('button', { name: 'Add usage', exact: true }).click();
      const meaning = section.getByLabel('Meaning / usage 4', { exact: true });
      await expect(meaning).toBeFocused();
      const fieldBox = (await meaning.boundingBox())!;
      expect(fieldBox.y).toBeGreaterThanOrEqual(0);
      expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual((await footer.boundingBox())!.y);
      await meaning.fill('A manually added fourth sense');
      await section.getByLabel('Usage 4, example 1', { exact: true }).fill('My manual example.');
      const fourth = section.locator('.cc-example-group').nth(3);
      await fourth.getByRole('button', { name: 'Add example', exact: true }).click();
      const added = section.getByLabel('Usage 4, example 2', { exact: true });
      await expect(added).toBeFocused();
      await added.fill(
        'A second manual example that wraps across several lines in a narrow panel.',
      );
      await section.getByRole('button', { name: 'Delete usage 4, example 2', exact: true }).click();
      await section.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(added).toHaveValue(
        'A second manual example that wraps across several lines in a narrow panel.',
      );
      await section.getByRole('button', { name: 'Delete usage 2', exact: true }).click();
      await section.getByRole('button', { name: 'Undo', exact: true }).click();
      await page.getByRole('button', { name: 'Preview cards', exact: true }).click();
      await page.getByRole('button', { name: 'Flip card', exact: true }).click();
      await expect(
        page.frameLocator('iframe').getByText('My manual example.', { exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
      await expect(meaning).toHaveValue('A manually added fourth sense');
      await section.getByRole('button', { name: 'Clear examples', exact: true }).click();
      await expect(section).toHaveAttribute('open', '');
      await expect(section.getByText('No examples yet.', { exact: true })).toBeVisible();
      await expect(
        section.getByRole('button', { name: 'Clear examples', exact: true }),
      ).toHaveCount(0);
      await section.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.screenshot({ path: `.test-artifacts/examples-empty-${width}-${theme}.png` });
      await section.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(meaning).toHaveValue('A manually added fourth sense');
      expect(await section.locator('.cc-example-group').count()).toBe(4);
      // No edit controls can change a note after it has been exported.
      await page.evaluate(() => {
        const { draft, view } = (window as any).contextCardsPreview;
        draft.phase = 'sending';
        view.render();
      });
      for (const control of await section.locator('button:not(.cc-examples-toggle),textarea').all())
        await expect(control).toBeDisabled();
      await expect(section.locator('.cc-examples-toggle')).toBeEnabled();
    });
  }
}

test('example drafts survive switching between drafts and newly generated content drops stale undo', async ({
  page,
}) => {
  await page.goto('/');
  const section = page.locator('[data-cc-section=examples]');
  await section.locator('.cc-examples-toggle').click();
  await section.getByRole('button', { name: 'Clear examples', exact: true }).click();
  await page.evaluate(() => {
    const { draft, host, view } = (window as any).contextCardsPreview;
    const other = structuredClone(draft);
    other.id = 'another-draft';
    other.expression = 'another';
    host.drafts.push(other);
    view.show(other);
  });
  await expect(section.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const { draft, view } = (window as any).contextCardsPreview;
    view.show(draft);
  });
  await expect(section.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const { draft, view } = (window as any).contextCardsPreview;
    draft.examples = ['A fresh model example.'];
    draft.exampleGroups = [{ meaning: 'Fresh model content', examples: draft.examples }];
    draft.phase = 'generating';
    draft.error = 'The request timed out.';
    view.render();
  });
  await expect(section.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await section
    .getByLabel('Usage 1, example 1', { exact: true })
    .fill('My edit while generation is pending.');
  expect(await page.evaluate(() => (window as any).contextCardsPreview.draft.examples)).toEqual([
    'My edit while generation is pending.',
  ]);
  await section.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: '.test-artifacts/examples-generating-error.png' });
});
