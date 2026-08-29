let cleanupActiveDialog: (() => void) | null = null;

export function installDialogBehavior() {
  if (typeof document === 'undefined') return () => undefined;

  const activateIfPresent = () => {
    const dialog = document.querySelector<HTMLElement>('.result-sheet[role="dialog"]');
    if (!dialog || dialog.dataset.focusManaged === 'true') return;

    cleanupActiveDialog?.();
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.dataset.focusManaged = 'true';
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;

    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute('hidden'));

    const onKeyDown = (event: KeyboardEvent) => {
      if (!dialog.isConnected) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        const later = dialog.querySelector<HTMLButtonElement>('.sheet-actions .muted');
        later?.click();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const focusPrimary = () => {
      const primary = dialog.querySelector<HTMLButtonElement>('.sheet-actions .sheet-primary');
      (primary || dialog).focus();
    };
    queueMicrotask(focusPrimary);

    const onReturned = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      if (!dialog.isConnected) return;
      focusPrimary();
    };
    document.addEventListener('visibilitychange', onReturned);
    window.addEventListener('pageshow', onReturned);

    cleanupActiveDialog = () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('visibilitychange', onReturned);
      window.removeEventListener('pageshow', onReturned);
      delete dialog.dataset.focusManaged;
      if (previous?.isConnected) previous.focus();
      cleanupActiveDialog = null;
    };
  };

  const observer = new MutationObserver(() => {
    const dialog = document.querySelector<HTMLElement>('.result-sheet[role="dialog"]');
    if (dialog) activateIfPresent();
    else cleanupActiveDialog?.();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  activateIfPresent();

  return () => {
    observer.disconnect();
    cleanupActiveDialog?.();
  };
}
