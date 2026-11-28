import { test, expect } from '@playwright/test';

test('post-export actions remain clickable, signal an Anki request and route back to the source', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/');
  await page.evaluate(() => {
    const p = (window as any).contextCardsPreview;
    p.calls = { anki: [], source: [] };
    p.host.openAnki = async (ids: number[]) => {
      p.calls.anki.push(ids);
      await new Promise<void>((resolve) => {
        p.finishOpen = resolve;
      });
    };
    p.host.openSource = (d: any) => p.calls.source.push(d.id);
    p.draft.phase = 'saved';
    p.draft.noteId = 1234;
    p.view.render();
  });
  const success = page.locator('.cc-success');
  await expect(success.getByRole('button', { name: 'Open in Anki', exact: true })).toBeEnabled();
  await success.getByRole('button', { name: 'Open in Anki', exact: true }).click();
  await expect(success.getByRole('button', { name: 'Opening…', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).contextCardsPreview.calls.anki)).toEqual([
    [1234],
  ]);
  await page.evaluate(() => (window as any).contextCardsPreview.finishOpen());
  await expect(success.getByRole('button', { name: 'Open in Anki', exact: true })).toBeEnabled();
  await success.getByRole('button', { name: 'Continue reading', exact: true }).click();
  expect(
    await page.evaluate(() => {
      const p = (window as any).contextCardsPreview;
      return p.calls.source;
    }),
  ).toHaveLength(1);
  await expect(page.getByLabel('Word or expression', { exact: true })).toBeDisabled();
  await page.screenshot({ path: '.test-artifacts/post-export-actions.png' });
});
test('compact sections retain all fields and context editing actions', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 850 });
  await page.goto('/');
  await page.locator('[data-cc-section=explanation] > summary').click();
  await page.locator('[data-cc-section=examples] > summary .cc-examples-title').click();
  for (const name of [
    'Grammar',
    'American IPA',
    'Usage example 1',
    'Usage example 5',
    'Usage notes',
  ])
    await expect(page.getByLabel(name, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Deck', { exact: true })).toBeVisible();
  await page.locator('.cc-technical > summary').click();
  await page.getByLabel('Deck', { exact: true }).fill('English::Books::Shared');
  await page.getByLabel('Tags', { exact: true }).fill('reading');
  await page.evaluate(() => (window as any).contextCardsPreview.view.render());
  await expect(page.getByLabel('Deck', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Deck', { exact: true })).toHaveValue('English::Books::Shared');
  await expect(page.getByLabel('Tags', { exact: true })).toHaveValue('reading');
  await page.locator('.cc-context-tools > summary').click();
  const context = page.getByLabel('Context from your book', { exact: true });
  await context.evaluate((node) => {
    const text = node as HTMLTextAreaElement;
    const start = text.value.indexOf('warning');
    text.focus();
    text.setSelectionRange(start, start + 7);
  });
  await page.getByRole('button', { name: 'Use selection as answer', exact: true }).click();
  await expect(page.locator('.cc-context-tools > summary')).toHaveText('Answer: warning');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.test-artifacts/compact-narrow.png', fullPage: true });
  await context.fill(
    'Mara brushed off the warning. ' + 'A long passage from the book. '.repeat(100),
  );
  expect((await context.boundingBox())!.height).toBeLessThanOrEqual(241);
});
test('clears all drafts from the top of the panel', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Clear all drafts', exact: true }).click();
  await expect(page.getByLabel('Choose a draft')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Keep the words worth keeping.' })).toBeVisible();
});

test('clear drafts stays disabled while another draft is being sent to Anki', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 850 });
  await page.goto('/');
  await page.evaluate(() => {
    const { host, draft, view } = (window as any).contextCardsPreview;
    host.drafts.unshift({ ...structuredClone(draft), id: 'export-in-progress', phase: 'sending' });
    view.render();
  });
  const clear = page.getByRole('button', { name: 'Clear all drafts', exact: true });
  await expect(clear).toBeDisabled();
  await expect(clear).toHaveAttribute('title', /Wait for the Anki export/);
  await page.evaluate(() => {
    const { host, view } = (window as any).contextCardsPreview;
    host.drafts[0].phase = 'saved';
    host.drafts[0].noteId = 42;
    view.render();
  });
  await expect(clear).toBeEnabled();
  await clear.click();
  await expect(page.getByRole('heading', { name: 'Keep the words worth keeping.' })).toBeVisible();
});
test('review, edit and both expandable hints work in a real browser', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByLabel('Word or expression', { exact: true })).toHaveValue('brush off');
  await page.locator('[data-cc-section=explanation] > summary').click();
  await page.getByLabel('Explanation', { exact: true }).fill('Mara dismissed the warning.');
  await page.getByRole('button', { name: 'Preview cards', exact: true }).click();
  const card = page.frameLocator('iframe');
  await expect(card.getByText('Mara', { exact: false })).toBeHidden();
  await card.getByText('Show context', { exact: true }).click();
  await expect(card.locator('mark')).toHaveText('brushed off');
  await page.getByRole('button', { name: 'Recall', exact: true }).click();
  await expect(card.locator('.cc-gap')).toHaveCount(1);
  await expect(
    card.getByText('to dismiss something without considering it seriously', { exact: true }),
  ).toBeHidden();
  await card.getByText('Show definition', { exact: true }).click();
  await expect(
    card.getByText('to dismiss something without considering it seriously', { exact: true }),
  ).toBeVisible();
  await card.getByRole('textbox', { name: 'Your answer', exact: true }).fill('brushed off');
  await page.getByRole('button', { name: 'Flip card', exact: true }).click();
  await expect(card.locator('.cc-expression')).toHaveText('brushed off');
  await expect(card.getByText('Mara dismissed the warning.', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.test-artifacts/recall-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await page.screenshot({ path: '.test-artifacts/edit-draft.png', fullPage: true });
  await page.getByRole('button', { name: 'Add to Anki', exact: true }).click();
  await expect(page.getByText('Two cards added to Anki.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('regeneration preserves edits until accepted, including in a narrow sidebar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('[data-cc-section=explanation] > summary').click();
  await page.getByLabel('Explanation', { exact: true }).fill('My own explanation.');
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(page.getByLabel('Explanation', { exact: true })).toHaveValue('My own explanation.');
  await expect(page.getByRole('button', { name: 'Add to Anki', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep my draft', exact: true }).click();
  await expect(page.getByLabel('Explanation', { exact: true })).toHaveValue('My own explanation.');
  await expect(page.getByRole('button', { name: 'Add to Anki', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('grouped examples stay editable and appear on the card back', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 850 });
  await page.goto('/');
  await page.evaluate(() => {
    const { draft, view } = (window as any).contextCardsPreview;
    draft.exampleGroups = [
      {
        meaning: 'Dismiss a concern',
        examples: ['She brushed off the warning.', 'He brushed off my advice.'],
      },
      {
        meaning: 'Remove by brushing',
        examples: ['She brushed off the dust.', 'He brushed off the crumbs.'],
      },
    ];
    view.render();
  });
  await page.locator('[data-cc-section=examples] > summary .cc-examples-title').click();
  await page.getByLabel('Meaning / usage 2', { exact: true }).fill('Remove dust or dirt');
  await page.getByLabel('Usage 2, example 1', { exact: true }).fill('She brushed off the dirt.');
  await expect(page.getByLabel('Meaning / usage 2', { exact: true })).toHaveValue(
    'Remove dust or dirt',
  );
  await page.screenshot({ path: '.test-artifacts/grouped-examples.png', fullPage: true });
  await page.getByRole('button', { name: 'Preview cards', exact: true }).click();
  await page.getByRole('button', { name: 'Flip card', exact: true }).click();
  const card = page.frameLocator('iframe');
  await expect(card.getByText('Remove dust or dirt', { exact: true })).toBeVisible();
  await expect(card.getByText('She brushed off the dirt.', { exact: true })).toBeVisible();
});

for (const width of [320, 440]) {
  test(`usage headings wrap completely and resize with the panel (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const labels = [
      'Electrical energy or force used to operate machinery, lighting, and other equipment in homes and workplaces',
      'Authority, control, or influence over people or situations, especially within a government or organisation',
    ];
    await page.evaluate((meaningLabels) => {
      const { draft, view } = (window as any).contextCardsPreview;
      draft.exampleGroups = meaningLabels.map((meaning: string) => ({
        meaning,
        examples: ['First example.', 'Second example.'],
      }));
      draft.examples = draft.exampleGroups.flatMap((g: any) => g.examples);
      view.render();
    }, labels);
    await page.locator('[data-cc-section=examples] > summary .cc-examples-title').click();
    const first = page.getByLabel('Meaning / usage 1', { exact: true });
    const second = page.getByLabel('Meaning / usage 2', { exact: true });
    const fullyShown = async () => {
      for (const field of [first, second]) {
        await expect(field).toBeVisible();
        expect(await field.evaluate((el) => el.tagName)).toBe('TEXTAREA');
        expect(
          await field.evaluate(
            (el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1,
          ),
        ).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    };
    await expect(first).toHaveValue(labels[0]!);
    await expect(second).toHaveValue(labels[1]!);
    await fullyShown();
    const narrowHeight = (await first.boundingBox())!.height;
    await page
      .locator('[data-cc-section=examples]')
      .evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await page.screenshot({ path: `.test-artifacts/usage-meaning-${width}.png` });
    await page.setViewportSize({ width: 700, height: 900 });
    await fullyShown();
    expect((await first.boundingBox())!.height).toBeLessThan(narrowHeight);
    const edited = labels[0] + '\n' + 'Averylongunbrokentext'.repeat(10);
    await first.fill(edited);
    await fullyShown();
    await page.evaluate(() => (window as any).contextCardsPreview.view.render());
    await expect(first).toHaveValue(edited);
    await fullyShown();
    await first.fill('Energy');
    await fullyShown();
    expect((await first.boundingBox())!.height).toBeLessThan(narrowHeight);
    await first.fill(labels[0]!);
    await page.getByRole('button', { name: 'Preview cards', exact: true }).click();
    await page.getByRole('button', { name: 'Flip card', exact: true }).click();
    await expect(page.frameLocator('iframe').getByText(labels[0]!, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
    await page.evaluate(() => {
      const { draft, view } = (window as any).contextCardsPreview;
      draft.phase = 'saved';
      draft.noteId = 99;
      view.render();
    });
    await expect(first).toBeDisabled();
    await fullyShown();
  });
}

test('disabled fields disappear from editor and preview while recall keeps its gap', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const { host, view } = (window as any).contextCardsPreview;
    host.settings.fields = {
      ...host.settings.fields,
      grammar: false,
      ipa: 'off',
      meaningSentences: 0,
      generalMeaningSentences: 0,
      wordFormation: false,
      context: false,
      explanationSentences: 0,
      examples: false,
    };
    view.render();
  });
  for (const name of [
    'Grammar',
    'American IPA',
    'Meaning in this context',
    'General meaning',
    'Word formation',
    'Context from your book',
    'Explanation',
    'Usage example 1',
  ])
    await expect(page.getByLabel(name, { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Preview cards', exact: true }).click();
  const card = page.frameLocator('iframe');
  await expect(card.getByText('Show context', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Recall', exact: true }).click();
  await expect(card.locator('.cc-gap')).toHaveCount(1);
  await expect(card.getByText('Show definition', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Flip card', exact: true }).click();
  await expect(card.getByText('Explanation', { exact: true })).toHaveCount(0);
  await expect(card.getByText('Usage examples', { exact: true })).toHaveCount(0);
});

test('opening teaching sections reveals their content above the footer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto('/');
  for (const key of ['explanation', 'examples']) {
    const summary = page.locator(`[data-cc-section=${key}] > summary`);
    if (key === 'examples')
      await page.locator('[data-cc-section=examples] > summary .cc-examples-title').click();
    else await summary.click();
    const section = page.locator(`[data-cc-section=${key}]`);
    await expect
      .poll(async () => {
        const rect = await section.boundingBox();
        const footer = await page.locator('.cc-footer').boundingBox();
        return (
          !!rect &&
          !!footer &&
          (key === 'explanation' ? rect.y >= -2 && rect.y + 100 < footer.y : rect.y < footer.y)
        );
      })
      .toBe(true);
  }
  await expect(page.locator('.cc-destination-tools')).toHaveCSS('border-top-width', '0px');
  await page.screenshot({ path: '.test-artifacts/expanded-section-scroll.png' });
});
