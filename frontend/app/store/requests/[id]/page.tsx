"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import StorePanel from "@/components/panel/StorePanel";
import { faDigits, money, toLatinDigits } from "@/lib/format";
import { toman } from "@/lib/numwords";
import { store, STATUS_FA, VREASON_FA, waited, when, type VDetail } from "@/lib/panel";

const EVENT_FA: Record<string, string> = {
  created: "ساخته شد · در انتظار", claimed: "بررسی شروع شد", resolved: "پاسخ ثبت شد", expired: "منقضی شد", followup: "پیگیری ناواتل",
};

export default function RequestPage() {
  const { id } = useParams<{ id: string }>();
  return <StorePanel>{() => <Request id={Number(id)} />}</StorePanel>;
}

function Request({ id }: { id: number }) {
  const [r, setR] = useState<VDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stock, setStock] = useState<"available" | "unavailable">("available");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = () => store.request(id).then((x) => { setR(x); if (x.listed_price && !price) setPrice(faDigits(money(x.listed_price))); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opening the request tells the others someone is on it.
  useEffect(() => { if (r && r.status === "pending") store.claim(r.shop_id, r.id).then(load).catch(() => {}); }, [r?.id, r?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p role="alert">{error}</p>;
  if (!r) return <div aria-busy="true" style={{ minHeight: 300 }} />;
  const isOpen = r.status === "pending" || r.status === "in_progress";
  const parsed = Number(toLatinDigits(price).replace(/[^\d]/g, "")) || null;
  const back = `/store?shop=${encodeURIComponent(r.shop_id)}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!r) return;
    setBusy(true); setError(null);
    try {
      const res = await store.resolve(r.shop_id, r.id, { stock, price: stock === "available" ? parsed : null, note: note.trim() || null });
      setDone(res.customers_notified ? `ثبت شد و برای ${faDigits(res.customers_notified)} مشتری پیامک شد.` : "ثبت شد.");
      load();
    } catch (x) { setError(x instanceof Error ? x.message : "ثبت نشد"); } finally { setBusy(false); }
  }

  return (
    <>
      <nav aria-label="مسیر صفحه" style={{ fontSize: 14 }}><Link href={back}>درخواست‌های تأیید</Link> <span aria-hidden="true" style={{ color: "var(--ink-muted)" }}>‹</span> <span>{r.product_title}</span></nav>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: "36px" }}>{r.product_title}</h1>
        <span className={`vstatus is-${r.status}`}>{STATUS_FA[r.status]}</span>
        {isOpen ? <span style={{ fontSize: 14, fontWeight: 700, color: "var(--brand-ink)" }}>{waited(r.created_at)} منتظر</span> : null}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: "999 1 460px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="panel-card">
            <h2>درخواست</h2>
            <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, fontSize: 14 }}>
              <div><dt className="row-sub">قیمت ثبت‌شده</dt><dd className="num" style={{ margin: 0, fontWeight: 700 }}>{r.listed_price ? `${faDigits(money(r.listed_price))} تومان` : "ثبت نشده"}</dd></div>
              <div><dt className="row-sub">چرا تأیید لازمه</dt><dd style={{ margin: 0, fontWeight: 500 }}>{r.reasons.map((x) => VREASON_FA[x] ?? x).join("، ")}</dd></div>
              <div><dt className="row-sub">مشتری منتظر</dt><dd style={{ margin: 0 }}>{faDigits(r.customers)} نفر · خودکار، از گفت‌وگوی تربچه</dd></div>
            </dl>
            {r.question ? <div style={{ padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--surface-sunken)", fontSize: 14 }}><span className="row-sub">سؤال مشتری:</span> «{r.question}»</div> : null}
          </section>

          {isOpen ? (
            <form className="panel-card" onSubmit={submit}>
              <h2>پاسخ فروشگاه</h2>
              <fieldset style={{ margin: 0, padding: 0, border: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <legend style={{ padding: 0, marginBottom: 8, fontSize: 14, fontWeight: 500 }}>این کالا رو الان دارید؟</legend>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                  <label className="choice"><input type="radio" name="stock" checked={stock === "available"} onChange={() => setStock("available")} />موجوده</label>
                  <label className="choice is-no"><input type="radio" name="stock" checked={stock === "unavailable"} onChange={() => setStock("unavailable")} />موجود نیست</label>
                </div>
              </fieldset>
              {stock === "available" ? (
                <label className="field">قیمت امروز (تومان)
                  <input className="input num" inputMode="numeric" required value={price} onChange={(e) => setPrice(e.target.value)} style={{ minHeight: 48, fontSize: 18, fontWeight: 700 }} />
                  <span className="row-sub" style={{ fontWeight: 400 }}>{parsed ? toman(parsed) : "قیمت رو به تومان بنویس"}</span>
                </label>
              ) : null}
              <label className="field">یادداشت برای مشتری (اختیاری)
                <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً فقط رنگ مشکی" />
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <button className="btn btn-primary" type="submit" disabled={busy || (stock === "available" && (!parsed || parsed < 1000))} style={{ minWidth: 180 }}>{busy ? "در حال ثبت…" : "ثبت و حل شد"}</button>
                <Link className="btn btn-secondary" href={back}>بعداً</Link>
              </div>
              <span className="row-sub">بعد از ثبت، قیمت و موجودی همین کالا در تربچه به‌روز می‌شه و نتیجه به مشتری‌ها پیامک می‌شه.</span>
            </form>
          ) : (
            <section className="panel-card" role="status">
              <h2>پاسخ</h2>
              <p style={{ margin: 0, fontSize: 15 }}>
                {r.status === "verified" ? <>موجود · <b className="num">{r.verified_price ? `${faDigits(money(r.verified_price))} تومان` : ""}</b></> : r.status === "unavailable" ? "موجود نیست" : STATUS_FA[r.status]}
                {r.note ? ` · ${r.note}` : ""}
              </p>
              {done ? <span style={{ color: "var(--success)", fontSize: 14 }}>{done}</span> : null}
              {r.resolved_at ? <span className="row-sub">{when(r.resolved_at)}{r.resolved_by ? ` · ${r.resolved_by === "phone_check" ? "با استعلام تلفنی" : faDigits(r.resolved_by)}` : ""}</span> : null}
            </section>
          )}
          {error ? <p role="alert" style={{ margin: 0, color: "var(--danger)" }}>{error}</p> : null}
        </div>

        <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="panel-card">
            <h2>تاریخچه</h2>
            <ol className="feed">
              {r.events.map((e, i) => (
                <li key={i} style={{ flexDirection: "column", alignItems: "flex-start", gap: 0 }}>
                  <b style={{ fontWeight: 500 }}>{EVENT_FA[e.kind] ?? e.kind}{e.kind === "followup" && e.detail?.sent === false ? " (ارسال نشد)" : ""}</b>
                  <span className="row-sub">{when(e.created_at)}{e.actor && e.actor !== "system" ? ` · ${e.actor === "phone_check" ? "استعلام تلفنی" : faDigits(e.actor)}` : " · خودکار"}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="panel-card">
            <h2>پیگیری‌های ناواتل</h2>
            <ul className="feed" style={{ fontSize: 13 }}>
              {r.notifications.map((n, i) => (
                <li key={i} className={n.ok ? "is-ok" : ""} style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                  <b style={{ fontWeight: 500 }}>{n.purpose === "store_followup" ? "پیامک پیگیری به فروشگاه" : "پیامک نتیجه به مشتری"} · <span className="num" dir="ltr">{faDigits(n.to_phone)}</span> · {n.ok ? "فرستاده شد" : "ارسال نشد"}</b>
                  {!n.ok && n.reason ? <span className="row-sub">{n.reason}</span> : null}
                  <span className="row-sub">تلاش {faDigits(n.attempt)} · {when(n.created_at)}</span>
                </li>
              ))}
              {!r.notifications.length ? (
                <li className="row-sub" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                  {isOpen ? "اگه تا ۱ ساعت (وقتی فروشگاه بازه) جواب ندید، یک پیامک یادآوری می‌آد." : "پیامکی فرستاده نشده."}
                </li>
              ) : null}
              <li className="row-sub" style={{ background: "none", padding: 0 }}>برای هر درخواست فقط یک پیگیری فرستاده می‌شه؛ با حل شدن یا منقضی شدن متوقف می‌شه.</li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
