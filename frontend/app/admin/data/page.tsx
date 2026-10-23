"use client";

import { useEffect, useState } from "react";
import AdminPanel from "@/components/panel/AdminPanel";
import OffersTable from "@/components/panel/OffersTable";
import { Kpi } from "@/components/panel/PanelShell";
import { UploadIcon } from "@/components/icons";
import { faDigits, money } from "@/lib/format";
import { admin, when, type Change, type ImportResult, type OfferRow, type Totals } from "@/lib/panel";

const n = (v: number) => faDigits(v.toLocaleString("en").replace(/,/g, "٬"));

export default function AdminDataPage() {
  return <AdminPanel><Data /></AdminPanel>;
}

function Data() {
  const [tab, setTab] = useState<"prices" | "upload" | "history">("prices");
  const [totals, setTotals] = useState<Totals | null>(null);
  useEffect(() => { admin.totals().then(setTotals).catch(() => {}); }, []);
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: "36px" }}>داده‌ها</h1>
        <span className="row-sub" style={{ fontSize: 14 }}>کالاها، قیمت‌ها و موجودی فروشگاه‌ها؛ هر تغییر همون لحظه توی گفت‌وگوی تربچه دیده می‌شه</span>
      </div>
      {totals ? (
        <div className="kpis">
          <Kpi label="فروشگاه" value={n(totals.shops)} /><Kpi label="کالا" value={n(totals.products)} />
          <Kpi label="قیمت فروشگاه" value={n(totals.offers)} /><Kpi label="محله" value={n(totals.areas)} /><Kpi label="دسته" value={n(totals.categories)} />
        </div>
      ) : null}
      <div role="tablist" aria-label="بخش‌های داده" className="tabs">
        {([["prices", "قیمت‌ها و موجودی"], ["upload", "بارگذاری فایل"], ["history", "تاریخچه‌ی تغییرات"]] as const).map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "prices" ? <Prices /> : tab === "upload" ? <Upload /> : <History />}
    </>
  );
}

