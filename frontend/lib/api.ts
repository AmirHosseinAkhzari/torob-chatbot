import type { Area, Inquiry, LiveResult, ProductDetail, StoresResponse, UserLocation } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { signal });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

export const liveSearch = (q: string, signal?: AbortSignal) =>
  get<LiveResult>(`/api/search/live?q=${encodeURIComponent(q)}`, signal);

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

export async function startInquiry(body: { product_id: string; shop_id: string; phone: string }): Promise<Inquiry> {
  const res = await fetch(`${API_URL}/api/inquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "استعلام شروع نشد. دوباره امتحان کن.");
  return data as Inquiry;
}

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
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
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
