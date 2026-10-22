"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { getAreas, getStores } from "@/lib/api";
import { distance, faDigits, money, shortTitle } from "@/lib/format";
import { getSavedLocation, saveLocation } from "@/lib/store";
import type { Area, Offer, StoresResponse, UserLocation } from "@/lib/types";
import { ChevronLeft, PinIcon, SearchIcon, TargetIcon } from "../icons";
import StoreCard from "./StoreCard";
import StorePick from "./StorePick";

const LeafletMap = dynamic(() => import("./LeafletMap"), { ssr: false, loading: () => <div className="map" /> });

const PROVINCES = [
  "تهران", "البرز", "اصفهان", "خراسان رضوی", "فارس", "آذربایجان شرقی", "آذربایجان غربی", "خوزستان", "مازندران", "گیلان",
  "کرمان", "قم", "قزوین", "همدان", "یزد", "مرکزی", "کرمانشاه", "گلستان", "هرمزگان", "سیستان و بلوچستان", "اردبیل",
  "زنجان", "کردستان", "لرستان", "بوشهر", "سمنان", "چهارمحال و بختیاری", "کهگیلویه و بویراحمد", "خراسان شمالی", "خراسان جنوبی", "ایلام",
];

type Step = "ask" | "locating" | "province" | "area" | "loading" | "results" | "error";

