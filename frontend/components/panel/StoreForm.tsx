"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { faDigits, toLatinDigits } from "@/lib/format";
import { admin, DAYS, PAYMENTS, type HoursDay, type ShopDetail, type ShopForm, type Totals } from "@/lib/panel";
import { PlusIcon } from "../icons";

const PinMap = dynamic(() => import("./PinMap"), { ssr: false, loading: () => <div className="map" style={{ height: 300 }} /> });

const EMPTY: ShopForm = {
  name: "", area: "", address: "", phones: [""], lat: null, lng: null, payments: ["کارتخوان"], categories: [], test: false,
  hours: Object.fromEntries(DAYS.map((d) => [d.key, { status: "unknown", start: "", end: "" }])) as Record<string, HoursDay>,
};

/** افزودن / ویرایش فروشگاه: details, map pin, weekly hours, payments, categories, test flag, panel staff. */
export default function StoreForm({ shopId }: { shopId?: string }) {
  const router = useRouter();
  const [f, setF] = useState<ShopForm | null>(shopId ? null : EMPTY);
  const [detail, setDetail] = useState<ShopDetail | null>(null);
  const [areas, setAreas] = useState<Totals["area_list"]>([]);
  const [cats, setCats] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { admin.totals().then((t) => setAreas(t.area_list)).catch(() => {}); }, []);
  useEffect(() => {
    if (!shopId) return;
    admin.store(shopId).then((d) => {
      setDetail(d);
      setF({ name: d.name, area: d.area ?? "", address: d.address ?? "", phones: d.phones?.length ? d.phones : [""], lat: d.lat, lng: d.lng,
             hours: d.hours, payments: d.payments ?? [], categories: d.categories ?? [], test: d.test });
      setCats((d.categories ?? []).join("، "));
    }).catch((e) => setMsg({ ok: false, text: e.message }));
  }, [shopId]);

  if (!f) return <div aria-busy="true" style={{ minHeight: 300 }} />;
  const set = <K extends keyof ShopForm>(k: K, v: ShopForm[K]) => setF({ ...f, [k]: v });
  const setDay = (key: string, patch: Partial<HoursDay>) => set("hours", { ...f.hours, [key]: { ...f.hours[key], ...patch } });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f) return;
    setSaving(true);
    setMsg(null);
    const body: ShopForm = {
      ...f,
      phones: f.phones.map((p) => toLatinDigits(p).trim()).filter(Boolean),
      categories: cats.split(/[،,]/).map((c) => c.trim()).filter(Boolean),
    };
    try {
      if (shopId) {
        await admin.updateStore(shopId, body);
        setMsg({ ok: true, text: "ذخیره شد." });
      } else {
        const r = await admin.createStore(body);
        router.push(`/admin/stores/${r.id}?created=1`);
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "ذخیره نشد." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <nav aria-label="مسیر صفحه" style={{ fontSize: 14 }}><Link href="/admin/stores">فروشگاه‌ها</Link> <span aria-hidden="true" style={{ color: "var(--ink-muted)" }}>‹</span> <span>{shopId ? f.name || "ویرایش" : "افزودن فروشگاه"}</span></nav>
      <div className="panel-head"><h1>{shopId ? `ویرایش ${f.name}` : "افزودن فروشگاه"}</h1>
        {detail ? (
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="row-sub" style={{ fontSize: 14 }}><span className="num">{faDigits(detail.offers)}</span> کالا</span>
            <Link className="btn btn-secondary btn-sm" href={`/store?shop=${encodeURIComponent(detail.id)}`}>پنل این فروشگاه</Link>
          </span>
        ) : null}</div>

      <form onSubmit={submit} style={{ width: "100%", maxWidth: 880, display: "flex", flexDirection: "column", gap: 16 }}>
        <fieldset className="panel-card" style={{ border: 0, margin: 0 }}>
          <legend className="sr-only">اطلاعات فروشگاه</legend>
          <h2>اطلاعات فروشگاه</h2>
          <div className="form-grid">
            <label className="field">نام فروشگاه
              <input className="input" required minLength={2} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="مثلاً آستین" />
            </label>
            <label className="field">محله
              <input className="input" list="area-list" value={f.area} onChange={(e) => set("area", e.target.value)} placeholder="انتخاب یا تایپ محله" />
              <datalist id="area-list">{areas.map((a) => <option key={a.name} value={a.name} />)}</datalist>
            </label>
          </div>
          <label className="field">آدرس
            <textarea className="textarea" rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="خیابان، کوچه، پلاک، طبقه" />
          </label>
          <div className="field" role="group" aria-labelledby="phones-label">
            <span id="phones-label">تلفن</span>
            {f.phones.map((p, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <input className="input" type="tel" dir="ltr" aria-label={`تلفن ${i + 1}`} value={p} placeholder="0912…" style={{ flex: 1, textAlign: "right" }}
                  onChange={(e) => set("phones", f.phones.map((x, j) => (j === i ? e.target.value : x)))} />
                {f.phones.length > 1 ? <button type="button" className="btn btn-ghost" onClick={() => set("phones", f.phones.filter((_, j) => j !== i))}>حذف</button> : null}
              </div>
            ))}
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              {f.phones.length < 5 ? <button type="button" className="btn btn-ghost" onClick={() => set("phones", [...f.phones, ""])}><PlusIcon className="icon-sm" />شماره‌ی دیگه</button> : null}
              <span className="row-sub" style={{ fontWeight: 400 }}>استعلام دستگاه با شماره‌ی اول تماس می‌گیره.</span>
            </span>
          </div>
        </fieldset>

        <fieldset className="panel-card" style={{ border: 0, margin: 0 }}>
          <legend className="sr-only">موقعیت روی نقشه</legend>
          <h2>موقعیت روی نقشه</h2>
          <PinMap lat={f.lat} lng={f.lng} onPick={(lat, lng) => setF((cur) => cur && { ...cur, lat: +lat.toFixed(6), lng: +lng.toFixed(6) })} />
          <div className="form-grid">
            <label className="field">عرض جغرافیایی
              <input className="input" dir="ltr" inputMode="decimal" value={f.lat ?? ""} placeholder="35.6990"
                onChange={(e) => set("lat", e.target.value ? Number(toLatinDigits(e.target.value)) : null)} />
            </label>
            <label className="field">طول جغرافیایی
              <input className="input" dir="ltr" inputMode="decimal" value={f.lng ?? ""} placeholder="51.4120"
                onChange={(e) => set("lng", e.target.value ? Number(toLatinDigits(e.target.value)) : null)} />
            </label>
          </div>
        </fieldset>

        <fieldset className="panel-card" style={{ border: 0, margin: 0 }}>
          <legend className="sr-only">ساعت کاری</legend>
          <h2>ساعت کاری</h2>
          <div className="chips">
            <button type="button" className="chip" onClick={() => set("hours", Object.fromEntries(DAYS.map((d) => [d.key, { status: "all_day", start: "", end: "" }])))}>شبانه‌روزی، همه‌ی روزها</button>
            <button type="button" className="chip" onClick={() => set("hours", Object.fromEntries(DAYS.map((d) => [d.key, { ...f.hours.sat }])))}>همه‌ی روزها مثل شنبه</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="ptable" style={{ minWidth: 520 }}>
              <thead><tr><th>روز</th><th>وضعیت</th><th>از</th><th>تا</th></tr></thead>
              <tbody>
                {DAYS.map((d) => {
                  const h = f.hours[d.key] ?? { status: "unknown", start: "", end: "" };
                  return (
                    <tr key={d.key}>
                      <th scope="row" style={{ background: "none", fontWeight: 500 }}>{d.fa}</th>
                      <td><select className="select is-sm" aria-label={`وضعیت ${d.fa}`} value={h.status} onChange={(e) => setDay(d.key, { status: e.target.value as HoursDay["status"] })}>
                        <option value="unknown">ثبت نشده</option><option value="open">باز</option><option value="all_day">شبانه‌روزی</option><option value="closed">تعطیل</option>
                      </select></td>
                      <td><input className="input is-sm" type="time" aria-label={`${d.fa} از`} disabled={h.status !== "open"} value={h.start} onChange={(e) => setDay(d.key, { start: e.target.value })} /></td>
                      <td><input className="input is-sm" type="time" aria-label={`${d.fa} تا`} disabled={h.status !== "open"} value={h.end} onChange={(e) => setDay(d.key, { end: e.target.value })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </fieldset>

        <fieldset className="panel-card" style={{ border: 0, margin: 0 }}>
          <legend className="sr-only">روش‌های پرداخت</legend>
          <h2>روش‌های پرداخت</h2>
          <div className="chips">
            {PAYMENTS.map((p) => (
              <label key={p} className="chip" style={{ gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={f.payments.includes(p)} onChange={(e) => set("payments", e.target.checked ? [...f.payments, p] : f.payments.filter((x) => x !== p))} />{p}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="panel-card" style={{ border: 0, margin: 0 }}>
          <legend className="sr-only">دسته‌ها و تنظیمات</legend>
          <h2>دسته‌ها و تنظیمات</h2>
          <label className="field">دسته‌های کالا (با ویرگول جدا کن)
            <input className="input" value={cats} onChange={(e) => setCats(e.target.value)} placeholder="مثلاً گوشی موبایل، لوازم خیاطی" />
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, lineHeight: "22px" }}>
            <input type="checkbox" checked={f.test} onChange={(e) => set("test", e.target.checked)} style={{ marginTop: 4 }} />
            <span style={{ display: "flex", flexDirection: "column" }}><b style={{ fontWeight: 500 }}>فروشگاه آزمایشی</b><span className="row-sub">برای تست؛ تماس‌ها و پیامک‌های آزمایشی به شماره‌ی تست می‌رن</span></span>
          </label>
        </fieldset>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={saving} style={{ minWidth: 160 }}>{saving ? "در حال ذخیره…" : "ذخیره‌ی فروشگاه"}</button>
          <Link className="btn btn-secondary" href="/admin/stores">انصراف</Link>
          {msg ? <span role={msg.ok ? "status" : "alert"} style={{ fontSize: 14, color: msg.ok ? "var(--success)" : "var(--danger)" }}>{msg.text}</span> : null}
        </div>
      </form>

      {shopId && detail ? <StaffCard shopId={shopId} staff={detail.staff} onChange={() => admin.store(shopId).then(setDetail)} /> : null}
    </>
  );
}

function StaffCard({ shopId, staff, onChange }: { shopId: string; staff: ShopDetail["staff"]; onChange: () => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try { await admin.addStaff(shopId, { phone: toLatinDigits(phone), name, role: staff.length ? "staff" : "owner" }); setPhone(""); setName(""); onChange(); }
    catch (x) { setErr(x instanceof Error ? x.message : "اضافه نشد"); }
  }
  return (
    <section className="panel-card" style={{ maxWidth: 880 }} aria-labelledby="staff-h">
      <div><h2 id="staff-h">دسترسی پنل فروشگاه</h2><span className="row-sub">این شماره‌ها با ورود به تربچه، درخواست‌های تأیید این فروشگاه رو می‌بینن و قیمت و موجودی رو به‌روز می‌کنن. پیگیری‌های ناواتل هم به همین شماره‌ها پیامک می‌شه.</span></div>
      <ul className="feed">
        {staff.map((s) => (
          <li key={s.phone}>
            <b className="num" dir="ltr" style={{ fontWeight: 500 }}>{faDigits(s.phone)}</b><span>{s.name}</span>
            <span className="badge badge-plain">{s.role === "owner" ? "مدیر فروشگاه" : "کارمند"}</span>
            <button type="button" className="btn btn-ghost btn-sm when" onClick={() => admin.removeStaff(shopId, s.phone).then(onChange)}>برداشتن</button>
          </li>
        ))}
        {!staff.length ? <li className="row-sub">هنوز کسی اضافه نشده.</li> : null}
      </ul>
      <form onSubmit={add} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <label className="sr-only" htmlFor="staff-phone">شماره</label>
        <input id="staff-phone" className="input" type="tel" dir="ltr" required placeholder="0912…" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ flex: "1 1 180px", textAlign: "right" }} />
        <label className="sr-only" htmlFor="staff-name">نام</label>
        <input id="staff-name" className="input" placeholder="نام (اختیاری)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: "1 1 160px" }} />
        <button className="btn btn-secondary" type="submit"><PlusIcon className="icon-sm" />افزودن</button>
        {err ? <span role="alert" style={{ color: "var(--danger)", fontSize: 14 }}>{err}</span> : null}
      </form>
    </section>
  );
}
