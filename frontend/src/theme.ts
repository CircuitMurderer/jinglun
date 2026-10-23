export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = Exclude<ThemePreference, 'system'>;

const storageKey = 'jinglun.theme';
const system = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === 'light' || value === 'dark') return value;
  } catch { /* Theme selection also works without browser storage. */ }
  return 'system';
}

let preference = readPreference();
let snapshot = resolve();

function resolve(): { preference: ThemePreference; resolved: Theme } {
  return { preference, resolved: preference === 'system' ? (system.matches ? 'dark' : 'light') : preference };
}

function update(): void {
  snapshot = resolve();
  const root = document.documentElement;
  root.dataset.theme = snapshot.resolved;
  root.style.colorScheme = snapshot.resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', snapshot.resolved === 'dark' ? '#050b14' : '#edf3f2');
  for (const listener of listeners) listener();
}

export function getThemeSnapshot() { return snapshot; }
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try { localStorage.setItem(storageKey, next); } catch { /* Optional persistence. */ }
  update();
}

system.addEventListener('change', () => { if (preference === 'system') update(); });
window.addEventListener('storage', (event) => {
  if (event.key === storageKey || event.key === null) { preference = readPreference(); update(); }
});
update();
