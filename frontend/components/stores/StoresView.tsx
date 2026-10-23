"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { getAreas, getStores, recordChoice } from "@/lib/api";
import { distance, faDigits, money, shortTitle } from "@/lib/format";
import { getSavedLocation, saveLocation } from "@/lib/store";
import type { Area, Offer, StoresResponse, UserLocation } from "@/lib/types";
import { ChevronLeft, PinIcon, SearchIcon, TargetIcon } from "../icons";
import StoreCard from "./StoreCard";
import Recommendation from "./Recommendation";

const LeafletMap = dynamic(() => import("./LeafletMap"), { ssr: false, loading: () => <div className="map" /> });

const PROVINCES = [
  "تهران", "البرز", "اصفهان", "خراسان رضوی", "فارس", "آذربایجان شرقی", "آذربایجان غربی", "خوزستان", "مازندران", "گیلان",
  "کرمان", "قم", "قزوین", "همدان", "یزد", "مرکزی", "کرمانشاه", "گلستان", "هرمزگان", "سیستان و بلوچستان", "اردبیل",
  "زنجان", "کردستان", "لرستان", "بوشهر", "سمنان", "چهارمحال و بختیاری", "کهگیلویه و بویراحمد", "خراسان شمالی", "خراسان جنوبی", "ایلام",
];

type Step = "ask" | "locating" | "province" | "area" | "loading" | "results" | "error";

/** Location flow + store results for one product. Covered area today: Tehran only (that is what the data holds). */
/** focusShop: select this shop when the results load (the link in the inquiry SMS).
    standalone: on the product + shop page, where the card offers the inquiry instead of "choose this shop". */
