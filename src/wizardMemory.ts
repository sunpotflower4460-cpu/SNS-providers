import type { StepGroup } from './setupSteps';

/**
 * Remembers where the user is in the setup popup across leaving the app. On iPhone the
 * home-screen app can be reloaded while the user works on Cloudflare / X, so the step,
 * the ticked todos and "the popup was open" live in localStorage, not only in memory.
 */
const POSITION_KEY = 'sns-providers:wizard-position';
const TODO_KEY = 'sns-providers:wizard-todo';

export interface WizardPosition {
  group: StepGroup;
  id: string;
  /** The popup was open when the user left the app; reopen it on return. */
  open: boolean;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Convenience only; the popup still works for this session.
  }
}

export function loadPosition(): WizardPosition | null {
  const value = read<Partial<WizardPosition> | null>(POSITION_KEY, null);
  if (!value || typeof value.id !== 'string' || !['core', 'x', 'instagram'].includes(String(value.group))) return null;
  return { group: value.group as StepGroup, id: value.id, open: value.open === true };
}

export function savePosition(position: WizardPosition | null) {
  if (!position) {
    try { localStorage.removeItem(POSITION_KEY); } catch { /* ignore */ }
    return;
  }
  write(POSITION_KEY, position);
}

export function markWizardClosed() {
  const position = loadPosition();
  if (position) savePosition({ ...position, open: false });
}

export function loadTodoChecks(stepId: string): boolean[] {
  const all = read<Record<string, unknown>>(TODO_KEY, {});
  const list = all[stepId];
  return Array.isArray(list) ? list.map((item) => item === true) : [];
}

export function saveTodoChecks(stepId: string, checks: boolean[]) {
  const all = read<Record<string, unknown>>(TODO_KEY, {});
  write(TODO_KEY, { ...all, [stepId]: checks });
}

/** Forget ticks once a step is finished or the guide is restarted, so a rerun starts clean. */
export function clearTodoChecks(stepIds: string[]) {
  const all = read<Record<string, unknown>>(TODO_KEY, {});
  for (const id of stepIds) delete all[id];
  write(TODO_KEY, all);
}

/** iPhone / iPad home-screen app: links open in an overlay sheet that hides the popup. */
export function isIosHomeScreenApp() {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
    || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  return ios && standalone;
}

/** Opens the page in the Safari app (iOS 17+), so the user can switch back and forth. */
export function safariUrl(href: string) {
  return href.startsWith('https://') ? `x-safari-${href}` : href;
}
