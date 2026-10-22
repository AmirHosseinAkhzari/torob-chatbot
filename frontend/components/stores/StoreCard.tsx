"use client";

import Link from "next/link";
import type { Offer } from "@/lib/types";
import { daysAgo, distance, faDigits, money, priceGap, toLatinDigits } from "@/lib/format";
import { useIsTouchDevice } from "@/lib/useMedia";
import { ClockIcon, GlobeIcon, InstagramIcon, NavigateIcon, PhoneIcon, PinIcon, ShieldIcon, TruckIcon } from "../icons";
import { PaymentChips } from "../PaymentLogo";
import InquiryButton from "./InquiryButton";
import SnappButton from "./SnappButton";

/** hideRoute: the pick card above already offers directions and Snapp for this shop.
    selectHref: in the chat, a "choose this shop" link to the product + shop page (where the inquiry is). */
type Props = { offer: Offer; productId: string; productTitle: string; productImage: string | null; cheapest: number | null; hideRoute?: boolean; selectHref?: string };

/** Store details sheet: header, product strip, info rows, actions, payment methods.
    Phones get directions (geo: intent) and Snapp; desktop gets call, Instagram and website only. */
export default function StoreCard({ offer, productId, productTitle, productImage, cheapest, hideRoute, selectHref }: Props) {
  const touch = useIsTouchDevice();
  const s = offer.shop;
  const open = s.hours.open_now;
  const statusCls = open == null ? "is-unknown" : open ? "is-open" : "is-closed";
  const statusText = open == null ? "ساعت کاری ثبت نشده" : open ? "باز است" : "بسته است";
  const phone = s.phones[0];
  const gap = offer.price != null && cheapest != null ? offer.price - cheapest : null;
  const geo = s.lat != null && s.lng != null ? `geo:${s.lat},${s.lng}?q=${s.lat},${s.lng}(${encodeURIComponent(s.name)})` : null;

  return (
    <article className="store-card" aria-label={`فروشگاه ${s.name}`}>
      <div className="store-head">
        <span className="store-initial" aria-hidden="true">{s.name.charAt(0)}</span>
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
        <b className="num" style={{ flex: "none", fontSize: 16 }}>
          {offer.price != null ? money(offer.price) : "تماس"}
          {offer.price != null ? <small className="muted" style={{ fontSize: 11, fontWeight: 400 }}> تومان</small> : null}
        </b>
      </div>

      <ul className="info-rows">
        {s.address ? <li><PinIcon className="icon-sm" /><span>{s.address}</span></li> : null}
        {s.hours.today ? <li><ClockIcon className="icon-sm" /><span>{s.hours.today}</span></li> : null}
        {offer.warranty ? <li><ShieldIcon className="icon-sm" /><span>{offer.warranty}</span></li> : null}
        {s.fast_delivery ? <li><TruckIcon className="icon-sm" /><span>ارسال سریع داره</span></li> : null}
      </ul>

      {selectHref ? (
        <Link className="btn btn-primary btn-block inq-btn" href={selectHref}>
          انتخاب این فروشگاه
          <span className="row-sub" style={{ color: "inherit", opacity: .85 }}>
            {open ? "مسیر، اسنپ و استعلام موجودی از فروشگاه" : "مسیر و اطلاعات فروشگاه"}
          </span>
        </Link>
      ) : (
        <InquiryButton offer={offer} productId={productId} />
      )}

      {touch && geo && !hideRoute ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          <a className="btn btn-primary" href={geo} style={{ minHeight: 52, height: "auto" }}>
            <NavigateIcon className="icon-sm" />
            مسیریابی
          </a>
          <SnappButton shopName={s.name} />
        </div>
      ) : null}

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
