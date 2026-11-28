import { expect, test } from '@playwright/test';

for (const { width, height } of [
  { width: 360, height: 1000 },
  { width: 700, height: 1000 },
  { width: 360, height: 560 },
]) {
  for (const obsidianHost of [false, true]) {
    test(`vocabulary footer stays at the bottom through example expansion and edits (${width}x${height}, host=${obsidianHost})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      if (obsidianHost)
        await page.addStyleTag({ content: '.cc-panel { height: 100%; overflow-y: auto; }' });
      await page.evaluate(() => {
        const { host, draft, view } = (window as any).contextCardsPreview;
        Object.assign(host.settings.fields, {
          grammar: false,
          ipa: 'off',
          meaningSentences: 0,
          generalMeaningSentences: 0,
          explanationSentences: 0,
          context: false,
          wordFormation: false,
        });
        draft.exampleGroups = Array.from({ length: 5 }, (_, i) => ({
          meaning: `Usage ${i + 1}`,
          examples: ['First example sentence. '.repeat(5), 'Second example sentence. '.repeat(5)],
        }));
        draft.examples = draft.exampleGroups.flatMap((g: any) => g.examples);
        view.render();
      });
      const footer = page.locator('.cc-footer');
      const atBottom = async () => {
        const box = (await footer.boundingBox())!;
        expect(box.y + box.height).toBeCloseTo(height, 0);
        await expect(
          footer.getByRole('button', { name: 'Add to Anki', exact: true }),
        ).toBeInViewport();
      };
      await atBottom();
      const section = page.locator('[data-cc-section=examples]');
      await section.locator('.cc-examples-toggle').click();
      await atBottom();
      await page.evaluate((host) => {
        const panel = (window as any).contextCardsPreview.view.contentEl;
        panel.scrollTop = panel.scrollHeight;
      }, obsidianHost);
      await atBottom();
      await section.getByRole('button', { name: 'Add usage', exact: true }).click();
      await atBottom();
      await expect(section.getByLabel('Meaning / usage 6', { exact: true })).toBeFocused();
      await section.getByRole('button', { name: 'Clear examples', exact: true }).click();
      await atBottom();
      await section.getByRole('button', { name: 'Undo', exact: true }).click();
      await atBottom();
      await section.locator('.cc-examples-toggle').click();
      await atBottom();
      await page.screenshot({
        path: `.test-artifacts/examples-footer-${width}-${height}-${obsidianHost}.png`,
      });
    });
  }
}

test('the full editor scrolls inside the vocabulary panel without leaving a gap below its footer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 736, height: 980 });
  await page.goto('/');
  await page.evaluate(() => {
    const { draft, view } = (window as any).contextCardsPreview;
    draft.exampleGroups = Array.from({ length: 5 }, (_, i) => ({
      meaning: `Usage ${i + 1}`,
      examples: [
        'A sufficiently long example sentence. '.repeat(5),
        'Another example. '.repeat(10),
      ],
    }));
    draft.examples = draft.exampleGroups.flatMap((g: any) => g.examples);
    view.render();
  });
  const section = page.locator('[data-cc-section=examples]');
  await section.getByRole('button', { name: 'Show examples', exact: true }).click();
  await section.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  const pinned = async () => {
    const box = (await page.locator('.cc-footer').boundingBox())!;
    expect(box.y + box.height).toBeCloseTo(980, 0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  };
  await pinned();
  await section.getByRole('button', { name: 'Add usage', exact: true }).click();
  await pinned();
  await section.getByRole('button', { name: 'Hide examples', exact: true }).click();
  await pinned();
});

test('Examples has a keyboard-accessible Show/Hide button; counters do not toggle it or jump the panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 1200 });
  await page.goto('/');
  await page.evaluate(() => {
    const { host, view } = (window as any).contextCardsPreview;
    Object.assign(host.settings.fields, {
      grammar: false,
      ipa: 'off',
      meaningSentences: 0,
      generalMeaningSentences: 0,
      explanationSentences: 0,
      context: false,
      wordFormation: false,
    });
    view.render();
  });
  const section = page.locator('[data-cc-section=examples]');
  const position = (await section.boundingBox())!.y;
  await section.locator('.cc-examples-total').click();
  await expect(section).not.toHaveAttribute('open');
  const show = section.getByRole('button', { name: 'Show examples', exact: true });
  await show.focus();
  await show.press('Enter');
  await expect(section).toHaveAttribute('open', '');
  await expect(section.getByRole('button', { name: 'Hide examples', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect((await section.boundingBox())!.y).toBeCloseTo(position, 0);
  await section.locator('.cc-examples-total').click();
  await expect(section).toHaveAttribute('open', '');
  await section.getByRole('button', { name: 'Hide examples', exact: true }).press('Space');
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await expect(section).not.toHaveAttribute('open');
  await section.getByRole('button', { name: 'Clear examples', exact: true }).click();
  await expect(section).toHaveAttribute('open', '');
  await expect(section.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Hide examples', exact: true })).toBeVisible();
});
