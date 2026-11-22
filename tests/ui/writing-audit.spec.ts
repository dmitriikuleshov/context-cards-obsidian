import { test, expect } from '@playwright/test';
for (const height of [520, 720, 900]) {
  test(`writing footer stays at the pane bottom with short and long content at ${height}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height });
    await page.goto('/?writing=1');
    // Simulate a pane shorter than the window, as in Obsidian's split layout.
    await page.locator('#panel').evaluate((el, height) => {
      (el as HTMLElement).style.height = `${height - 60}px`;
    }, height);
    const footer = page.locator('.cc-footer'),
      body = page.locator('.cc-writing-workflow > .cc-panel-body');
    const pinned = async () => {
      const panelRect = (await page.locator('#panel').boundingBox())!,
        footerRect = (await footer.boundingBox())!;
      expect(
        Math.abs(footerRect.y + footerRect.height - panelRect.y - panelRect.height),
      ).toBeLessThan(1);
      const bodyRect = (await body.boundingBox())!;
      expect(bodyRect.y + bodyRect.height).toBeLessThanOrEqual(footerRect.y + 1);
    };
    await page.evaluate(() => {
      const p = (window as any).writingPreview;
      p.session.findings = [];
      p.view.render();
    });
    await pinned();
    await page.locator('[data-writing-section=options] > summary').click();
    await pinned();
    await page.locator('[data-writing-section=options] > summary').click();
    await page.evaluate(() => {
      const p = (window as any).writingPreview;
      p.session.capture.selected = 'A long passage to review. '.repeat(200);
      p.view.render();
    });
    await pinned();
    await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
    expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await pinned();
    const scroll = await body.evaluate((el) => el.scrollTop);
    await page.evaluate(() => (window as any).writingPreview.view.render());
    expect(await body.evaluate((el) => el.scrollTop)).toBe(scroll);
    await page.locator('[data-writing-section=options] > summary').click();
    await pinned();
    if (height === 720)
      await page.screenshot({ path: '.test-artifacts/writing-footer-pinned.png' });
  });
}
test('background redraw preserves unsaved edits, focus and caret', async ({ page }) => {
  await page.goto('/?writing=1');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const input = page.getByLabel('Correction', { exact: true });
  await input.fill('written twice');
  await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(3, 3));
  await page.evaluate(() => (window as any).writingPreview.view.render());
  await expect(input).toHaveValue('written twice');
  await expect(input).toBeFocused();
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(3);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => (window as any).writingPreview.session.findings[0].after)).toBe(
    'written',
  );
});
test('advanced choices survive redraws, cancel stays safe and scrolling styles are cleaned up', async ({
  page,
}) => {
  await page.goto('/?writing=1');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[data-writing-section=edit-details]>summary').click();
  await page.getByLabel('Exercise type', { exact: true }).click();
  await page
    .getByRole('menuitemcheckbox', { name: 'Fill in the missing word', exact: true })
    .click();
  await page.evaluate(() => (window as any).writingPreview.view.render());
  await expect(page.getByLabel('Exercise type', { exact: true })).toHaveText(
    'Fill in the missing word',
  );
  await expect(page.locator('[data-writing-section=edit-details]')).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => (window as any).writingPreview.session.findings[0].format)).toBe(
    'correction',
  );
  await page.evaluate(() => (window as any).writingPreview.view.onClose());
  expect(
    await page.locator('#panel').evaluate((el) => (el as HTMLElement).style.scrollPaddingBottom),
  ).toBe('');
});
test('keyboard word navigation and the checkbox retain focus after redraws', async ({ page }) => {
  await page.goto('/?writing=1');
  const word = page.locator('.cc-writing-word').filter({ hasText: 'wrote' });
  await word.focus();
  await word.press('Enter');
  await expect(word).toBeFocused();
  const checkbox = page.getByRole('checkbox', { name: 'Create an Anki card', exact: true });
  await checkbox.focus();
  await checkbox.press('Space');
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeFocused();
  await checkbox.press('Space');
  await expect(checkbox).toBeChecked();
});
test('long preview opens at the top and Edit card opens the editor at the top', async ({
  page,
}) => {
  await page.setViewportSize({ width: 340, height: 560 });
  await page.goto('/?writing=1');
  await page.evaluate(() => {
    const p = (window as any).writingPreview;
    p.session.findings = Array.from({ length: 6 }, (_, i) => ({
      ...structuredClone(p.session.findings[0]),
      id: 'long-' + i,
      selected: true,
      explanation: 'A detailed explanation that wraps across several lines. '.repeat(12),
    }));
    p.view.render();
  });
  await page.getByRole('button', { name: 'Review 6 cards', exact: true }).click();
  const previewHeading = page.getByRole('heading', { name: 'Review your cards', exact: true });
  const content = page.locator('.cc-writing-panel > .cc-panel-body');
  await expect
    .poll(async () => {
      const box = await previewHeading.boundingBox();
      const body = await content.boundingBox();
      return (
        !!box &&
        !!body &&
        (await content.evaluate((el) => el.scrollTop === 0)) &&
        box.y >= body.y &&
        box.y < body.y + 110 &&
        box.y + box.height <= body.y + body.height
      );
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Edit card', exact: true }).last().click();
  const heading = page.getByRole('heading', { name: 'Edit correction', exact: true });
  await expect
    .poll(async () => {
      const box = await heading.boundingBox();
      const body = await content.boundingBox();
      return (
        !!box &&
        !!body &&
        (await content.evaluate((el) => el.scrollTop === 0)) &&
        box.y >= body.y &&
        box.y < body.y + 110 &&
        box.y + box.height <= body.y + body.height
      );
    })
    .toBe(true);
  await expect(page.getByLabel('Correction', { exact: true })).toBeVisible();
});
test('saving only card feedback returns to previews without another preparation step', async ({
  page,
}) => {
  await page.goto('/?writing=1');
  await page.getByRole('button', { name: 'Review 2 cards', exact: true }).click();
  await page.getByRole('button', { name: 'Edit card', exact: true }).first().click();
  await page.locator('[data-writing-section=edit-details]>summary').click();
  await page.locator('[data-writing-section=card-fields]>summary').click();
  await page.getByLabel('Card explanation', { exact: true }).fill('My saved explanation.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your cards', exact: true })).toBeVisible();
  await expect(page.getByText('My saved explanation.', { exact: true })).toBeVisible();
});
for (const size of [
  { width: 320, height: 520 },
  { width: 390, height: 720 },
]) {
  test(`writing destination works like vocabulary at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto('/?writing=1');
    await page.getByRole('button', { name: 'Review 2 cards', exact: true }).click();
    const footer = page.locator('.cc-footer'),
      options = footer.locator('[data-writing-section=options]'),
      deck = footer.getByLabel('Writing deck', { exact: true });
    await expect(deck).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recheck selection', exact: true })).toBeHidden();
    const deckRect = (await deck.boundingBox())!,
      summaryRect = (await options.locator('summary').boundingBox())!;
    expect(deckRect.x + deckRect.width).toBeLessThanOrEqual(summaryRect.x);
    expect(Math.abs(deckRect.y - summaryRect.y)).toBeLessThan(16);
    const before = (await footer.boundingBox())!.height;
    await options.locator('summary').click();
    await expect(options).toHaveAttribute('open', '');
    await expect
      .poll(async () => {
        const r = await options.boundingBox();
        const f = await footer.boundingBox();
        return !!r && !!f && r.y >= f.y && r.y + r.height <= f.y + f.height;
      })
      .toBe(true);
    expect((await footer.boundingBox())!.height).toBeGreaterThan(before);
    await expect(
      page.getByRole('button', { name: 'Recheck selection', exact: true }),
    ).toBeVisible();
    await expect(deck).toBeVisible();
    await expect(footer.getByText('2 cards selected', { exact: true })).toBeVisible();
    if (size.width === 390)
      await page.screenshot({ path: '.test-artifacts/writing-options-vocabulary.png' });
    await deck.fill('English::My new deck');
    await options.locator('summary').click();
    await expect(deck).toHaveValue('English::My new deck');
    await expect(page.getByRole('button', { name: 'Recheck selection', exact: true })).toBeHidden();
    expect(Math.abs((await footer.boundingBox())!.height - before)).toBeLessThan(2);
    // A background refresh must preserve the collapsed state and the edited deck.
    await page.evaluate(() => (window as any).writingPreview.view.render());
    await expect(deck).toHaveValue('English::My new deck');
    await expect(options).not.toHaveAttribute('open', '');
  });
}
for (const size of [
  { width: 320, height: 520 },
  { width: 390, height: 720 },
  { width: 600, height: 900 },
]) {
  test(`vocabulary actions remain reachable at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    for (const name of ['Regenerate', 'Add to Anki']) {
      const action = page.getByRole('button', { name, exact: true });
      await action.scrollIntoViewIfNeeded();
      expect(
        await action.evaluate((el) => {
          const r = el.getBoundingClientRect(),
            hit = el.ownerDocument.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return (
            r.x >= 0 &&
            r.right <= innerWidth &&
            r.y >= 0 &&
            r.bottom <= innerHeight &&
            !!hit &&
            (el === hit || el.contains(hit))
          );
        }),
      ).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
  test(`controls stay reachable with long content at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto('/?writing=1');
    await page.evaluate(() => {
      const p = (window as any).writingPreview;
      p.session.capture.book = 'A long source title with a lot of words '.repeat(3);
      p.session.deck = 'English::Writing::' + 'Long deck name::'.repeat(15);
      p.session.findings[0].after = 'written'.repeat(20);
      p.view.render();
    });
    const reachable = async (locator: any) => {
      await locator.evaluate((el: HTMLElement) => el.scrollIntoView({ block: 'nearest' }));
      const result = await locator.evaluate((el: HTMLElement) => {
        const r = el.getBoundingClientRect(),
          hit = el.ownerDocument.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const ok =
          r.x >= 0 &&
          r.right <= innerWidth &&
          r.y >= 0 &&
          r.bottom <= innerHeight &&
          !!hit &&
          (el === hit || el.contains(hit));
        return { ok, rect: r.toJSON(), text: el.textContent, hit: hit?.outerHTML.slice(0, 180) };
      });
      if (!result.ok) await page.screenshot({ path: '.test-artifacts/ui-obstruction.png' });
      expect(result.ok, JSON.stringify(result)).toBe(true);
    };
    await reachable(page.getByRole('button', { name: 'Open source', exact: true }));
    await reachable(page.getByRole('button', { name: 'Edit', exact: true }));
    await reachable(page.locator('[data-writing-card-toggle]'));
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Correction', { exact: true }).fill('wrote');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('alert').last()).toContainText('must change');
    await reachable(page.getByRole('alert').last());
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator('[data-writing-section=options]>summary').click();
    await reachable(page.getByLabel('Writing deck', { exact: true }));
    await reachable(page.getByRole('button', { name: 'Recheck selection', exact: true }));
    await page.locator('[data-writing-section=options]>summary').click();
    await page.getByRole('button', { name: 'Review 2 cards', exact: true }).click();
    for (const edit of await page.getByRole('button', { name: 'Edit card', exact: true }).all())
      await reachable(edit);
    await reachable(page.getByRole('button', { name: 'Add 2 cards to Anki', exact: true }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (size.width === 390) {
      await page.evaluate(() => {
        document.body.classList.add('theme-dark');
        document.documentElement.style.cssText +=
          ';--background-primary:#1e1e1e;--background-secondary:#252525;--background-primary-alt:#292929;--background-modifier-border:#414141;--text-normal:#ddd;--text-muted:#aaa;';
      });
      await page.addStyleTag({
        content: '#panel{background:var(--background-primary);color:var(--text-normal)}',
      });
      await reachable(page.getByRole('button', { name: 'Add 2 cards to Anki', exact: true }));
      await page.screenshot({
        path: '.test-artifacts/writing-preview-audit-dark.png',
        fullPage: true,
      });
    }
  });
}
