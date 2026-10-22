"use client";

import { daysAgo, distance, faDigits, money, priceGap, toLatinDigits } from "@/lib/format";
import type { Offer, StorePick as Pick } from "@/lib/types";
import { useIsTouchDevice } from "@/lib/useMedia";
import { CheckIcon, NavigateIcon, PhoneIcon, PinIcon } from "../icons";
import SnappButton from "./SnappButton";

/** "Torob picked this shop for you": the in-person shop that is near and priced close to the cheapest,
    with why, and the next step. Phones get directions (geo: intent) and Snapp; desktop gets call and address. */
export default function StorePick({ offer, pick, onShow }: { offer: Offer; pick: Pick; onShow: () => void }) {
  const touch = useIsTouchDevice();
  const s = offer.shop;
  const geo = s.lat != null && s.lng != null ? `geo:${s.lat},${s.lng}?q=${s.lat},${s.lng}(${encodeURIComponent(s.name)})` : null;
  const phone = s.phones[0];

  const reasons: string[] = [];
  reasons.push(pick.distance_m != null ? `${distance(pick.distance_m)} با تو فاصله داره` : `توی محله‌ی خودت، ${s.area}`);
  reasons.push(
    pick.cheapest_overall
      ? "ارزون‌ترین قیمت بین همه‌ی فروشنده‌های ترب"
      : `فقط ${priceGap(pick.price_gap)} (${faDigits(String(pick.price_gap_pct).replace(".", "٫"))}٪) بالاتر از ارزون‌ترین`,
  );
  if (pick.open_now) reasons.push(s.hours.today ? `الان بازه · ${s.hours.today}` : "الان بازه");
  else if (pick.open_now === false) reasons.push("الان بسته‌ست؛ قبل از رفتن تماس بگیر");
  if (pick.warranty) reasons.push(pick.warranty);
  if (pick.updated_days != null) reasons.push(`قیمت ${daysAgo(pick.updated_days)} به‌روز شده`);

  return (
    <section className="store-pick" aria-label={`پیشنهاد ترب: ${s.name}`}>
      <div className="store-pick-head">
        <img className="pixel" src="/brand/radish.png" width={32} height={32} alt="" />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span className="store-pick-label">برات انتخاب کردم</span>
          <button className="store-pick-name" onClick={onShow}>{s.name}</button>
        </div>
        <b className="num" style={{ flex: "none", fontSize: 16 }}>
          {money(offer.price)} <small className="muted" style={{ fontSize: 11, fontWeight: 400 }}>تومان</small>
        </b>
      </div>

      <ul className="pick-reasons">
        {reasons.map((r) => (
          <li key={r}><CheckIcon className="icon-sm" /><span>{r}</span></li>
        ))}
      </ul>

      {touch && geo ? (
        <div className="store-pick-acts">
          <a className="btn btn-primary" href={geo} style={{ minHeight: 52, height: "auto" }}>
            <NavigateIcon className="icon-sm" />
            مسیریابی
          </a>
          <SnappButton shopName={s.name} />
        </div>
      ) : (
        <div className="store-pick-desk">
          {s.address ? <span className="row-sub"><PinIcon className="icon-sm" />{s.address}</span> : null}
          {phone ? (
            <a className="btn btn-primary btn-sm" href={`tel:${toLatinDigits(phone).replace(/[^\d+]/g, "")}`}>
              <PhoneIcon className="icon-sm" />
              <span className="num">{faDigits(phone)}</span>
            </a>
          ) : null}
        </div>
      )}
    </section>
  );
}
