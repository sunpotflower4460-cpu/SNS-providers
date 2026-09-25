export type ThemePreference = 'auto' | 'light' | 'dark';

const KEY = 'sns-providers:theme';

export function loadThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyThemePreference(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

export function saveThemePreference(preference: ThemePreference) {
  applyThemePreference(preference);
  try {
    if (preference === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, preference);
  } catch {
    // Display preference only; the chosen theme still applies for this session.
  }
}
