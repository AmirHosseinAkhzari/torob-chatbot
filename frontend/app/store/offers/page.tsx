"use client";

import { useEffect, useState } from "react";
import OffersTable from "@/components/panel/OffersTable";
import StorePanel from "@/components/panel/StorePanel";
import { store, type OfferRow } from "@/lib/panel";

export default function StoreOffersPage() {
  return <StorePanel>{(shopId) => <Offers shopId={shopId} />}</StorePanel>;
}

function Offers({ shopId }: { shopId: string }) {
  const [q, setQ] = useState("");
  const [stale, setStale] = useState(false);
  const [offers, setOffers] = useState<OfferRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = (query = q, st = stale) => {
    setOffers(null);
    store.offers(shopId, { q: query.trim(), stale: st }).then((r) => setOffers(r.offers)).catch((e) => setErr(e.message));
  };
  useEffect(() => { load("", false); }, [shopId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="panel-head"><div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <h1>کالاها و قیمت‌ها</h1>
        <span className="row-sub" style={{ fontSize: 14 }}>قیمت امروز و موجودی رو همین‌جا به‌روز کن؛ تربچه همون لحظه از قیمت جدید استفاده می‌کنه</span>
      </div></div>
      <form role="search" className="toolbar" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <label htmlFor="o-q" className="sr-only">جست‌وجوی کالا</label>
        <input id="o-q" className="input" type="search" placeholder="نام کالا" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 240px", minWidth: 0 }} />
        <button className="chip" type="button" aria-pressed={stale} onClick={() => { setStale(!stale); load(q, !stale); }}>فقط قیمت‌های قدیمی‌تر از ۹۰ روز</button>
        <button className="btn btn-secondary" type="submit">جست‌وجو</button>
      </form>
      {err ? <p role="alert">{err}</p> : null}
      {offers === null ? <div aria-busy="true" style={{ minHeight: 120 }} /> : (
        <OffersTable offers={offers} showShop={false} onSave={(id, b) => store.patchOffer(shopId, id, b)} />
      )}
    </>
  );
}
