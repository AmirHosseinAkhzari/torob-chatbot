import { putSettings } from "./api";
import { getSession, saveSession, type Settings } from "./session";

export type Theme = NonNullable<Settings["theme"]>;
const CACHE_KEY = "torob-chat:theme"; // read before paint by app/layout.tsx
export const THEME_EVENT = "torob-chat:theme";
export const THEME_LABEL: Record<Theme, string> = { system: "تم: مثل سیستم", light: "تم: روشن", dark: "تم: تیره" };

/** "system" follows the device; light/dark are fixed. */
export function applyTheme(theme: Theme | undefined) {
  const t = theme ?? "system";
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
  try {
    if (t === "system") localStorage.removeItem(CACHE_KEY);
    else localStorage.setItem(CACHE_KEY, t);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function currentTheme(): Theme {
  return getSession()?.settings?.theme ?? "system";
}

/** System → light → dark → system; saved on the account. */
export function cycleTheme() {
  const order: Theme[] = ["system", "light", "dark"];
  const next = order[(order.indexOf(currentTheme()) + 1) % order.length];
  const s = getSession();
  if (s) saveSession({ ...s, settings: { ...s.settings, theme: next } });
  applyTheme(next);
  putSettings({ theme: next }).catch(() => {});
}
