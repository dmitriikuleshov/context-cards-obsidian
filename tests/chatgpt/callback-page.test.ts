// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { callbackPage } from '../../src/chatgpt-callback-page';

describe('local sign-in callback page', () => {
  it.each(['received', 'declined', 'invalid', 'already-received', 'not-found'] as const)(
    'renders a self-contained, readable %s page without remote resources',
    (status) => {
      const html = callbackPage(status);
      const page = new DOMParser().parseFromString(html, 'text/html');
      expect(page.title).toContain('Context Cards');
      expect(page.documentElement.lang).toBe('en');
      expect(page.querySelector('main')?.getAttribute('aria-labelledby')).toBe('title');
      expect(page.querySelector('#title')?.textContent).toBeTruthy();
      expect(page.querySelector('main')?.textContent).toContain('Obsidian');
      expect(page.querySelector('.message')?.textContent).toContain('Context Cards');
      expect(page.querySelector('.next')?.textContent).toContain('You can close this tab.');
      expect(page.querySelectorAll('script, link, img, iframe, form, a, button')).toHaveLength(0);
      expect(page.querySelector('style')?.textContent).toContain('prefers-color-scheme:light');
    },
  );
});
