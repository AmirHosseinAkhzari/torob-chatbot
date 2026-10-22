"use client";

import { useEffect, useRef, useState } from "react";
import { getInquiry, startInquiry } from "@/lib/api";
import { faDigits, toLatinDigits } from "@/lib/format";
import type { Inquiry, InquiryStatus, Offer } from "@/lib/types";
import { CheckIcon, InfoIcon, PhoneIcon, WarnIcon } from "../icons";

const MOBILE_KEY = "torob-chat:mobile";
const FINAL: InquiryStatus[] = ["available", "unavailable", "no_answer", "failed"];

function savedMobile() {
  try {
    return localStorage.getItem(MOBILE_KEY) ?? "";
  } catch {
    return "";
  }
}

function ago(iso: string | null) {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "همین الان";
  if (min < 60) return `${faDigits(min)} دقیقه پیش`;
  const h = Math.round(min / 60);
  if (h < 24) return `${faDigits(h)} ساعت پیش`;
  return `${faDigits(Math.round(h / 24))} روز پیش`;
}

const STEPS: { key: InquiryStatus[]; text: string }[] = [
  { key: ["queued", "preparing"], text: "آماده کردن پیام صوتی" },
  { key: ["ringing"], text: "زنگ زدن به فروشگاه" },
  { key: ["in_call"], text: "فروشگاه جواب داد؛ منتظر جوابشیم" },
];

/** استعلام دستگاه: Torob calls the (open) shop, asks if the product is in stock (key 1 / 2),
    shows the answer here and texts it to the user. */
export default function InquiryButton({ offer, productId }: { offer: Offer; productId: string }) {
  const s = offer.shop;
  const [phase, setPhase] = useState<"idle" | "form" | "run">("idle");
  const [mobile, setMobile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Inquiry | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    // Another shop was selected: start over.
    setPhase("idle");
    setJob(null);
    setError(null);
  }, [offer.offer_id]);

  function poll(id: string) {
    timer.current = setTimeout(async () => {
      try {
        const j = await getInquiry(id);
        setJob(j);
        if (!FINAL.includes(j.status)) poll(id);
      } catch {
        poll(id);
      }
    }, 1500);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const m = toLatinDigits(mobile).replace(/\D/g, "");
    if (!/^(0?9\d{9}|989\d{9})$/.test(m)) {
      setError("شماره موبایل درست نیست. مثل ۰۹۱۲۱۲۳۴۵۶۷ بنویس.");
      return;
    }
    setError(null);
    try {
      localStorage.setItem(MOBILE_KEY, m);
    } catch {
      /* private mode */
    }
    try {
      const j = await startInquiry({ product_id: productId, shop_id: s.id, phone: m });
      setJob(j);
      setPhase("run");
      poll(j.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const known = offer.stock;
  const stockLine = known ? (
    <div className={`inq-known ${known.status === "available" ? "is-yes" : "is-no"}`}>
      {known.status === "available" ? <CheckIcon className="icon-sm" /> : <InfoIcon className="icon-sm" />}
      <span>
        {known.status === "available" ? "فروشگاه تلفنی تأیید کرده موجوده" : "فروشگاه تلفنی گفته موجود نیست"}
        {known.checked_at ? ` · ${ago(known.checked_at)}` : ""}
      </span>
    </div>
  ) : null;

  if (phase === "idle") {
    if (s.hours.open_now !== true) return stockLine;
    return (
      <div className="inq">
        {stockLine}
        <button className="btn btn-secondary btn-block inq-btn" onClick={() => { setMobile(savedMobile()); setPhase("form"); }}>
          <PhoneIcon className="icon-sm" />
          استعلام دستگاه
          <span className="row-sub">ترب از فروشگاه می‌پرسه موجوده یا نه</span>
        </button>
      </div>
    );
  }

  if (phase === "form") {
    return (
      <form className="inq inq-panel" onSubmit={submit}>
        <b style={{ fontSize: 14 }}>استعلام موجودی از {s.name}</b>
        <p className="row-sub" style={{ margin: 0, fontSize: 13, lineHeight: "22px" }}>
          ترب همین الان به فروشگاه زنگ می‌زنه و می‌پرسه این کالا موجوده یا نه. جواب رو همین‌جا می‌بینی و با پیامک هم برات می‌فرستیم.
        </p>
        <label className="picker-search">
          <span className="sr-only">شماره موبایل برای پیامک نتیجه</span>
          <input
            type="tel" inputMode="numeric" dir="ltr" autoComplete="tel" autoFocus
            placeholder="۰۹۱۲۱۲۳۴۵۶۷" value={mobile} onChange={(e) => setMobile(e.target.value)}
            style={{ textAlign: "right" }}
          />
        </label>
        {error ? <div className="answer-error">{error}</div> : null}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" type="submit" style={{ flex: 1 }}>
            <PhoneIcon className="icon-sm" />
            بپرس
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => setPhase("idle")}>انصراف</button>
        </div>
      </form>
    );
  }

  // phase === "run"
  const st = job?.status ?? "queued";
  const done = FINAL.includes(st);
  const at = STEPS.findIndex((x) => x.key.includes(st));

  return (
    <div className="inq inq-panel" role="status" aria-live="polite">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <b style={{ fontSize: 14 }}>استعلام از {s.name}</b>
        {job?.test_call ? <span className="badge badge-plain">تماس آزمایشی</span> : null}
      </div>

      {!done ? (
        <ol className="inq-steps">
          {STEPS.map((x, i) => (
            <li key={x.text} className={i < at ? "is-done" : i === at ? "is-now" : ""}>
              <span className="inq-dot">{i < at ? <CheckIcon className="icon-sm" /> : null}</span>
              {x.text}
            </li>
          ))}
        </ol>
      ) : st === "available" ? (
        <div className="inq-result is-yes">
          <CheckIcon />
          <div>
            <b>موجوده!</b>
            <span>{s.name} تلفنی تأیید کرد این کالا رو الان داره.</span>
          </div>
        </div>
      ) : st === "unavailable" ? (
        <div className="inq-result is-no">
          <InfoIcon />
          <div>
            <b>موجود نیست</b>
            <span>{s.name} گفت الان این کالا رو نداره. فروشگاه‌های دیگه رو روی نقشه ببین.</span>
          </div>
        </div>
      ) : (
        <div className="inq-result is-no">
          <WarnIcon />
          <div>
            <b>{st === "no_answer" ? "فروشگاه جواب نداد" : "تماس برقرار نشد"}</b>
            <span>{st === "no_answer" ? "چند دقیقه‌ی دیگه دوباره امتحان کن." : "مشکلی در تماس پیش اومد؛ دوباره امتحان کن."}</span>
          </div>
        </div>
      )}

      {done && job?.sms ? (
        <details className="inq-sms">
          <summary className="row-sub">
            {job.sms.sent ? `نتیجه به ${faDigits("0" + job.sms.to.slice(2))} پیامک شد` : "پیامک ساخته شد ولی ارسال نشد (حالت تست)"}
          </summary>
          <pre>{job.sms.text}</pre>
        </details>
      ) : null}

      {done && (st === "no_answer" || st === "failed") ? (
        <button className="btn btn-secondary btn-sm" onClick={() => { setPhase("form"); setJob(null); }}>دوباره بپرس</button>
      ) : null}
    </div>
  );
}
