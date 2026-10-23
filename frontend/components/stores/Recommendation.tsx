"use client";

import { distance, money } from "@/lib/format";
import type { Offer, Recommendation as Rec, RecOption, RecRole } from "@/lib/types";
import { ChevronLeft } from "../icons";

/** Where "near" is, in words: the neighborhood when we know it. */
function near(rec: Rec) {
  if (!rec.located) return "";
  if (!rec.gps && rec.neighborhood) return `در ${rec.neighborhood}`;
  return rec.neighborhood ? `نزدیک ${rec.neighborhood}` : "نزدیک تو";
}

/** The headline for the shop shown in the card, from what it is best at. */
export function headline(rec: Rec, roles: RecRole[], chosen: boolean) {
  const n = roles.includes("nearest");
  const c = roles.includes("cheapest_nearby");
  const city = roles.includes("cheapest_city");
  const where = near(rec);
  if (n && c && city) return `نزدیک‌ترین و ارزون‌ترین فروشگاه، در کل ${rec.city}`;
  if (n && c) return `نزدیک‌ترین و ارزون‌ترین ${where}`;
  if (c && city) return `ارزون‌ترین فروشگاه ${where} و کل ${rec.city}`;
  if (n) return "نزدیک‌ترین فروشگاه به تو";
  if (c) return `ارزون‌ترین فروشگاه ${where}`;
  if (city) return `ارزون‌ترین فروشگاه حضوری در ${rec.city}`;
  return chosen ? "فروشگاهی که انتخاب کردی" : "پیشنهاد ترب";
}

/** Short label for an alternative row. */
function altLabel(roles: RecRole[]) {
  if (roles.includes("nearest") && roles.includes("cheapest_nearby")) return "نزدیک‌ترین و ارزون‌ترین";
  if (roles.includes("nearest")) return "نزدیک‌ترین";
  if (roles.includes("cheapest_nearby")) return "ارزون‌ترین نزدیک تو";
  if (roles.includes("cheapest_city")) return "ارزون‌ترین در تهران";
  return "پیشنهاد ترب";
}

/** What the alternative gives compared with the shop in the card: cheaper by, nearer by. */
function compare(alt: Offer, cur: Offer) {
  const bits: string[] = [];
  if (alt.distance_m != null) bits.push(distance(alt.distance_m)!);
  else if (alt.shop.area) bits.push(alt.shop.area);
  if (alt.price != null && cur.price != null && alt.price !== cur.price) {
    const d = Math.abs(alt.price - cur.price);
    bits.push(`${money(d)} تومان ${alt.price < cur.price ? "ارزون‌تر" : "گرون‌تر"}`);
  } else if (alt.price != null && cur.price != null) {
    bits.push("همون قیمت");
  }
  if (alt.shop.hours.open_now === true) bits.push("بازه");
  else if (alt.shop.hours.open_now === false) bits.push("الان بسته‌ست");
  return bits.join(" · ");
}

/** Headline above the store card, plus the other recommended shops as one line each. */
export default function Recommendation({ rec, current, stores, chosenByUser, onSelect }: {
  rec: Rec; current: Offer; stores: Offer[]; chosenByUser: boolean; onSelect: (offerId: string) => void;
}) {
  const byId = new Map(stores.map((s) => [s.offer_id, s]));
  const mine = rec.options.find((o) => o.offer_id === current.offer_id);
  // The only shop that has it is, by definition, the nearest and the cheapest one.
  const roles: RecRole[] = stores.length === 1 && mine ? ["nearest", "cheapest_nearby", "cheapest_city"] : mine?.roles ?? [];
  const alts = rec.options.filter((o) => o.offer_id !== current.offer_id && byId.has(o.offer_id));

  return (
    <div className="rec-head">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <img className="pixel" src="/brand/radish.png" width={28} height={28} alt="" />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span className="rec-label">{chosenByUser && !mine ? "فروشگاهی که انتخاب کردی" : headline(rec, roles, chosenByUser)}</span>
          {mine?.verified ? <span className="row-sub">موجودیش تلفنی تأیید شده</span> : null}
        </div>
      </div>
      {alts.length ? (
        <ul className="rec-alts">
          {alts.map((o: RecOption) => {
            const s = byId.get(o.offer_id)!;
            return (
              <li key={o.offer_id}>
                <button className="rec-alt" onClick={() => onSelect(o.offer_id)}>
                  <span className="rec-alt-label">{o.primary && !o.roles.length ? "پیشنهاد ترب" : altLabel(o.roles)}</span>
                  <span className="rec-alt-body">
                    <b>{s.shop.name}</b>
                    <span className="row-sub">{compare(s, current)}</span>
                  </span>
                  <span className="num rec-alt-price">{s.price != null ? `${money(s.price)} تومان` : ""}</span>
                  <ChevronLeft className="icon-sm muted" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