/** Location flow + store results for one product. Covered area today: Tehran only (that is what the data holds). */
/** focusShop: select this shop when the results load (the link in the inquiry SMS). */
export default function StoresView({ productId, productTitle, productImage, pay = null, focusShop = null }: { productId: string; productTitle: string; productImage: string | null; pay?: string | null; focusShop?: string | null }) {
  const [loc, setLoc] = useState<UserLocation | null>(null);
  const [step, setStep] = useState<Step>("ask");
  const [query, setQuery] = useState("");
  const [areas, setAreas] = useState<Area[]>([]);
  const [data, setData] = useState<StoresResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const saved = getSavedLocation();
    if (focusShop) {
      // Opened from the SMS: show that shop right away. A saved neighborhood would filter it out,
      // so only a saved GPS position is kept (for distances); otherwise all of Tehran.
      const l = saved?.lat != null && saved?.lng != null ? saved : { label: "همه‌ی تهران" };
      setLoc(l);
      load(l);
    } else if (saved) {
      setLoc(saved);
      load(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, pay]);

  async function load(l: UserLocation) {
    setStep("loading");
    try {
      const r = await getStores(productId, l, pay, undefined, focusShop);
      setData(r);
      const focused = focusShop ? r.stores.find((x) => x.shop.id === focusShop) : undefined;
      setSelected(focused?.offer_id ?? r.pick?.offer_id ?? r.stores[0]?.offer_id ?? null);
      setStep("results");
    } catch {
      setMessage("فروشگاه‌ها رو نتونستم بیارم. اتصال به سرور رو بررسی کن.");
      setStep("error");
    }
  }

  function choose(l: UserLocation) {
    setLoc(l);
    saveLocation(l);
    load(l);
  }

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setMessage("مرورگرت موقعیت رو پشتیبانی نمی‌کنه؛ محله‌ت رو انتخاب کن.");
      setStep("province");
      return;
    }
    setStep("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "موقعیت فعلی تو" }),
      () => {
        setMessage("اجازه‌ی موقعیت داده نشد. استان و محله‌ت رو انتخاب کن.");
        setStep("province");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  async function openAreas() {
    setStep("area");
    setQuery("");
    if (!areas.length) {
      try {
        setAreas((await getAreas()).areas);
      } catch {
        setMessage("فهرست محله‌ها رو نتونستم بیارم.");
      }
    }
  }

  const provinces = useMemo(() => PROVINCES.filter((p) => !query || p.includes(query.trim())), [query]);
  const areaList = useMemo(() => areas.filter((a) => !query || a.name.includes(query.trim())), [areas, query]);
  const current: Offer | undefined = data?.stores.find((s) => s.offer_id === selected) ?? data?.stores[0];
  const cheapest = data?.product.price.min ?? null;
  const me = loc?.lat != null && loc?.lng != null ? { lat: loc.lat, lng: loc.lng } : null;
  const pickOffer = data?.pick ? data.stores.find((x) => x.offer_id === data.pick!.offer_id) : undefined;

  if (step === "ask" || step === "locating") {
    return (
      <div className="loc-ask">
        <span className="loc-icon"><PinIcon /></span>
        <b style={{ fontSize: 17, lineHeight: "28px" }}>ترب برای پیدا کردن فروشگاه‌های حضوری، موقعیتت رو لازم داره</b>
        <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: "24px" }}>
          نزدیک‌ترین فروشگاه‌هایی که این کالا رو دارن، با فاصله و مسیر نشونت می‌دیم. موقعیتت فقط برای همین جست‌وجو استفاده می‌شه.
        </p>
        <button className="btn btn-primary btn-lg" onClick={useMyLocation} disabled={step === "locating"}>
          {step === "locating" ? "در حال گرفتن موقعیت…" : "باشه، موقعیتم رو بفرست"}
        </button>
        <button className="btn btn-secondary btn-lg" onClick={() => { setStep("province"); setQuery(""); }}>نه، استان و شهرم رو انتخاب می‌کنم</button>
      </div>
    );
  }

  if (step === "province" || step === "area") {
    const isArea = step === "area";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {message ? <div className="answer-error">{message}</div> : null}
        <label className="picker-search">
          <SearchIcon className="muted" />
          <span className="sr-only">{isArea ? "جست‌وجوی محله" : "جست‌وجوی استان"}</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={isArea ? "جست‌وجوی محله در تهران" : "جست‌وجوی استان"} autoFocus />
        </label>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span className="row-sub">{isArea ? "محله‌های تهران با فروشگاه حضوری" : "استان‌ها · فعلاً فقط فروشگاه‌های تهران در ترب ثبت شده"}</span>
          {isArea ? <button className="btn btn-ghost btn-sm" onClick={() => { setStep("province"); setQuery(""); }}>همه استان‌ها</button> : (
            <button className="btn btn-ghost btn-sm" onClick={useMyLocation}><TargetIcon className="icon-sm" />موقعیت فعلی</button>
          )}
        </div>
        <div className="picker-list" role="list">
          {isArea
            ? areaList.map((a) => (
                <button key={a.name} className="picker-row" role="listitem" onClick={() => choose({ area: a.name, label: `${a.name}، تهران` })}>
                  <span>{a.name} <span className="row-sub">· {faDigits(a.shops)} فروشگاه</span></span>
                  <ChevronLeft className="icon-sm muted" />
                </button>
              ))
            : provinces.map((p) => (
                <button key={p} className="picker-row" role="listitem" disabled={p !== "تهران"} onClick={() => p === "تهران" && openAreas()}>
                  <span>{p}{p !== "تهران" ? <span className="row-sub"> · به‌زودی</span> : null}</span>
                  {p === "تهران" ? <ChevronLeft className="icon-sm muted" /> : null}
                </button>
              ))}
          {(isArea ? areaList : provinces).length === 0 ? <p className="muted" style={{ padding: 14, margin: 0 }}>چیزی با این اسم پیدا نشد.</p> : null}
        </div>
      </div>
    );
  }

  if (step === "loading") {
    return (
      <div className="searching" role="status">
        {loc?.lat != null ? <span className="badge badge-ok" style={{ height: 28, fontSize: 13 }}>موقعیتت گرفته شد</span> : null}
        <img className="pixel" src="/brand/searching.gif" width={64} height={64} alt="" />
        <b style={{ fontSize: 16 }}>دارم فروشگاه‌های حضوری {loc?.area ?? "نزدیک تو"} رو پیدا می‌کنم…</b>
      </div>
    );
  }

  if (step === "error" || !data) {
    return (
      <div className="answer-error" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {message ?? "مشکلی پیش اومد."}
        <button className="btn btn-secondary btn-sm" onClick={() => (loc ? load(loc) : setStep("ask"))}>دوباره امتحان کن</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span className="row-sub">
          {data.stores.length
            ? data.area_fallback
              ? `توی ${loc?.area} نبود؛ نزدیک‌ترین فروشگاه‌ها${pay ? (pay === "any" ? " با خرید قسطی" : ` با ${pay}`) : ""}`
              : `${faDigits(data.stores.length)} فروشگاه حضوری${pay ? (pay === "any" ? " با خرید قسطی" : ` با ${pay}`) : ""}${loc?.area ? ` در ${loc.area}` : ""}`
            : "فروشگاه حضوری پیدا نشد"}
        </span>
        <button className="chip" style={{ minHeight: 32 }} onClick={() => { setStep("ask"); saveLocation(null); }}>
          <TargetIcon className="icon-sm" />
          {loc?.label ?? "موقعیت"} · تغییر
        </button>
      </div>
      {data.stores.length === 0 ? (
        <div className="answer-error">
          این کالا{loc?.area ? ` در ${loc.area}` : ""} فروشنده‌ی حضوری{pay ? (pay === "any" ? " با خرید قسطی" : ` با ${pay}`) : ""} ثبت‌شده نداره.
          {loc?.area ? <button className="btn btn-ghost btn-sm" onClick={() => choose({ label: "همه‌ی تهران" })}>همه‌ی تهران رو ببین</button> : null}
        </div>
      ) : (
        <>
          {data.pick && pickOffer ? <StorePick offer={pickOffer} pick={data.pick} onShow={() => setSelected(pickOffer.offer_id)} /> : null}
          <div className="map">
            <LeafletMap stores={data.stores} selectedId={current?.offer_id ?? null} pickId={pickOffer?.offer_id ?? null} me={me} center={data.center} onSelect={setSelected} />
          </div>
          {current ? (
            <StoreCard offer={current} productId={productId} productTitle={productTitle}
              selectHref={focusShop ? undefined : `/p/${encodeURIComponent(productId)}?shop=${encodeURIComponent(current.shop.id)}`} productImage={productImage} cheapest={cheapest}
              hideRoute={current.offer_id === pickOffer?.offer_id} />
          ) : null}
          {data.stores.length > 1 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <b style={{ fontSize: 13 }}>فروشگاه‌های دیگه</b>
              <div className="other-stores">
                {data.stores.filter((s) => s.offer_id !== current?.offer_id).map((s) => (
                  <button key={s.offer_id} className="other-store" onClick={() => setSelected(s.offer_id)}>
                    <b>{shortTitle(s.shop.name, 24)}</b>
                    <span className="num" style={{ fontSize: 14, fontWeight: 700 }}>{s.price ? money(s.price) : "تماس بگیرید"}</span>
                    <span className="row-sub">{s.distance_m != null ? distance(s.distance_m) : s.shop.area}{s.shop.hours.open_now ? " · باز" : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
