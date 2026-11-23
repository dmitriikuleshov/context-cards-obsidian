import { test, expect } from '@playwright/test';
test('subscription settings connect, choose a model and sign out with clear states', async ({
  page,
}) => {
  await page.goto('/?chatgpt');
  await expect(page.getByRole('status')).toHaveText('Not connected');
  await expect(
    page.getByText('No API key or automatic switch to API billing.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('reader@example.com · Connected');
  await page.getByRole('button', { name: 'ChatGPT model', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'GPT-6 Luna', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ChatGPT model', exact: true })).toHaveText(
    'GPT-6 Luna',
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Signed out');
  await expect(
    page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }),
  ).toBeEnabled();
});
test('subscription errors keep the saved model and offer an explicit refresh', async ({ page }) => {
  await page.goto('/?chatgpt&limit');
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('usage limit reached');
  await expect(page.getByRole('button', { name: 'ChatGPT model', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Refresh models', exact: true })).toBeEnabled();
});
test('narrow settings fit and preserve local settings when switching back', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/?chatgpt');
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Connected');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Provider', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Ollama · local model', exact: true }).click();
  await expect(page.getByText('Your Ollama model and server settings are kept.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
});
