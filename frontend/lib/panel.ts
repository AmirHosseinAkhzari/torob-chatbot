/** API and types for the admin panel (/admin, admin.<domain>) and the store panel (/store). */
import { apiRequest } from "./api";
import { faDigits } from "./format";

const get = <T,>(path: string) => apiRequest<T>("GET", path);
const send = <T,>(method: string, path: string, body: unknown) => apiRequest<T>(method, path, body);
const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  return p.toString();
};

export type Counts = { suggested: number; not_suggested: number; buy_click: number; chose_other: number; phone_check: number; store_verify: number };
export type ReasonCount = { reason: string; n: number };
export type Overview = {
  days: number | null; counts: Counts; buy_value: number;
  reasons: { not_suggested: ReasonCount[]; suggested: ReasonCount[]; chose_other: ReasonCount[] };
  shops: { shop_id: string; name: string; area: string | null; test: boolean; suggested: number; not_suggested: number; buy_click: number; chose_other: number; phone_check: number }[];
  calls: { shop: string; product: string; status: string; listed_price: number | null; quoted_price: number | null; test_call: boolean; reasons: string[]; created_at: string }[];
  verification: { total: number; open: number; answered: number; expired: number; avg_minutes: number | null };
};
export type Totals = { shops: number; products: number; offers: number; areas: number; categories: number; area_list: { name: string; shops: number }[] };
export type ShopRow = {
  id: string; name: string; area: string | null; phones: string[] | null; test: boolean; offers: number;
  last_price_days: number | null; open_now: boolean | null; suggested: number; not_suggested: number; phone_check: number; open_requests: number;
};
export type HoursDay = { status: "open" | "all_day" | "closed" | "unknown"; start: string; end: string };
export type ShopForm = {
  name: string; area: string; address: string; phones: string[]; lat: number | null; lng: number | null;
  hours: Record<string, HoursDay>; payments: string[]; categories: string[]; test: boolean;
};
export type Staff = { phone: string; name: string; role: string; created_at: string };
export type ShopDetail = ShopForm & { id: string; offers: number; staff: Staff[] };
export type OfferRow = {
  offer_id: string; product_id: string; title: string; shop_id: string; shop: string; price: number | null;
  stock: "available" | "unavailable" | null; verified_price: number | null; price_status: string | null; price_days: number | null; source: string | null;
};
export type Change = { actor: string; kind: string; shop_id: string | null; offer_id: string | null; summary: string; created_at: string };
export type ImportResult = {
  matched: number; applied: number; unmatched: { line: number; reason: string }[]; invalid: { line: number; reason: string }[];
  preview: { line: number; title: string; shop: string; old_price: number | null; price: number | null; stock: string | null }[];
};

export type VStatus = "pending" | "in_progress" | "verified" | "unavailable" | "expired" | "cancelled";
export type VRequest = {
  id: number; offer_id: string; shop_id: string; product_id: string; product_title: string; shop_name: string;
  listed_price: number | null; price_days: number | null; reasons: string[]; status: VStatus; question: string;
  created_at: string; updated_at: string; claimed_by: string | null; resolved_by: string | null; resolved_at: string | null;
  stock: string | null; verified_price: number | null; note: string | null; followup_sent_at: string | null;
  followup_attempts: number; customers: number;
};
export type VEvent = { kind: string; actor: string | null; detail: Record<string, unknown>; created_at: string };
export type VNotification = { purpose: string; to_phone: string; attempt: number; ok: boolean; reason: string | null; text: string; created_at: string };
export type VDetail = VRequest & { events: VEvent[]; notifications: VNotification[] };
export type StoreDashboard = {
  shop: { id: string; name: string; area: string | null; hours: { open_now: boolean | null; today: string | null } };
  stats: { total: number; answered: number; open: number; verified_prices: number; unavailable: number; expired: number; avg_minutes: number | null; oldest_open: string | null; customers: number };
  open: VRequest[];
  activity: (VEvent & { request_id: number; product_title: string })[];
};

export const admin = {
  overview: (days: number | null) => get<Overview>(`/api/admin/overview?${qs({ days: days ?? 0 })}`),
  totals: () => get<Totals>("/api/admin/totals"),
  stores: (o: { q?: string; area?: string; test?: boolean; page?: number }) => get<{ total: number; page: number; size: number; stores: ShopRow[] }>(`/api/admin/stores?${qs(o)}`),
  store: (id: string) => get<ShopDetail>(`/api/admin/stores/${encodeURIComponent(id)}`),
  createStore: (f: ShopForm) => send<{ id: string }>("POST", "/api/admin/stores", f),
  updateStore: (id: string, f: ShopForm) => send<{ id: string }>("PUT", `/api/admin/stores/${encodeURIComponent(id)}`, f),
  addStaff: (id: string, s: { phone: string; name: string; role: string }) => send<{ ok: boolean }>("POST", `/api/admin/stores/${encodeURIComponent(id)}/staff`, s),
  removeStaff: (id: string, phone: string) => send<{ ok: boolean }>("DELETE", `/api/admin/stores/${encodeURIComponent(id)}/staff/${encodeURIComponent(phone)}`, undefined),
  offers: (o: { q?: string; shop?: string; stale?: boolean }) => get<{ offers: OfferRow[] }>(`/api/admin/offers?${qs(o)}`),
  patchOffer: (id: string, b: { price?: number | null; stock?: string | null }) => send<unknown>("PATCH", `/api/admin/offers/${encodeURIComponent(id)}`, b),
  importPrices: (text: string, apply: boolean) => send<ImportResult>("POST", "/api/admin/import", { text, apply }),
  changes: () => get<{ changes: Change[] }>("/api/admin/changes"),
};

