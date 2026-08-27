import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function useModalA11y<T extends HTMLElement>(onDismiss: () => void) {
  const containerRef = useRef<T>(null);
  // Keep the latest callback in a ref instead of the effect's dependency array.
  // Callers typically pass an inline arrow function, which gets a new identity
  // on every parent render; depending on it directly would tear down and
  // re-run this effect (re-focusing the first element, re-adding the listener)
  // on every unrelated parent re-render while the modal is open.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = container?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusable?.[0] || container)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onDismissRef.current();
        return;
      }
      if (event.key !== 'Tab' || !container) return;
      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('disabled'));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return containerRef;
}
