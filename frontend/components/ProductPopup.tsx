"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { getProduct, recordChoice } from "@/lib/api";
import { daysAgo, faDigits, metersBetween, money } from "@/lib/format";
import { getSavedLocation } from "@/lib/store";
import BuyButton from "./BuyButton";
import type { Offer, ProductCard, ProductDetail } from "@/lib/types";
import { ChevronDown, CloseIcon, ExternalIcon, PhoneIcon, ShieldIcon, TruckIcon, WarnIcon } from "./icons";
import { acceptsPay, PaymentLogo } from "./PaymentLogo";
import StoresView from "./stores/StoresView";

type Props = { id: string; initialTab: "sellers" | "map"; pay?: string | null; onClose: () => void; onAsk: (p: ProductCard) => void };

/** Torob's product preview pop-up: centered on desktop, a bottom sheet on phones.
    With `pay` (buying on credit) it lists only the sellers that accept that installment provider. */
export default function ProductPopup({ id, initialTab, pay = null, onClose, onAsk }: Props) {
  const [p, setP] = useState<ProductDetail | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState(initialTab);
  const [showSpecs, setShowSpecs] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [image, setImage] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getProduct(id, ctrl.signal).then(setP).catch((e) => e.name !== "AbortError" && setError(true));
    return () => ctrl.abort();
  }, [id]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const sellers = (p?.offers ?? []).filter((o) => !pay || acceptsPay(o.shop.payments, pay));
  const priced = sellers.filter((o) => o.price != null && !o.outlier);
  const cheapest = priced[0];
  const offers = showAll ? sellers : sellers.slice(0, 6);
  // The nearest in-person seller, when the user's position is known (for the «نزدیک‌ترین» tag).
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    const l = getSavedLocation();
    if (l?.lat != null && l?.lng != null) setHere({ lat: l.lat, lng: l.lng });
  }, []);
  const nearest = here
    ? sellers.filter((o) => o.shop.lat != null && o.shop.lng != null && o.price != null && !o.outlier)
        .map((o) => ({ id: o.offer_id, d: metersBetween(here, { lat: o.shop.lat!, lng: o.shop.lng! }) }))
        .sort((a, b) => a.d - b.d)[0] ?? null
    : null;
  const minPrice = pay ? cheapest?.price ?? null : p?.price.min ?? null;
  const payLabel = pay === "any" ? "خرید قسطی" : pay;

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="پیش‌نمایش محصول">
        <header className="modal-head">
          <h2>پیش‌نمایش محصول</h2>
          <button ref={closeRef} className="btn btn-ghost btn-icon" onClick={onClose} aria-label="بستن"><CloseIcon /></button>
        </header>

        <div className="modal-body">
          {error ? <div className="answer-error">اطلاعات این محصول رو نتونستم بیارم.</div> : null}
          {!p && !error ? (
            <div className="searching"><img className="pixel" src="/brand/searching.gif" width={56} height={56} alt="" /><span className="muted">در حال آوردن قیمت‌ها…</span></div>
          ) : null}
          {p ? (
            <>
              <div className="gallery">
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {p.images?.length ? (
                    <img className="gallery-main product-img" src={p.images[image] ?? p.image ?? ""} alt={p.title} referrerPolicy="no-referrer" />
                  ) : <div className="gallery-main" style={{ background: "var(--surface-sunken)" }} />}
                  {p.images && p.images.length > 1 ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      {p.images.slice(0, 4).map((src, i) => (
                        <button key={src} onClick={() => setImage(i)} aria-label={`عکس ${faDigits(i + 1)}`}
                          style={{ padding: 0, border: `2px solid ${i === image ? "var(--brand-ink)" : "var(--divider)"}`, borderRadius: 6, background: "#fff", cursor: "pointer" }}>
                          <img className="product-img" src={src} alt="" width={36} height={36} referrerPolicy="no-referrer" style={{ display: "block" }} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  <b style={{ fontSize: 15, lineHeight: "26px", fontWeight: 500 }}>{p.title}</b>
                  <div className="offer-badges">
                    {p.stock ? <span className="badge badge-warn">استوک</span> : null}
                    {p.lookalike ? <span className="badge badge-warn">طرح (غیراصل)</span> : null}
                    <span className="badge badge-plain">{faDigits(pay ? sellers.length : p.shop_count)} فروشنده{pay ? ` با ${payLabel}` : ""}</span>
                    {sellers.some((o) => o.shop.fast_delivery) ? <span className="badge badge-ok"><TruckIcon className="icon-sm" />ارسال سریع</span> : null}
                    {sellers.some((o) => o.warranty && o.warranty !== "بدون گارانتی") ? <span className="badge badge-ok"><ShieldIcon className="icon-sm" />با گارانتی</span> : null}
                  </div>
                  {p.specs.length ? (
                    <dl className="spec-dl">{p.specs.map((s) => <Fragment key={s.key}><dt>{s.key}</dt><dd>{s.value}</dd></Fragment>)}</dl>
                  ) : null}
                  <span className="price num" style={{ marginTop: "auto", fontSize: 18 }}>
                    {minPrice != null ? <>از {money(minPrice)} تومان</> : "قیمت ثبت نشده"}
                  </span>
                </div>
              </div>

              {cheapest ? (
                <div className="cheapest">
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 12, color: "var(--brand-ink)", fontWeight: 500 }}>ارزان‌ترین</span>
                    <b className="num" style={{ fontSize: 16 }}>{money(cheapest.price)} تومان</b>
                    {cheapest.updated_days != null ? <span className="row-sub">قیمت {daysAgo(cheapest.updated_days)} به‌روز شده</span> : null}
                  </div>
                  <button className="btn btn-primary" onClick={() => setTab("map")}>{cheapest.shop.name}</button>
                </div>
              ) : null}

              {pay ? (
                <div className="pay-filter">
                  {pay !== "any" ? <PaymentLogo name={pay} small /> : null}
                  <span>فقط فروشنده‌هایی که {payLabel} دارن</span>
                </div>
              ) : null}

              <div className="tabs" role="tablist" aria-label="فروشنده‌ها">
                <button className="tab" role="tab" aria-selected={tab === "sellers"} onClick={() => setTab("sellers")}>
                  فروشنده‌ها <span className="muted num">({faDigits(sellers.length)})</span>
                </button>
                <button className="tab" role="tab" aria-selected={tab === "map"} onClick={() => setTab("map")}>حضوری، روی نقشه</button>
              </div>

              {tab === "sellers" ? (
                <div className="list" style={{ border: "1px solid var(--divider)" }}>
                  {offers.map((o) => (
                    <OfferRow key={o.offer_id} o={o} productId={p.id} onMap={() => setTab("map")}
                      cheapest={o.offer_id === cheapest?.offer_id} nearestM={nearest?.id === o.offer_id ? nearest.d : null}
                      onBuy={() => recordChoice({ product_id: p.id, offer_id: o.offer_id, recommended_offer_id: cheapest?.offer_id ?? null,
                        lat: here?.lat ?? null, lng: here?.lng ?? null, context: "sellers" })} />
                  ))}
                  {sellers.length === 0 ? <p className="muted" style={{ margin: 0, padding: 14 }}>هیچ فروشنده‌ی این کالا {payLabel} نداره.</p> : null}
                  {sellers.length > 6 && !showAll ? (
                    <button className="btn btn-ghost" style={{ borderRadius: 0 }} onClick={() => setShowAll(true)}>
                      {faDigits(sellers.length - 6)} فروشنده‌ی دیگه
                    </button>
                  ) : null}
                </div>
              ) : (
                <StoresView productId={p.id} productTitle={p.title} productImage={p.image} pay={pay} />
              )}

              {p.specs_all.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <button className="btn btn-ghost" style={{ justifyContent: "space-between", paddingInline: 4 }} onClick={() => setShowSpecs((v) => !v)} aria-expanded={showSpecs}>
                    <span style={{ color: "var(--ink)", fontWeight: 700 }}>مشخصات</span>
                    <ChevronDown className="icon-sm" />
                  </button>
                  {showSpecs ? (
                    <dl className="specs-table">{p.specs_all.map((s, i) => <Fragment key={i}><dt>{s.key}</dt><dd>{s.value}</dd></Fragment>)}</dl>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {p ? (
          <footer className="modal-foot">
            <button className="btn btn-primary btn-lg" onClick={() => onAsk(p)}>درباره این محصول بپرس</button>
            <a className="btn btn-secondary" href={`https://torob.com/search/?query=${encodeURIComponent(p.title)}`} target="_blank" rel="noreferrer">
              <ExternalIcon className="icon-sm" />
              مشاهده در ترب
            </a>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

/** One seller: where and how fresh, then «خرید از [فروشگاه]» (red for the cheapest, white for the rest). In-person
    shops open their product + shop page; online-only shops open their website. */
function OfferRow({ o, productId, onMap, cheapest, nearestM, onBuy }: {
  o: Offer; productId: string; onMap: () => void; cheapest: boolean; nearestM: number | null; onBuy: () => void;
}) {
  const [showPhone, setShowPhone] = useState(false);
  const s = o.shop;
  const site = s.website ? (s.website.startsWith("http") ? s.website : `https://${s.website}`) : null;
  const inPerson = s.lat != null && s.lng != null;
  const meta = [s.area ? `${s.area}، تهران` : inPerson ? "تهران" : "فقط آنلاین", s.hours.today, o.updated_days != null ? `قیمت ${daysAgo(o.updated_days)}` : null]
    .filter(Boolean).join(" · ");
  const tags = { cheapest, nearest: nearestM != null, distanceM: nearestM };
  return (
    <div className="offer">
      <span className="row-sub">{meta}</span>
      {inPerson ? (
        <BuyButton shop={s.name} price={o.price} tags={tags} variant={cheapest ? "primary" : "secondary"}
          href={`/p/${encodeURIComponent(productId)}?shop=${encodeURIComponent(s.id)}`} onClick={onBuy} />
      ) : site ? (
        <BuyButton shop={s.name} price={o.price} tags={tags} variant={cheapest ? "primary" : "secondary"} href={site} external note="سایت فروشگاه" onClick={onBuy} />
      ) : (
        <BuyButton shop={s.name} price={o.price} tags={tags} variant={cheapest ? "primary" : "secondary"} onClick={() => setShowPhone(true)} note="تماس بگیر" />
      )}
      <div className="offer-badges">
        {o.outlier ? <span className="badge badge-warn"><WarnIcon className="icon-sm" />قیمت غیرعادی</span> : null}
        {o.warranty ? <span className="badge badge-plain"><ShieldIcon className="icon-sm" />{o.warranty}</span> : null}
        {s.fast_delivery ? <span className="badge badge-ok"><TruckIcon className="icon-sm" />ارسال سریع</span> : null}
        {s.payments.map((pm) => <PaymentLogo key={pm} name={pm} small />)}
      </div>
      {o.description ? <p className="row-sub" style={{ margin: 0, fontSize: 12 }}>«{o.description}»</p> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {s.phones[0] ? (
          showPhone ? (
            <a className="btn btn-secondary btn-sm num" href={`tel:${s.phones[0].replace(/[^\d+]/g, "")}`}><PhoneIcon className="icon-sm" />{faDigits(s.phones[0])}</a>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowPhone(true)}><PhoneIcon className="icon-sm" />شماره تماس</button>
          )
        ) : null}
        {inPerson ? <button className="btn btn-ghost btn-sm" onClick={onMap}>روی نقشه</button> : null}
      </div>
    </div>
  );
}
