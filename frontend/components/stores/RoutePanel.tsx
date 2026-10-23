"use client";

import { distance, money } from "@/lib/format";
import { CheckIcon, PinIcon } from "../icons";
import SnappButton from "./SnappButton";

/** The map apps a shop's route opens in. Each link opens the app on phones and the web map elsewhere. */
export function mapLinks(lat: number, lng: number) {
  return [
    { id: "neshan", label: "نشان", href: `https://neshan.org/maps/routing/car/destination/${lat},${lng}` },
    { id: "balad", label: "بلد", href: `https://balad.ir/location?latitude=${lat}&longitude=${lng}&zoom=17` },
    { id: "google", label: "گوگل‌مپ", href: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` },
    { id: "waze", label: "ویز", href: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes` },
  ];
}

type Props = {
  shop: string; price: number | null; lat: number; lng: number; distanceM?: number | null;
  onBack: () => void;
};

/** What «خرید از …» turns into: the chosen shop, then the route in the map app the user picks, or Snapp. */
export default function RoutePanel({ shop, price, lat, lng, distanceM, onBack }: Props) {
  return (
    <section className="route-panel" role="region" aria-label={`مسیریابی تا ${shop}`}>
      <div className="route-head">
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className="route-chosen"><CheckIcon className="icon-sm" />خرید از {shop}</span>
          <b className="route-title">مسیر تا فروشگاه</b>
          <span className="row-sub">
            {distanceM != null ? `${distance(distanceM)} · ` : ""}
            {price != null ? <span className="num" style={{ fontWeight: 700, color: "var(--ink)" }}>{money(price)} تومان</span> : "قیمت: تماس بگیرید"}
          </span>
        </span>
        <button type="button" className="btn btn-ghost" style={{ height: 32, flex: "none" }} onClick={onBack}>برگشت</button>
      </div>
      <span className="route-ask">با کدوم نقشه بریم؟</span>
      <div className="route-maps">
        {mapLinks(lat, lng).map((m) => (
          <a key={m.id} className="btn btn-secondary route-map" href={m.href} target="_blank" rel="noreferrer">
            <PinIcon className="icon-sm" />{m.label}
          </a>
        ))}
      </div>
      <SnappButton shopName={shop} />
    </section>
  );
}
