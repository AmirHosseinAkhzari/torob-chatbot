"use client";

import { useEffect, useMemo, useState } from "react";
import { distance, faDigits, metersBetween, money, shortMoney, toLatinDigits } from "@/lib/format";
import { getSavedLocation, saveLocation } from "@/lib/store";
import type { Bnpl, BnplSeller, ProductCard, UserLocation } from "@/lib/types";
import { useIsTouchDevice } from "@/lib/useMedia";
import { InfoIcon, MapIcon, PhoneIcon, StoreIcon, TargetIcon } from "../icons";
import { PaymentLogo } from "../PaymentLogo";
import SnappButton from "../stores/SnappButton";
import { useUI } from "../UIContext";

type Ranked = BnplSeller & { d: number | null };
type Mode = "near" | "area" | "cheap";

/** Nearest first when we know where the user is; otherwise the backend order (cheapest first). */
function rank(sellers: BnplSeller[], loc: UserLocation | null): { list: Ranked[]; mode: Mode } {
  if (loc?.lat != null && loc?.lng != null) {
    const me = { lat: loc.lat, lng: loc.lng };
    const list = sellers
      .map((s) => ({ ...s, d: s.lat != null && s.lng != null ? metersBetween(me, { lat: s.lat, lng: s.lng }) : null }))
      .sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
    return { list, mode: "near" };
  }
  if (loc?.area) {
    const list = [...sellers].map((s) => ({ ...s, d: s.distance_m }))
      .sort((a, b) => Number(b.area === loc.area) - Number(a.area === loc.area) || (a.d ?? Infinity) - (b.d ?? Infinity));
    return { list, mode: list[0]?.area === loc.area ? "area" : list[0]?.d != null ? "near" : "cheap" };
  }
  return { list: sellers.map((s) => ({ ...s, d: null })), mode: "cheap" };
}

export const payLabel = (b: Bnpl) => (b.filter === "any" ? "خرید قسطی" : b.filter);

/** Bottom of a product card while the user is buying on credit: the provider's plan, then the
    nearest shop that accepts it with call, Snapp (phones only) and map. Shops without it never show. */
export default function BnplStrip({ p }: { p: ProductCard }) {
  const b = p.bnpl!;
  const { openProduct } = useUI();
  const touch = useIsTouchDevice();
  const [loc, setLoc] = useState<UserLocation | null>(null);
  const [locating, setLocating] = useState(false);
  useEffect(() => setLoc(getSavedLocation()), []);
  const { list, mode } = useMemo(() => rank(b.sellers, loc), [b.sellers, loc]);
  const shop = list[0];
  const label = payLabel(b);

  if (!b.seller_count || !b.provider || !shop) {
    return (
      <div className="bnpl is-empty">
        <InfoIcon className="icon-sm" />
        هیچ فروشنده‌ی این کالا {label} نداره.
      </div>
    );
  }

  function locate() {
    if (!("geolocation" in navigator)) {
      openProduct(p.id, "map", b.filter);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const l = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "موقعیت فعلی تو" };
        saveLocation(l);
        setLoc(l);
        setLocating(false);
      },
      () => {
        // No permission: the map tab lets them pick a province and neighborhood instead.
        setLocating(false);
        openProduct(p.id, "map", b.filter);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  const others = b.providers.filter((x) => x !== b.provider);
  const tel = shop.phone ? `tel:${toLatinDigits(shop.phone).replace(/[^\d+]/g, "")}` : null;
  const heading =
    mode === "near" ? `نزدیک‌ترین فروشگاه با ${label}` : mode === "area" ? `فروشگاه با ${label} در ${loc?.area}` : `فروشگاه حضوری با ${label}`;
  const facts = [
    shop.area,
    shop.d != null ? distance(shop.d) : null,
    shop.open_now == null ? null : shop.open_now ? "باز است" : "بسته است",
    shop.price ? `${money(shop.price)} تومان` : "قیمت: تماس بگیرید",
  ].filter(Boolean);

  return (
    <div className="bnpl" aria-label={`خرید قسطی ${p.title}`}>
      <div className="bnpl-plan">
        <PaymentLogo name={b.provider} small />
        <div className="bnpl-plan-text">
          <b>قسطی با {b.provider}</b>
          {b.plan ? (
            <span className="bnpl-parts num">
              {b.plan.map((r) => <span key={r.label}>{r.label} <b>{money(r.value)}</b></span>)}
              <span>تومان · تخمینی</span>
            </span>
          ) : (
            <span className="row-sub">{b.terms}</span>
          )}
        </div>
        {others.length ? (
          <span className="bnpl-others" title={`این‌ها هم هست: ${others.join("، ")}`}>
            {others.map((o) => <PaymentLogo key={o} name={o} small />)}
          </span>
        ) : null}
      </div>

      <div className="bnpl-store">
        <StoreIcon className="icon-sm" />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="row-sub">{heading}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <b style={{ fontSize: 14 }}>{shop.shop}</b>
            {b.filter === "any" ? shop.providers.map((x) => <PaymentLogo key={x} name={x} small />) : null}
          </span>
          <span className="row-sub num">{facts.join(" · ")}</span>
        </div>
      </div>

      <div className="bnpl-acts">
        {tel ? (
          <a className="btn btn-secondary btn-sm" href={tel} aria-label={`تماس با ${shop.shop}`}>
            <PhoneIcon className="icon-sm" />
            {touch ? "تماس" : <span className="num">{faDigits(shop.phone!)}</span>}
          </a>
        ) : null}
        {touch && shop.lat != null ? (
          <SnappButton shopName={shop.shop} size="sm" />
        ) : null}
        {mode !== "near" ? (
          <button className="btn btn-ghost btn-sm" onClick={locate} disabled={locating}>
            <TargetIcon className="icon-sm" />
            {locating ? "در حال گرفتن موقعیت…" : "نزدیک‌ترین به من"}
          </button>
        ) : null}
        <button className="btn btn-ghost btn-sm" onClick={() => openProduct(p.id, "map", b.filter)}>
          <MapIcon className="icon-sm" />
          {b.seller_count > 1 ? `${faDigits(b.seller_count)} فروشگاه روی نقشه` : "روی نقشه"}
        </button>
      </div>
    </div>
  );
}

/** Small version for the compact product row. */
export function BnplTag({ b }: { b: Bnpl }) {
  if (!b.provider || !b.seller_count) return <span className="bnpl-tag is-empty">{payLabel(b)} نداره</span>;
  const first = b.plan?.[0];
  return (
    <span className="bnpl-tag num">
      <PaymentLogo name={b.provider} small />
      {first ? `${first.label} ${shortMoney(first.value)}` : `قسطی با ${b.provider}`}
    </span>
  );
}