export default function StoresView({ productId, productTitle, productImage, pay = null, focusShop = null, standalone = false }: { productId: string; productTitle: string; productImage: string | null; pay?: string | null; focusShop?: string | null; standalone?: boolean }) {
  const [loc, setLoc] = useState<UserLocation | null>(null);
  const [step, setStep] = useState<Step>("ask");
  const [query, setQuery] = useState("");
  const [areas, setAreas] = useState<Area[]>([]);
  const [data, setData] = useState<StoresResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [chosen, setChosen] = useState(false); // the user picked a shop themself (or came from the SMS link)

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
      setSelected(focused?.offer_id ?? r.recommendation?.primary ?? null);
      setChosen(!!focused);
      setShowAll(false);
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
  // Only a recommended (reliable) shop or one the user picked goes in the card; never a random first row.
  const current: Offer | undefined = data?.stores.find((s) => s.offer_id === selected);
  const cheapest = data?.product.price.min ?? null;
  const me = loc?.lat != null && loc?.lng != null ? { lat: loc.lat, lng: loc.lng } : null;
  const rec = data?.recommendation ?? null;
  const [whyAnswered, setWhyAnswered] = useState<string | null>(null);
  useEffect(() => setWhyAnswered(null), [selected]);
  /** Store insights: where the user chose to buy, next to what تربچه recommended (saved only). */
  const noteChoice = (o: Offer, userSaid?: string) =>
    recordChoice({
      product_id: productId, offer_id: o.offer_id, recommended_offer_id: rec?.primary ?? null,
      lat: loc?.lat ?? null, lng: loc?.lng ?? null, user_said: userSaid ?? null, context: standalone ? "shop_page" : "chat",
    });
  /** Why the shop in the card is the one, for its buy button: from the recommendation, or the only shop. */
  const tagsFor = (o: Offer) => {
    const roles = rec?.options.find((x) => x.offer_id === o.offer_id)?.roles ?? [];
    const only = (data?.stores.length ?? 0) === 1;
    return {
      nearest: only || roles.includes("nearest"),
      cheapest: only || roles.includes("cheapest_nearby") || roles.includes("cheapest_city"),
      distanceM: o.distance_m ?? null,
    };
  };

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

  const payText = pay ? (pay === "any" ? " با خرید قسطی" : ` با ${pay}`) : "";
  const pickShop = (id: string, byUser = true) => {
    setSelected(id);
    setChosen(byUser && !rec?.options.some((o) => o.offer_id === id));
  };
  const others = data.stores.filter((s) => s.offer_id !== current?.offer_id);
  const selectHref = (o: Offer) => (standalone ? undefined : `/p/${encodeURIComponent(productId)}?shop=${encodeURIComponent(o.shop.id)}`);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span className="row-sub">
          {data.stores.length
            ? data.area_fallback
              ? `توی ${loc?.area} نبود؛ نزدیک‌ترین فروشگاه‌ها${payText}`
              : `${faDigits(data.stores.length)} فروشگاه حضوری${payText}${loc?.area ? ` در ${loc.area}` : ""}`
            : "فروشگاه حضوری پیدا نشد"}
        </span>
        <button className="chip" style={{ minHeight: 32 }} onClick={() => { setStep("ask"); saveLocation(null); }}>
          <TargetIcon className="icon-sm" />
          {loc?.label ?? "موقعیت"} · تغییر
        </button>
      </div>

      {data.stores.length === 0 ? (
        <div className="answer-error">
          این کالا{loc?.area ? ` در ${loc.area}` : ""} فروشنده‌ی حضوری{payText} ثبت‌شده نداره.
          {loc?.area ? <button className="btn btn-ghost btn-sm" onClick={() => choose({ label: "همه‌ی تهران" })}>همه‌ی تهران رو ببین</button> : null}
        </div>
      ) : (
        <>
          {current ? (
            <section className="rec" aria-label={`فروشگاه پیشنهادی: ${current.shop.name}`}>
              {rec ? <Recommendation rec={rec} current={current} stores={data.stores} chosenByUser={chosen} onSelect={(id) => pickShop(id, false)} /> : null}
              <StoreCard offer={current} productId={productId} productTitle={productTitle} productImage={productImage}
                tags={tagsFor(current)} onBuy={() => noteChoice(current)}
                cheapest={cheapest} selectHref={selectHref(current)} />
            {chosen && rec && current.offer_id !== rec.primary ? (
                <WhyThisShop answered={whyAnswered} onAnswer={(a) => { setWhyAnswered(a); noteChoice(current, a); }} />
              ) : null}
            </section>
          ) : (
            <div className="answer-error">
              هیچ‌کدوم از فروشگاه‌های حضوری قیمت به‌روز و مطمئنی برای این کالا ندارن، برای همین پیشنهادی نمی‌دم.
              قبل از رفتن با فروشگاه تماس بگیر.
            </div>
          )}

          {others.length ? (
            showAll ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <b style={{ fontSize: 13 }}>فروشگاه‌های دیگه</b>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowAll(false)}>بستن</button>
                </div>
                <div className="map">
                  <LeafletMap stores={data.stores} selectedId={current?.offer_id ?? null} pickId={rec?.primary ?? null} me={me} center={data.center}
                    onSelect={(id) => pickShop(id)} />
                </div>
                <div className="other-stores">
                  {others.map((s) => (
                    <button key={s.offer_id} className="other-store" onClick={() => pickShop(s.offer_id)}>
                      <b>{shortTitle(s.shop.name, 24)}</b>
                      <span className="num" style={{ fontSize: 15, fontWeight: 700 }}>{s.price ? `${money(s.price)} تومان` : "تماس بگیرید"}</span>
                      <span className="row-sub">
                        {s.distance_m != null ? distance(s.distance_m) : s.shop.area}
                        {s.shop.hours.open_now ? " · باز" : ""}
                        {s.price != null && s.updated_days != null && s.updated_days > (rec?.fresh_days ?? 90) ? " · قیمت قدیمی" : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <button className="btn btn-secondary btn-block" onClick={() => setShowAll(true)}>
                دیدن فروشگاه‌های دیگه
                <span className="muted num">({faDigits(others.length)})</span>
              </button>
            )
          ) : null}
        </>
      )}
    </div>
  );
}

const WHY = ["ارزون‌تره", "نزدیک‌تره", "قیمت پیشنهادی به‌روز نبود", "به این فروشگاه اعتماد دارم", "گارانتی بهتری داره", "الان بازه", "یه دلیل دیگه"];

/** One tap: why the user picked another shop than the one تربچه recommended (saved for the shops; not shown). */
function WhyThisShop({ answered, onAnswer }: { answered: string | null; onAnswer: (a: string) => void }) {
  if (answered) return <span className="row-sub">ممنون، ثبت شد.</span>;
  return (
    <div className="why-shop">
      <span className="row-sub">چرا این فروشگاه رو انتخاب کردی؟</span>
      <div className="chips">
        {WHY.map((w) => <button key={w} className="chip" onClick={() => onAnswer(w)}>{w}</button>)}
      </div>
    </div>
  );
}
