"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AdminPanel from "@/components/panel/AdminPanel";
import { PlusIcon } from "@/components/icons";
import { daysAgo, faDigits } from "@/lib/format";
import { admin, type ShopRow, type Totals } from "@/lib/panel";

export default function AdminStoresPage() {
  return <AdminPanel><Stores /></AdminPanel>;
}

function Stores() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("");
  const [test, setTest] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; size: number; stores: ShopRow[] } | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { admin.totals().then(setTotals).catch(() => {}); }, []);
  useEffect(() => {
    setData(null);
    admin.stores({ q: query, area, test, page }).then(setData).catch((e) => setError(e.message));
  }, [query, area, test, page]);

  const from = data ? (page - 1) * data.size + 1 : 0;
  const to = data ? from + data.stores.length - 1 : 0;

  return (
    <>
      <div className="panel-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1>فروشگاه‌ها</h1>
          {totals ? <span className="row-sub" style={{ fontSize: 14 }}><span className="num">{faDigits(totals.shops.toLocaleString("en").replace(/,/g, "٬"))}</span> فروشگاه در <span className="num">{faDigits(totals.areas)}</span> محله</span> : null}
        </div>
        <Link className="btn btn-primary" href="/admin/stores/new"><PlusIcon className="icon-sm" />افزودن فروشگاه</Link>
      </div>

      <form role="search" className="toolbar" onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(q.trim()); }}>
        <label htmlFor="store-q" className="sr-only">جست‌وجوی فروشگاه</label>
        <input id="store-q" className="input" type="search" placeholder="نام فروشگاه، آدرس یا تلفن" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 260px", minWidth: 0 }} />
        <label htmlFor="store-area" className="sr-only">محله</label>
        <select id="store-area" className="select" value={area} onChange={(e) => { setPage(1); setArea(e.target.value); }}>
          <option value="">همه‌ی محله‌ها</option>
          {totals?.area_list.map((a) => <option key={a.name} value={a.name}>{a.name} ({faDigits(a.shops)})</option>)}
        </select>
        <button className="chip" type="button" aria-pressed={test} onClick={() => { setPage(1); setTest(!test); }}>فقط آزمایشی</button>
        <button className="btn btn-secondary" type="submit">جست‌وجو</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}

      <section aria-label="فهرست فروشگاه‌ها" className="table-wrap">
        <table className="ptable" style={{ minWidth: 900 }}>
          <thead><tr><th>فروشگاه</th><th>محله</th><th>تلفن</th><th>کالاها</th><th>آخرین قیمت</th><th>پیشنهاد / نشد</th><th>استعلام</th><th>درخواست باز</th><th><span className="sr-only">کارها</span></th></tr></thead>
          <tbody>
            {!data ? <tr><td colSpan={9} aria-busy="true" className="row-sub">در حال بارگذاری…</td></tr> : data.stores.map((s) => (
              <tr key={s.id}>
                <td><span style={{ display: "flex", alignItems: "center", gap: 8 }}><b style={{ fontWeight: 500 }}>{s.name}</b>{s.test ? <span className="badge badge-plain">آزمایشی</span> : null}
                  {s.open_now === true ? <span className="badge badge-ok">باز</span> : s.open_now === false ? <span className="badge badge-plain">بسته</span> : null}</span></td>
                <td>{s.area ?? "—"}</td>
                <td className="num" dir="ltr" style={{ textAlign: "right" }}>{s.phones?.[0] ? faDigits(s.phones[0]) : "—"}</td>
                <td className="num">{faDigits(s.offers)}</td>
                <td>{s.last_price_days != null ? daysAgo(s.last_price_days) : "—"}</td>
                <td className="num">{faDigits(s.suggested)} / {faDigits(s.not_suggested)}</td>
                <td className="num">{faDigits(s.phone_check)}</td>
                <td>{s.open_requests ? <span className="badge badge-brand num">{faDigits(s.open_requests)}</span> : <span className="num">۰</span>}</td>
                <td><Link className="btn btn-secondary btn-sm" href={`/admin/stores/${s.id}`}>ویرایش</Link></td>
              </tr>
            ))}
            {data && !data.stores.length ? <tr><td colSpan={9} className="row-sub">فروشگاهی پیدا نشد.</td></tr> : null}
          </tbody>
        </table>
        {data ? (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
            <span className="row-sub" style={{ fontSize: 14 }}>{data.stores.length ? <><span className="num">{faDigits(from)}</span> تا <span className="num">{faDigits(to)}</span> از <span className="num">{faDigits(data.total)}</span></> : null}</span>
            <span style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>قبلی</button>
              <button className="btn btn-secondary btn-sm" disabled={to >= data.total} onClick={() => setPage(page + 1)}>بعدی</button>
            </span>
          </div>
        ) : null}
      </section>
    </>
  );
}