function Prices() {
  const [q, setQ] = useState("");
  const [shop, setShop] = useState("");
  const [stale, setStale] = useState(false);
  const [offers, setOffers] = useState<OfferRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  function load(query = q, s = shop, st = stale) {
    if (!query.trim() && !s.trim()) { setOffers([]); return; }
    setOffers(null);
    admin.offers({ q: query.trim(), shop: s.trim(), stale: st }).then((r) => setOffers(r.offers)).catch((e) => setErr(e.message));
  }
  useEffect(() => { load("", "shop_test_astin", false); setShop("shop_test_astin"); /* the test shop first */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section aria-label="قیمت‌ها و موجودی" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <form role="search" className="toolbar" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <label htmlFor="data-q" className="sr-only">جست‌وجوی کالا</label>
        <input id="data-q" className="input" type="search" placeholder="نام کالا" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 240px", minWidth: 0 }} />
        <label htmlFor="data-shop" className="sr-only">شناسه‌ی فروشگاه</label>
        <input id="data-shop" className="input" dir="ltr" placeholder="shop_… (اختیاری)" value={shop} onChange={(e) => setShop(e.target.value)} style={{ flex: "1 1 200px", minWidth: 0 }} />
        <button className="chip" type="button" aria-pressed={stale} onClick={() => { setStale(!stale); load(q, shop, !stale); }}>فقط قیمت‌های قدیمی‌تر از ۹۰ روز</button>
        <button className="btn btn-secondary" type="submit">جست‌وجو</button>
      </form>
      {err ? <p role="alert">{err}</p> : null}
      {offers === null ? <div aria-busy="true" style={{ minHeight: 120 }} /> : (
        <OffersTable offers={offers} onSave={(id, b) => admin.patchOffer(id, b)} />
      )}
    </section>
  );
}

function Upload() {
  const [text, setText] = useState<string | null>(null);
  const [file, setFile] = useState("");
  const [res, setRes] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(apply: boolean) {
    if (!text) return;
    setBusy(true); setErr(null);
    try { setRes(await admin.importPrices(text, apply)); } catch (e) { setErr(e instanceof Error ? e.message : "انجام نشد"); } finally { setBusy(false); }
  }
  return (
    <section aria-label="بارگذاری فایل" className="panel-grid">
      <div className="panel-card">
        <h2>بارگذاری فایل CSV قیمت‌ها</h2>
        <label className="dropzone">
          <UploadIcon />
          <span style={{ fontWeight: 500 }}>{file || "فایل رو انتخاب کن"}</span>
          <span className="row-sub">CSV با کدگذاری UTF-8</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            setFile(f.name); setRes(null); setText(await f.text());
          }} />
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="btn btn-secondary" type="button" disabled={!text || busy} onClick={() => run(false)}>پیش‌نمایش</button>
          <button className="btn btn-primary" type="button" disabled={!res || !res.matched || busy || res.applied > 0} onClick={() => run(true)}>
            {res && res.matched ? `اعمال ${faDigits(res.matched)} ردیف` : "اعمال"}
          </button>
        </div>
        {err ? <p role="alert" style={{ margin: 0 }}>{err}</p> : null}
        {res ? (
          <div role="status" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 14 }}>
            {res.applied ? <b style={{ color: "var(--success)" }}>{faDigits(res.applied)} ردیف اعمال شد.</b>
              : <span>{faDigits(res.matched)} ردیف پیدا شد · {faDigits(res.unmatched.length)} پیدا نشد · {faDigits(res.invalid.length)} نامعتبر</span>}
            {res.preview.length && !res.applied ? (
              <ul className="feed">
                {res.preview.slice(0, 8).map((p) => (
                  <li key={p.line}><b style={{ fontWeight: 500 }}>{p.title}</b><span>{p.shop}</span>
                    {p.price ? <span className="num">{faDigits(money(p.old_price))} ← {faDigits(money(p.price))}</span> : null}
                    {p.stock ? <span>{p.stock === "available" ? "موجود" : "ناموجود"}</span> : null}</li>
                ))}
              </ul>
            ) : null}
            {[...res.unmatched, ...res.invalid].slice(0, 6).map((u) => <span key={`${u.line}${u.reason}`} className="row-sub">خط {faDigits(u.line)}: {u.reason}</span>)}
          </div>
        ) : null}
      </div>
      <div className="panel-card">
        <h2>ستون‌های فایل</h2>
        <ul className="feed" style={{ fontSize: 14 }}>
          <li><code dir="ltr">shop_id</code><span className="when">شناسه‌ی فروشگاه</span></li>
          <li><code dir="ltr">product_id</code><span className="when">شناسه‌ی کالا (یا <code dir="ltr">offer_id</code>)</span></li>
          <li><code dir="ltr">price_toman</code><span className="when">قیمت به تومان</span></li>
          <li><code dir="ltr">stock</code><span className="when">موجود، ناموجود یا خالی</span></li>
        </ul>
        <span className="row-sub">ردیف‌هایی که فروشگاه یا کالاشون پیدا نشه، در پیش‌نمایش جدا نشون داده می‌شن و اعمال نمی‌شن.</span>
      </div>
    </section>
  );
}

function History() {
  const [rows, setRows] = useState<Change[] | null>(null);
  useEffect(() => { admin.changes().then((r) => setRows(r.changes)).catch(() => setRows([])); }, []);
  if (!rows) return <div aria-busy="true" style={{ minHeight: 120 }} />;
  return (
    <section aria-label="تاریخچه‌ی تغییرات" className="panel-card">
      <ul className="feed">
        {rows.map((c, i) => (
          <li key={i}><b style={{ fontWeight: 500 }}>{faDigits(c.summary)}</b>
            <span className="badge badge-plain">{({ offer_update: "قیمت و موجودی", shop_create: "فروشگاه جدید", shop_update: "ویرایش فروشگاه", import: "بارگذاری فایل", staff_add: "دسترسی", staff_remove: "دسترسی" } as Record<string, string>)[c.kind] ?? c.kind}</span>
            <span className="row-sub num" dir="ltr">{faDigits(c.actor)}</span>
            <span className="row-sub when">{when(c.created_at)}</span></li>
        ))}
        {!rows.length ? <li className="row-sub">هنوز تغییری ثبت نشده.</li> : null}
      </ul>
    </section>
  );
}
