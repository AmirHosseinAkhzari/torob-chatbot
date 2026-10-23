/** The login session (from /login): {token, phone, settings}. Kept in this browser; the account lives on the server. */
export type Settings = { theme?: "system" | "light" | "dark" };
export type Session = { token: string; phone: string; settings?: Settings };

const SESSION_KEY = "torob-chat:session";
export const SESSION_EVENT = "torob-chat:session";

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(SESSION_EVENT));
}
