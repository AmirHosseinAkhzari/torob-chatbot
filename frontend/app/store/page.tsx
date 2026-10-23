"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Kpi } from "@/components/panel/PanelShell";
import StorePanel from "@/components/panel/StorePanel";
import { faDigits, money } from "@/lib/format";
import { store, STATUS_FA, VREASON_FA, waited, when, type StoreDashboard, type VRequest } from "@/lib/panel";

const FILTERS = [
  { id: "open", label: "باز" }, { id: "verified", label: "تأیید شده" }, { id: "unavailable", label: "ناموجود" },
  { id: "expired", label: "منقضی" }, { id: "all", label: "همه" },
];

export default function StoreHome() {
  return <StorePanel>{(shopId) => <Dashboard shopId={shopId} />}</StorePanel>;
}

function Dashboard({ shopId }: { shopId: string }) {
  const [d, setD] = useState<StoreDashboard | null>(null);
  const [filter, setFilter] = useState("open");
  const [list, setList] = useState<VRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const load = () => store.dashboard(shopId).then(setD).catch((e) => setError(e.message));
    load();
    const t = setInterval(() => { load(); tick((x) => x + 1); }, 60000); // waiting times and new requests
    return () => clearInterval(t);
  }, [shopId]);
  useEffect(() => {
    if (filter === "open") { setList(d?.open ?? null); return; }
    setList(null);
    store.requests(shopId, filter).then((r) => setList(r.requests)).catch((e) => setError(e.message));
  }, [filter, shopId, d]);

  if (error) return <p role="alert">{error}</p>;
  if (!d) return <div aria-busy="true" style={{ minHeight: 300 }} />;
  const open = d.shop.hours.open_now;
  return (
    <>
      <div className="panel-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1>{d.shop.name}</h1>
          <span className="row-sub" style={{ fontSize: 14 }}>مشتری‌ها منتظر تأیید قیمت و موجودی شما هستن</span>
        </div>
        {open != null ? (
          <span className={`status-pill ${open ? "is-open" : "is-closed"}`}><span>{open ? "فروشگاه الان باز است" : "فروشگاه الان بسته است"}</span></span>
        ) : null}
      </div>

      <div className="kpis">
        <Kpi label="کل درخواست‌ها" value={faDigits(d.stats.total)} sub="۳۰ روز گذشته" />
        <Kpi label="پاسخ داده‌شده" value={faDigits(d.stats.answered)} sub="تأیید یا ناموجود" />
        <Kpi label="در انتظار" value={faDigits(d.stats.open)} tone={d.stats.open ? "brand" : undefined}
          sub={d.stats.oldest_open ? `قدیمی‌ترین: ${waited(d.stats.oldest_open)}` : "هیچ درخواستی منتظر نیست"} />
        <Kpi label="قیمت تأییدشده" value={faDigits(d.stats.verified_prices)} />
        <Kpi label="میانگین زمان پاسخ" value={d.stats.avg_minutes != null ? faDigits(d.stats.avg_minutes) : "—"} sub="دقیقه" />
        <Kpi label="مشتری منتظر" value={faDigits(d.stats.customers)} sub="نتیجه براشون پیامک می‌شه" />
      </div>

      <section className="panel-card" aria-labelledby="req-h">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h2 id="req-h">درخواست‌های تأیید قیمت و موجودی</h2>
          <div role="group" aria-label="فیلتر وضعیت" className="chips">
            {FILTERS.map((f) => (
              <button key={f.id} className="chip" type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}{f.id === "open" ? ` (${faDigits(d.stats.open)})` : ""}
              </button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="ptable" style={{ minWidth: 860 }}>
            <thead><tr><th>کالا</th><th>قیمت ثبت‌شده</th><th>چرا تأیید لازمه</th><th>وضعیت</th><th>{filter === "open" ? "در انتظار" : "زمان"}</th><th>پیگیری ناواتل</th><th><span className="sr-only">کار</span></th></tr></thead>
            <tbody>
              {!list ? <tr><td colSpan={7} aria-busy="true" className="row-sub">در حال بارگذاری…</td></tr> : list.map((r, i) => {
                const isOpen = r.status === "pending" || r.status === "in_progress";
                return (
                  <tr key={r.id} className={isOpen && i === 0 && filter === "open" ? "is-hot" : ""}>
                    <td style={{ fontWeight: 700 }}>{r.product_title}{r.customers ? <span className="row-sub"> · {faDigits(r.customers)} مشتری</span> : null}</td>
                    <td className="num">{r.listed_price ? `${faDigits(money(r.listed_price))} تومان` : "ثبت نشده"}</td>
                    <td>{r.reasons.map((x) => VREASON_FA[x] ?? x).join("، ")}</td>
                    <td><span className={`vstatus is-${r.status}`}>{STATUS_FA[r.status]}</span></td>
                    <td style={isOpen ? { fontWeight: 700, color: "var(--brand-ink)" } : undefined}>
                      {isOpen ? waited(r.created_at) : r.resolved_at ? when(r.resolved_at) : when(r.updated_at)}
                    </td>
                    <td className="row-sub" style={{ fontSize: 13 }}>
                      {r.followup_sent_at ? "پیامک فرستاده شد" : isOpen ? (r.followup_attempts ? "ارسال نشد؛ دوباره تلاش می‌شه" : "بعد از ۱ ساعت") : "—"}
                    </td>
                    <td><Link className={`btn ${isOpen && i === 0 ? "btn-primary" : "btn-secondary"} btn-sm`} href={`/store/requests/${r.id}?shop=${encodeURIComponent(shopId)}`}>{isOpen ? "پاسخ" : "جزئیات"}</Link></td>
                  </tr>
                );
              })}
              {list && !list.length ? <tr><td colSpan={7} className="row-sub">{filter === "open" ? "درخواستی منتظر نیست." : "موردی نیست."}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel-card" aria-labelledby="act-h">
        <h2 id="act-h">فعالیت اخیر</h2>
        <ul className="feed">
          {d.activity.map((a, i) => (
            <li key={i} className={a.kind === "resolved" ? "is-ok" : ""}>
              <b style={{ fontWeight: 500 }}>{a.product_title}: {({ created: "درخواست جدید", claimed: "بررسی شروع شد", resolved: "پاسخ داده شد", expired: "منقضی شد", followup: "پیگیری ناواتل" } as Record<string, string>)[a.kind] ?? a.kind}</b>
              {a.kind === "resolved" && a.detail?.price ? <span className="num">{faDigits(money(Number(a.detail.price)))} تومان</span> : null}
              {a.actor && a.actor !== "system" ? <span className="row-sub num" dir="ltr">{a.actor === "phone_check" ? "استعلام تلفنی" : faDigits(a.actor)}</span> : null}
              <span className="row-sub when">{when(a.created_at)}</span>
            </li>
          ))}
          {!d.activity.length ? <li className="row-sub">هنوز فعالیتی نیست.</li> : null}
        </ul>
      </section>
    </>
  );
}