export const store = {
  dashboard: (shop: string) => get<StoreDashboard>(`/api/store/${encodeURIComponent(shop)}/dashboard`),
  requests: (shop: string, status: string) => get<{ requests: VRequest[] }>(`/api/store/${encodeURIComponent(shop)}/requests?${qs({ status })}`),
  request: (id: number) => get<VDetail>(`/api/store/requests/${id}`),
  claim: (shop: string, id: number) => send<{ ok: boolean }>("POST", `/api/store/${encodeURIComponent(shop)}/requests/${id}/claim`, {}),
  resolve: (shop: string, id: number, b: { stock: string; price: number | null; note: string | null }) =>
    send<{ id: number; status: string; customers_notified: number }>("POST", `/api/store/${encodeURIComponent(shop)}/requests/${id}/resolve`, b),
  offers: (shop: string, o: { q?: string; stale?: boolean }) => get<{ offers: OfferRow[] }>(`/api/store/${encodeURIComponent(shop)}/offers?${qs(o)}`),
  patchOffer: (shop: string, id: string, b: { price?: number | null; stock?: string | null }) =>
    send<unknown>("PATCH", `/api/store/${encodeURIComponent(shop)}/offers/${encodeURIComponent(id)}`, b),
};

/** «۱ ساعت و ۱۲ دقیقه» since an ISO time. */
export function waited(iso: string | null, until?: string | null) {
  if (!iso) return "";
  const m = Math.max(0, Math.round(((until ? new Date(until) : new Date()).getTime() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "همین الان";
  if (m < 60) return `${faDigits(m)} دقیقه`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${faDigits(h)} ساعت و ${faDigits(r)} دقیقه` : `${faDigits(h)} ساعت`;
  return `${faDigits(Math.floor(h / 24))} روز`;
}

export function when(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const t = d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" });
  return today ? `امروز ${t}` : `${d.toLocaleDateString("fa-IR", { day: "numeric", month: "long", timeZone: "Asia/Tehran" })} ${t}`;
}

export const STATUS_FA: Record<VStatus, string> = {
  pending: "در انتظار", in_progress: "در حال بررسی", verified: "تأیید شده", unavailable: "ناموجود", expired: "منقضی", cancelled: "لغو شده",
};
export const VREASON_FA: Record<string, string> = {
  stale_price: "قیمت قدیمیه", no_price: "قیمت ثبت نشده", stock_unknown: "موجودی نامشخص", store_closed: "فروشگاه بسته بود",
};
export const REASON_FA: Record<string, string> = {
  more_expensive: "گرون‌تر از پیشنهاد", farther: "دورتر از پیشنهاد", closed_now: "الان بسته بود", no_price: "قیمت نداشت",
  stale_price: "قیمت قدیمی", outlier_price: "قیمت غیرعادی", said_unavailable: "تلفنی گفت ناموجود",
  open_now: "الان باز بود", cheapest_city: "ارزون‌ترین در کل تهران", nearest: "نزدیک‌ترین", cheapest_nearby: "ارزون‌ترینِ نزدیک",
  stock_confirmed: "موجودی تأیید شده", cheaper: "ارزون‌تر بود", nearer: "نزدیک‌تر بود", recommended_stale: "قیمت پیشنهاد قدیمی بود",
  recommended_closed: "پیشنهاد بسته بود", warranty: "گارانتی داشت",
};
export const reasonFa = (r: string) => (r.startsWith("user_said:") ? `کاربر: ${r.slice(10)}` : REASON_FA[r] ?? r);
export const DAYS: { key: string; fa: string }[] = [
  { key: "sat", fa: "شنبه" }, { key: "sun", fa: "یکشنبه" }, { key: "mon", fa: "دوشنبه" }, { key: "tue", fa: "سه‌شنبه" },
  { key: "wed", fa: "چهارشنبه" }, { key: "thu", fa: "پنج‌شنبه" }, { key: "fri", fa: "جمعه" },
];
export const PAYMENTS = ["کارتخوان", "ترب‌پی", "اسنپ‌پی", "دیجی پی", "ازکی‌وام", "تارا"];
