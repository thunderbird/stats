const trackedDocuments = new WeakSet();

/** Native focus-visible treats text inputs as keyboard targets even after a click.
 * Track explicit input changes so mouse use never leaves a keyboard outline. */
export function trackFocusInput(document) {
  if (trackedDocuments.has(document)) return;
  trackedDocuments.add(document);
  document.documentElement.dataset.inputMethod = 'pointer';
  document.addEventListener('keydown', event => {
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key))
      document.documentElement.dataset.inputMethod = 'keyboard';
  }, true);
  document.addEventListener('pointerdown', () => {
    document.documentElement.dataset.inputMethod = 'pointer';
  }, true);
}

export function hasKeyboardFocus(element) {
  const document = element.ownerDocument;
  return document.activeElement === element &&
    (document.documentElement.dataset.inputMethod === 'keyboard' ||
      (!document.documentElement.dataset.inputMethod && element.matches(':focus-visible')));
}
