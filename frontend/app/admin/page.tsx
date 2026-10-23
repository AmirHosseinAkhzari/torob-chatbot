"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AdminPanel from "@/components/panel/AdminPanel";
import { Bars, Kpi } from "@/components/panel/PanelShell";
import { CheckIcon, WarnIcon } from "@/components/icons";
import { faDigits, money } from "@/lib/format";
import { admin, reasonFa, when, type Overview } from "@/lib/panel";

const PERIODS: { days: number | null; label: string }[] = [
  { days: 1, label: "امروز" }, { days: 7, label: "۷ روز گذشته" }, { days: 30, label: "۳۰ روز گذشته" }, { days: null, label: "همه" },
];
const CHOSE_OTHER = ["cheaper", "nearer", "recommended_stale", "recommended_closed", "open_now", "warranty", "stock_confirmed"];

export default function AdminHome() {
  return <AdminPanel><Dashboard /></AdminPanel>;
}

function Dashboard() {
  const [days, setDays] = useState<number | null>(30);
  const [d, setD] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    admin.overview(days).then(setD).catch((e) => setError(e.message));
  }, [days]);

  return (
    <>
      <div className="panel-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1>داشبورد فروشگاه‌ها</h1>
          <span className="row-sub" style={{ fontSize: 14 }}>پیشنهادها، خریدها و استعلام‌های تلفنی از گفت‌وگوهای تربچه</span>
        </div>
        <div role="group" aria-label="بازه‌ی زمانی" className="chips">
          {PERIODS.map((p) => (
            <button key={p.label} className="chip" type="button" aria-pressed={days === p.days} onClick={() => setDays(p.days)}>{p.label}</button>
          ))}
        </div>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {!d ? <div aria-busy="true" style={{ minHeight: 300 }} /> : (
        <>
          <div className="kpis">
            <Kpi label="پیشنهاد شد" value={faDigits(d.counts.suggested)} sub="بار که تربچه یک فروشگاه رو پیشنهاد داد" />
            <Kpi label="پیشنهاد نشد" value={faDigits(d.counts.not_suggested)} sub="فروشگاه که کالا رو داشت ولی کنار گذاشته شد" />
            <Kpi label="کلیک خرید" value={faDigits(d.counts.buy_click)} sub={d.buy_value ? <>به ارزش <span className="num">{faDigits(money(d.buy_value))}</span> تومان</> : "—"} />
            <Kpi label="خرید از فروشگاه دیگه" value={faDigits(d.counts.chose_other)} sub="غیر از پیشنهاد تربچه" />
            <Kpi label="استعلام تلفنی" value={faDigits(d.counts.phone_check)} sub="تماس‌های استعلام دستگاه" />
            <Kpi label="درخواست تأیید باز" value={faDigits(d.verification.open)} tone={d.verification.open ? "brand" : undefined}
              sub={`${faDigits(d.verification.answered)} پاسخ داده‌شده${d.verification.avg_minutes != null ? ` · میانگین ${faDigits(d.verification.avg_minutes)} دقیقه` : ""}`} />
          </div>

          <div className="panel-grid">
            <section className="panel-card" aria-labelledby="why-not">
              <div><h2 id="why-not">چرا پیشنهاد نشدن</h2><span className="row-sub">هر فروشگاه می‌تونه چند دلیل داشته باشه · از {faDigits(d.counts.not_suggested)} مورد</span></div>
              <Bars items={d.reasons.not_suggested.map((r) => ({ label: reasonFa(r.reason), n: r.n }))} total={d.counts.not_suggested} />
            </section>
            <section className="panel-card" aria-labelledby="why-yes">
              <div><h2 id="why-yes">چرا پیشنهاد شدن</h2><span className="row-sub">از {faDigits(d.counts.suggested)} پیشنهاد</span></div>
              <Bars items={d.reasons.suggested.map((r) => ({ label: reasonFa(r.reason), n: r.n }))} total={d.counts.suggested} tone="success" />
            </section>
          </div>

          <section className="panel-card" aria-labelledby="chose-other">
            <div><h2 id="chose-other">چرا از فروشگاه دیگه خریدن</h2><span className="row-sub">وقتی کاربر غیر از پیشنهاد تربچه رو انتخاب می‌کنه، دلیلش اینجا شمرده می‌شه</span></div>
            {d.reasons.chose_other.length ? (
              <Bars items={d.reasons.chose_other.map((r) => ({ label: reasonFa(r.reason), n: r.n }))} total={d.counts.chose_other} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 20, borderRadius: "var(--radius-md)", background: "var(--surface-sunken)", textAlign: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>هنوز کسی از فروشگاهی غیر از پیشنهاد خرید نکرده</span>
                <div className="chips" style={{ justifyContent: "center" }}>
                  {CHOSE_OTHER.map((r) => <span key={r} className="chip" style={{ cursor: "default" }}>{reasonFa(r)}</span>)}
                </div>
              </div>
            )}
          </section>

          <section className="panel-card" aria-labelledby="top-shops">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <h2 id="top-shops">فروشگاه‌ها به ترتیب فعالیت</h2>
              <Link href="/admin/stores" style={{ fontSize: 14, fontWeight: 500 }}>همه‌ی فروشگاه‌ها</Link>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="ptable" style={{ minWidth: 640 }}>
                <thead><tr><th>فروشگاه</th><th>محله</th><th>پیشنهاد شد</th><th>پیشنهاد نشد</th><th>کلیک خرید</th><th>جای دیگه</th><th>استعلام</th></tr></thead>
                <tbody>
                  {d.shops.map((s) => (
                    <tr key={s.shop_id}>
                      <td><Link href={`/admin/stores/${s.shop_id}`} style={{ fontWeight: 500, color: "var(--ink)" }}>{s.name}</Link>{s.test ? <> <span className="badge badge-plain">آزمایشی</span></> : null}</td>
                      <td>{s.area ?? "—"}</td>
                      <td className="num">{faDigits(s.suggested)}</td><td className="num">{faDigits(s.not_suggested)}</td>
                      <td className="num">{faDigits(s.buy_click)}</td><td className="num">{faDigits(s.chose_other)}</td><td className="num">{faDigits(s.phone_check)}</td>
                    </tr>
                  ))}
                  {!d.shops.length ? <tr><td colSpan={7} className="row-sub">در این بازه فعالیتی ثبت نشده.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel-card" aria-labelledby="calls">
            <h2 id="calls">آخرین استعلام‌های تلفنی</h2>
            {d.calls.length ? (
              <ul className="feed">
                {d.calls.map((c, i) => {
                  const ok = c.status === "available" || c.status === "unavailable";
                  return (
                    <li key={i} className={c.status === "available" ? "is-ok" : ""}>
                      {ok ? <CheckIcon className="icon-sm" /> : <WarnIcon className="icon-sm" />}
                      <b style={{ fontWeight: 700 }}>{c.product} · {c.shop}</b>
                      <span>
                        {c.status === "available" ? "موجود" : c.status === "unavailable" ? "ناموجود" : "ناموفق: تماس برقرار نشد"}
                        {c.status === "available" && c.quoted_price && c.quoted_price !== c.listed_price ? (
                          <> · قیمت اصلاح شد: <span className="num" style={{ textDecoration: "line-through", color: "var(--ink-muted)" }}>{faDigits(money(c.listed_price))}</span> ← <span className="num" style={{ fontWeight: 700 }}>{faDigits(money(c.quoted_price))} تومان</span></>
                        ) : null}
                      </span>
                      {c.test_call ? <span className="badge badge-plain">تماس آزمایشی</span> : null}
                      <span className="row-sub when">{when(c.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="row-sub" style={{ margin: 0, fontSize: 14 }}>هنوز تماسی گرفته نشده.</p>}
          </section>
        </>
      )}
    </>
  );
}
