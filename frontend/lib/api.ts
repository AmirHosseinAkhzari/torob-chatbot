import { getSession, saveSession, type Settings } from "./session";
import type { Area, Conversation, Inquiry, ProductDetail, StoresResponse, UserLocation } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Every request carries the login token. A 401 means the session ended: forget it and go to /login. */
function headers(json = false): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  const s = typeof window !== "undefined" ? getSession() : null;
  if (s?.token) h.Authorization = `Bearer ${s.token}`;
  return h;
}

function onUnauthorized() {
  if (typeof window === "undefined") return;
  saveSession(null);
  if (!location.pathname.startsWith("/login")) location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method, signal, headers: headers(body !== undefined), body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith("/api/auth/")) onUnauthorized();
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "مشکلی پیش اومد. دوباره امتحان کن.");
  return data as T;
}

const get = <T,>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal);
const post = <T,>(path: string, body: unknown) => request<T>("POST", path, body);

export const getProduct = (id: string, signal?: AbortSignal) =>
  get<ProductDetail>(`/api/products/${encodeURIComponent(id)}`, signal);

export const getStores = (id: string, loc: UserLocation | null, pay?: string | null, signal?: AbortSignal, shop?: string | null) => {
  const params = new URLSearchParams();
  if (pay) params.set("pay", pay);
  if (shop) params.set("shop", shop);
  if (loc?.lat != null && loc?.lng != null) {
    params.set("lat", String(loc.lat));
    params.set("lng", String(loc.lng));
  } else if (loc?.area) {
    params.set("area", loc.area);
  }
  return get<StoresResponse>(`/api/products/${encodeURIComponent(id)}/stores?${params}`, signal);
};

/** استعلام دستگاه: the result is texted to the account's phone. */
export const startInquiry = (body: { product_id: string; shop_id: string }) => post<Inquiry>("/api/inquiries", body);

export const getInquiry = (id: string, signal?: AbortSignal) => get<Inquiry>(`/api/inquiries/${encodeURIComponent(id)}`, signal);

export const getAreas = () => get<{ city: string; areas: Area[] }>(`/api/areas`);

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "status"; id: number; state: "running" | "done"; text: string; count?: number }
  | { type: "sources"; searches: number; items: { id: string; title: string; image: string | null; price: number | null }[] }
  | { type: "block"; block: import("./types").Block }
  | { type: "memo"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

export async function streamChat(
  body: { message: string; history: { role: string; content: string }[]; attachments: string[]; location: Omit<UserLocation, "label"> | null },
  onEvent: (e: ChatEvent) => void,
  signal: AbortSignal,
) {
  const res = await fetch(`${API_URL}/api/chat`, { method: "POST", headers: headers(true), body: JSON.stringify(body), signal });
  if (res.status === 401) onUnauthorized();
  if (!res.ok || !res.body) throw new Error(`chat ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {
            /* ignore a malformed line */
          }
        }
      }
    }
  }
}

/* Login with a one-time code by SMS. dev_code comes back only while the backend's SMS sending is off. */
export const requestOtp = (phone: string) =>
  post<{ sent: boolean; resend_after: number; ttl: number; dev_code?: string }>("/api/auth/otp/request", { phone });

export const verifyOtp = (phone: string, code: string) =>
  post<{ token: string; phone: string; settings: Settings }>("/api/auth/otp/verify", { phone, code });

export const getMe = () => get<{ phone: string; settings: Settings }>("/api/me");
export const putSettings = (s: Settings) => request<{ settings: Settings }>("PUT", "/api/me/settings", s);
export const logout = () => post<{ ok: boolean }>("/api/auth/logout", {}).catch(() => null);

/* Chat history on the account. */
export const listConversations = () => get<{ conversations: Conversation[] }>("/api/conversations");
export const fetchConversation = (id: string) => get<Conversation>(`/api/conversations/${encodeURIComponent(id)}`);
export const putConversation = (c: Conversation) => request<{ ok: boolean }>("PUT", `/api/conversations/${encodeURIComponent(c.id)}`, c);
export const deleteConversation = (id: string) => request<{ ok: boolean }>("DELETE", `/api/conversations/${encodeURIComponent(id)}`);

/* Store insights: where the user chose to buy (and why, when they say). Saved only. */
export const recordChoice = (body: {
  product_id: string; offer_id: string; recommended_offer_id?: string | null; lat?: number | null; lng?: number | null;
  user_said?: string | null; context?: string;
}) => post<{ saved: boolean }>("/api/store-events/choice", body).catch(() => null);
