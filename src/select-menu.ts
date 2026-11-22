import { Menu } from 'obsidian';

/** Keep the existing select's values/change handlers, with a themed Obsidian menu as its UI. */
export function enhanceSelects(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];
  let active: Menu | undefined;
  for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>('select'))) {
    const doc = select.ownerDocument;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'cc-select-button';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    const label = doc.createElement('span');
    label.className = 'cc-select-value';
    label.id = `cc-select-value-${crypto.randomUUID()}`;
    button.setAttribute('aria-describedby', label.id);
    button.append(label);
    const arrow = doc.createElement('span');
    arrow.className = 'cc-select-chevron';
    arrow.setAttribute('aria-hidden', 'true');
    button.append(arrow);
    const name =
      select.getAttribute('aria-label') ??
      select.closest('.setting-item')?.querySelector('.setting-item-name')?.textContent?.trim();
    if (name) button.setAttribute('aria-label', name);
    const labelledBy = select.getAttribute('aria-labelledby');
    if (labelledBy) button.setAttribute('aria-labelledby', labelledBy);
    if (select.id) {
      button.id = select.id;
      select.id += '-native';
    }
    for (const key of ['ccField', 'writingField'] as const) {
      if (select.dataset[key]) button.dataset[key] = select.dataset[key];
      delete select.dataset[key];
    }
    select.hidden = true;
    select.classList.add('cc-native-select');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.removeAttribute('aria-label');
    select.removeAttribute('aria-labelledby');
    select.after(button);
    const sync = () => {
      label.textContent = select.selectedOptions[0]?.textContent ?? 'Choose an option';
      button.disabled = select.disabled;
      button.title = label.textContent ?? '';
      if (button.disabled && button.getAttribute('aria-expanded') === 'true') active?.hide();
    };
    sync();
    select.addEventListener('change', sync);
    const attributes = new MutationObserver(sync);
    attributes.observe(select, { attributes: true, childList: true, subtree: true });
    const open = () => {
      if (select.disabled || !button.isConnected) return;
      if (button.getAttribute('aria-expanded') === 'true') {
        active?.hide();
        return;
      }
      active?.hide();
      const rect = button.getBoundingClientRect();
      const host = doc.createElement('div');
      host.className = 'cc-select-menu-host';
      host.style.setProperty('--cc-select-width', `${rect.width}px`);
      doc.body.append(host);
      const menu = new Menu().setUseNativeMenu(false).setParentElement(host);
      active = menu;
      const disconnected = new MutationObserver(() => {
        if (!button.isConnected) menu.hide();
      });
      disconnected.observe(doc.body, { childList: true, subtree: true });
      const close = () => menu.hide();
      const escape = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
        if (button.isConnected) button.focus({ preventScroll: true });
      };
      const scroll = (event: Event) => {
        if (event.target instanceof doc.defaultView!.Node && host.contains(event.target)) return;
        const current = button.getBoundingClientRect();
        if (Math.abs(current.x - rect.x) > 0.5 || Math.abs(current.y - rect.y) > 0.5) close();
      };
      doc.addEventListener('scroll', scroll, true);
      doc.addEventListener('keydown', escape, true);
      doc.defaultView?.addEventListener('resize', close);
      menu.onHide(() => {
        disconnected.disconnect();
        doc.removeEventListener('scroll', scroll, true);
        doc.removeEventListener('keydown', escape, true);
        doc.defaultView?.removeEventListener('resize', close);
        button.setAttribute('aria-expanded', 'false');
        if (active === menu) active = undefined;
        host.remove();
      });
      for (const option of Array.from(select.options)) {
        if (option.hidden) continue;
        const disabled =
          option.disabled ||
          (option.parentElement?.tagName === 'OPTGROUP' &&
            (option.parentElement as HTMLOptGroupElement).disabled);
        menu.addItem((item) =>
          item
            .setTitle(option.textContent ?? option.value)
            .setChecked(option.selected)
            .setDisabled(disabled)
            .onClick(() => {
              menu.hide();
              if (!button.isConnected || select.disabled || disabled) return;
              button.focus({ preventScroll: true });
              select.value = option.value;
              sync();
              select.dispatchEvent(new doc.defaultView!.Event('input', { bubbles: true }));
              select.dispatchEvent(new doc.defaultView!.Event('change', { bubbles: true }));
            }),
        );
      }
      button.setAttribute('aria-expanded', 'true');
      menu.showAtPosition(
        { x: rect.left, y: rect.bottom + 4, width: rect.width, overlap: true },
        doc,
      );
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        open();
      }
    };
    button.addEventListener('click', open);
    button.addEventListener('keydown', keydown);
    cleanups.push(() => {
      attributes.disconnect();
      select.removeEventListener('change', sync);
      button.removeEventListener('click', open);
      button.removeEventListener('keydown', keydown);
    });
  }
  return () => {
    active?.hide();
    for (const cleanup of cleanups) cleanup();
  };
}
