"use client";

import { useState } from "react";
import { daysAgo, faDigits, money, toLatinDigits } from "@/lib/format";
import type { OfferRow } from "@/lib/panel";

type Save = (offerId: string, body: { price?: number | null; stock?: string | null }) => Promise<unknown>;

/** Prices and stock with inline editing; each row saves on its own. */
export default function OffersTable({ offers, onSave, showShop = true }: { offers: OfferRow[]; onSave: Save; showShop?: boolean }) {
  if (!offers.length) return <p className="row-sub" style={{ margin: 0, fontSize: 14, padding: 16 }}>کالایی پیدا نشد.</p>;
  return (
    <div className="table-wrap">
      <table className="ptable" style={{ minWidth: showShop ? 920 : 760 }}>
        <thead>
          <tr>
            <th scope="col">کالا</th>
            {showShop ? <th scope="col">فروشگاه</th> : null}
            <th scope="col">قیمت (تومان)</th>
            <th scope="col">موجودی</th>
            <th scope="col">قیمت تأییدشده</th>
            <th scope="col">آخرین تغییر قیمت</th>
            <th scope="col"><span className="sr-only">ذخیره</span></th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => <Row key={o.offer_id} o={o} onSave={onSave} showShop={showShop} />)}
        </tbody>
      </table>
    </div>
  );
}

function Row({ o, onSave, showShop }: { o: OfferRow; onSave: Save; showShop: boolean }) {
  const [price, setPrice] = useState(o.price != null ? faDigits(money(o.price)) : "");
  const [stock, setStock] = useState<string>(o.stock ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  const parsed = Number(toLatinDigits(price).replace(/[^\d]/g, "")) || null;
  const changed = parsed !== o.price || (stock || null) !== o.stock;

  async function save() {
    setState("saving");
    try {
      await onSave(o.offer_id, { price: parsed !== o.price ? parsed : undefined, stock: (stock || null) !== o.stock ? stock || null : undefined });
      setState("saved");
    } catch (e) {
      setState(e instanceof Error ? e.message : "ذخیره نشد");
    }
  }

  return (
    <tr>
      <td style={{ fontWeight: 500, maxWidth: 320 }}>{o.title}</td>
      {showShop ? <td>{o.shop}</td> : null}
      <td>
        <input className="input is-sm num" inputMode="numeric" aria-label={`قیمت ${o.title}`} value={price}
          onChange={(e) => { setPrice(e.target.value); setState("idle"); }} style={{ width: 150, fontWeight: 700 }} placeholder="ثبت نشده" />
      </td>
      <td>
        <select className="select is-sm" aria-label={`موجودی ${o.title}`} value={stock} onChange={(e) => { setStock(e.target.value); setState("idle"); }}>
          <option value="">نامشخص</option>
          <option value="available">موجود</option>
          <option value="unavailable">ناموجود</option>
        </select>
      </td>
      <td>
        {o.verified_price ? (
          <span><span className="num" style={{ fontWeight: 700 }}>{faDigits(money(o.verified_price))}</span>{" "}
            <span className="badge badge-plain">{o.price_status === "corrected" ? "اصلاح شده" : "تأیید شده"}</span></span>
        ) : <span className="row-sub" style={{ fontSize: 13 }}>نپرسیده</span>}
      </td>
      <td>{o.price_days != null ? daysAgo(o.price_days) : "—"}</td>
      <td>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <button className="btn btn-secondary btn-sm" type="button" disabled={!changed || state === "saving"} onClick={save}>
            {state === "saving" ? "…" : "ذخیره"}
          </button>
          {state === "saved" ? <span className="row-sub" role="status">ذخیره شد</span>
            : state !== "idle" && state !== "saving" ? <span className="row-sub" role="alert" style={{ color: "var(--danger)" }}>{state}</span> : null}
        </span>
      </td>
    </tr>
  );
}
