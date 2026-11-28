const SCOPE =
  '.cc-panel,.cc-settings,.cc-floating,.cc-model-control,.cc-chatgpt-settings,.cc-select-menu-host,.cc-tooltip-scope';

/** Obsidian also uses aria-label as hover text. Keep names without that tooltip trigger. */
export function suppressPluginTooltips(doc: Document): () => void {
  const labels = new WeakMap<Element, HTMLSpanElement>();
  const convert = (element: Element) => {
    if (!element.closest(SCOPE) || !element.parentNode) return;
    const name = element.getAttribute('aria-label');
    let label = labels.get(element);
    if (name === null && !label) return;
    if (!label && element.hasAttribute('aria-labelledby')) {
      element.removeAttribute('aria-label');
      return;
    }
    if (!label) {
      label = doc.createElement('span');
      label.id = `cc-label-${crypto.randomUUID()}`;
      label.hidden = true;
      label.style.display = 'none';
      labels.set(element, label);
      element.setAttribute('data-cc-quiet-label', '');
      element.setAttribute('aria-labelledby', label.id);
    }
    if (name !== null) label.textContent = name;
    if (label.parentNode !== element.parentNode) element.after(label);
    if (name !== null) element.removeAttribute('aria-label');
  };
  const scan = (node: Node) => {
    if (node.nodeType !== 1) return;
    const root = node as Element;
    if (!root.closest(SCOPE)) {
      for (const owned of Array.from(root.querySelectorAll(SCOPE))) scan(owned);
      return;
    }
    convert(root);
    for (const element of Array.from(root.querySelectorAll('[aria-label],[data-cc-quiet-label]')))
      convert(element);
  };
  scan(doc.body);
  const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
  const observer = new Observer((changes) => {
    for (const change of changes) {
      if (change.type === 'attributes') convert(change.target as Element);
      else for (const node of Array.from(change.addedNodes)) scan(node);
    }
  });
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-label'],
  });
  return () => observer.disconnect();
}
