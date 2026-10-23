"use client";

import { useState } from "react";
import type { Offer } from "@/lib/types";
import BuyButton, { type BuyTags } from "../BuyButton";
import { daysAgo, distance, faDigits, priceGap, toLatinDigits } from "@/lib/format";
import { ClockIcon, GlobeIcon, InstagramIcon, PhoneIcon, PinIcon, ShieldIcon, TruckIcon } from "../icons";
import { PaymentChips } from "../PaymentLogo";
import InquiryButton from "./InquiryButton";
import RoutePanel from "./RoutePanel";

/** selectHref: in the chat, the buy button opens the product + shop page (where the inquiry is). On that page
    pressing it swaps the button for the route panel: the map apps and Snapp.
    tags: why this shop (نزدیک‌ترین / ارزان‌ترین), shown on the buy button. */
type Props = {
  offer: Offer; productId: string; productTitle: string; productImage: string | null; cheapest: number | null;
  selectHref?: string; tags?: BuyTags;
  /** Called when «خرید از …» is pressed (store insights). */
  onBuy?: () => void;
};

/** The shop's logo, or a gray default avatar (like a guest profile picture) when it has none. */
export function ShopAvatar({ name, logo, size = 48 }: { name: string; logo?: string | null; size?: number }) {
  if (logo) return <img className="shop-avatar" src={logo} alt={`لوگوی ${name}`} width={size} height={size} referrerPolicy="no-referrer" />;
  return (
    <span className="shop-avatar" role="img" aria-label={`لوگوی ${name}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
        <circle cx="24" cy="18" r="8.5" />
        <path d="M7 48c1.6-9.5 8.4-15 17-15s15.4 5.5 17 15z" />
      </svg>
    </span>
  );
}

/** Not confirmed yet: say what the shop is being asked, never show it as confirmed. */
function VerifyNote({ offer }: { offer: Offer }) {
  const need = offer.needs_confirmation ?? [];
  if (!need.length) return null;
  const closed = need.includes("store_closed");
  const stale = need.includes("stale_price") || need.includes("no_price");
  const stock = need.includes("stock_unknown");
  const asked = !!offer.verification;
  const what = stale && stock ? "قیمت امروز و موجودی" : stale ? "قیمت امروز" : stock ? "موجودی" : "قیمت و موجودی";
  const text = closed
    ? `${offer.shop.name} الان بسته‌ست؛ ${asked ? "درخواستت ثبت شد و " : ""}وقتی باز شد ${what} رو تأیید می‌کنه.`
    : `${stale ? "قیمت ثبت‌شده قدیمیه. " : ""}${asked ? `از فروشگاه ${what} رو پرسیدیم؛ جوابش رو برات پیامک می‌کنیم.` : `${what} هنوز تأیید نشده؛ قبل از رفتن بپرس.`}`;
  return (
    <div className={`verify-note ${closed ? "is-closed" : ""}`} role="note">
      <ClockIcon className="icon-sm" />
      <span>{text}</span>
    </div>
  );
}

/** Store details sheet: header, product strip, info rows, buy (then the route), actions, payment methods. */
export default function StoreCard({ offer, productId, productTitle, productImage, cheapest, selectHref, tags, onBuy }: Props) {
  const [routing, setRouting] = useState(false);
  const s = offer.shop;
  const open = s.hours.open_now;
  const statusCls = open == null ? "is-unknown" : open ? "is-open" : "is-closed";
  const statusText = open == null ? "ساعت کاری ثبت نشده" : open ? "باز است" : "بسته است";
  const phone = s.phones[0];
  // The price the shop gave by phone (استعلام دستگاه) wins over the listed one.
  const phonePrice = offer.stock?.status === "available" && offer.stock.verified_price ? offer.stock.verified_price : null;
  const buyPrice = phonePrice ?? offer.price;
  const gap = offer.price != null && cheapest != null ? offer.price - cheapest : null;
  const hasMap = s.lat != null && s.lng != null;
  const website = s.website ? (s.website.startsWith("http") ? s.website : `https://${s.website}`) : null;
  // On the shop page, «خرید از …» means going there: the button gives way to the route panel.
  const buy = () => { onBuy?.(); setRouting(true); };

  return (
    <article className="store-card" aria-label={`فروشگاه ${s.name}`}>
      <div className="store-head">
        <ShopAvatar name={s.name} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <b style={{ fontSize: 17, lineHeight: "26px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</b>
          <span className="row-sub">
            {s.area ? `${s.area}، تهران` : "تهران"}
            {offer.distance_m != null ? ` · ${distance(offer.distance_m)}` : ""}
          </span>
        </div>
        <span className={`status-pill ${statusCls}`}><span>{statusText}</span></span>
      </div>

      <div className="product-strip">
        {productImage ? <img className="product-img" src={productImage} alt="" referrerPolicy="no-referrer" /> : null}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 13, lineHeight: "20px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{productTitle}</span>
          <span className="row-sub">
            {offer.price == null
              ? "قیمت ثبت نشده؛ تماس بگیر"
              : gap != null && gap > 0
                ? `${priceGap(gap)} بیشتر از ارزون‌ترین فروشنده`
                : "ارزون‌ترین فروشنده"}
            {offer.updated_days != null ? ` · قیمت ${daysAgo(offer.updated_days)}` : ""}
          </span>
        </div>
      </div>

      <ul className="info-rows">
        {s.address ? <li><PinIcon className="icon-sm" /><span>{s.address}</span></li> : null}
        {s.hours.today ? <li><ClockIcon className="icon-sm" /><span>{s.hours.today}</span></li> : null}
        {offer.warranty ? <li><ShieldIcon className="icon-sm" /><span>{offer.warranty}</span></li> : null}
        {s.fast_delivery ? <li><TruckIcon className="icon-sm" /><span>ارسال سریع داره</span></li> : null}
      </ul>

      {selectHref ? (
        <BuyButton shop={s.name} price={buyPrice} tags={tags} href={selectHref} onClick={onBuy} />
      ) : (
        <>
          {routing && hasMap ? (
            <RoutePanel shop={s.name} price={buyPrice} lat={s.lat!} lng={s.lng!} distanceM={offer.distance_m}
              onBack={() => setRouting(false)} />
          ) : hasMap || !website ? (
            <BuyButton shop={s.name} price={buyPrice} tags={tags} onClick={buy} />
          ) : (
            <BuyButton shop={s.name} price={buyPrice} tags={tags} href={website} external onClick={onBuy} />
          )}
          <VerifyNote offer={offer} />
          <InquiryButton offer={offer} productId={productId} />
        </>
      )}

      <div className="store-acts">
        {phone ? (
          <a className="store-act" href={`tel:${toLatinDigits(phone).replace(/[^\d+]/g, "")}`} aria-label={`تماس با ${s.name}، ${phone}`}>
            <PhoneIcon />
            تماس
            <span className="store-handle num">{faDigits(phone)}</span>
          </a>
        ) : null}
        {s.instagram ? (
          <a className="store-act" href={`https://instagram.com/${s.instagram}`} target="_blank" rel="noreferrer">
            <InstagramIcon />
            اینستاگرام
            <span className="store-handle">@{s.instagram}</span>
          </a>
        ) : null}
        {s.website ? (
          <a className="store-act" href={s.website.startsWith("http") ? s.website : `https://${s.website}`} target="_blank" rel="noreferrer">
            <GlobeIcon />
            وب‌سایت
            <span className="store-handle">{s.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
          </a>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <b style={{ fontSize: 13 }}>روش‌های پرداخت</b>
        <PaymentChips payments={s.payments} inStore />
      </div>
    </article>
  );
}
