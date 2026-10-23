const FA = "۰۱۲۳۴۵۶۷۸۹";

export const faDigits = (v: string | number) => String(v).replace(/[0-9]/g, (d) => FA[Number(d)]);

export const toLatinDigits = (v: string) => v.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

/** 68332200 -> ۶۸٬۳۳۲٬۲۰۰ */
export const money = (v: number | null | undefined) =>
  v == null ? "" : faDigits(Math.round(v).toLocaleString("en-US")).replace(/,/g, "٬");

/** 68332200 -> ۶۸٫۳ میلیون */
export const shortMoney = (v: number | null | undefined) => {
  if (v == null) return "";
  if (v >= 1_000_000_000) return faDigits((v / 1_000_000_000).toFixed(1).replace(/\.0$/, "")).replace(".", "٫") + " میلیارد";
  if (v >= 1_000_000) return faDigits((v / 1_000_000).toFixed(1).replace(/\.0$/, "")).replace(".", "٫") + " م";
  if (v >= 1_000) return faDigits(Math.round(v / 1_000)) + " هزار";
  return faDigits(v);
};

export const priceGap = (v: number) => {
  if (v < 1_000_000) return faDigits(Math.round(v / 1_000)) + " هزار تومان";
  return faDigits((v / 1_000_000).toFixed(1).replace(/\.0$/, "")).replace(".", "٫") + " میلیون تومان";
};

export const daysAgo = (d: number | null | undefined) => {
  if (d == null) return null;
  if (d === 0) return "امروز";
  if (d === 1) return "دیروز";
  if (d < 30) return `${faDigits(d)} روز پیش`;
  if (d < 365) return `${faDigits(Math.round(d / 30))} ماه پیش`;
  return "بیش از یک سال پیش";
};

export const distance = (m: number | null | undefined) => {
  if (m == null) return null;
  if (m < 1000) return `${faDigits(Math.round(m / 10) * 10)} متر`;
  return `${faDigits((m / 1000).toFixed(1).replace(/\.0$/, "")).replace(".", "٫")} کیلومتر`;
};

export const shortTitle = (t: string, n = 42) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

/** Great-circle distance in meters. */
export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(h));
}
