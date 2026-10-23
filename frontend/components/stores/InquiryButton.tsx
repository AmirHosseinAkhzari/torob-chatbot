"use client";

import { useEffect, useRef, useState } from "react";
import { getInquiry, startInquiry } from "@/lib/api";
import { faDigits, money } from "@/lib/format";
import { useSession } from "@/lib/store";
import type { Inquiry, InquiryStatus, Offer } from "@/lib/types";
import { CheckIcon, InfoIcon, PhoneIcon, WarnIcon } from "../icons";

const FINAL: InquiryStatus[] = ["available", "unavailable", "no_answer", "failed"];

function ago(iso: string | null) {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "همین الان";
  if (min < 60) return `${faDigits(min)} دقیقه پیش`;
  const h = Math.round(min / 60);
  if (h < 24) return `${faDigits(h)} ساعت پیش`;
  return `${faDigits(Math.round(h / 24))} روز پیش`;
}

/** The call, step by step; the last two only when the shop says it has it. */
const STEPS: { key: (j: Inquiry | null) => boolean; text: string }[] = [
  { key: (j) => !j || j.status === "queued" || j.status === "preparing", text: "آماده کردن پیام صوتی" },
  { key: (j) => j?.status === "ringing", text: "زنگ زدن به فروشگاه" },
  { key: (j) => j?.status === "in_call" && (!j.step || j.step === "availability"), text: "پرسیدن موجودی" },
  { key: (j) => j?.status === "in_call" && j.step !== "availability" && !!j.step, text: "پرسیدن قیمت" },
];

/** استعلام دستگاه: Torob calls the (open) shop, asks if it has the product and checks the price on the keypad,
    shows the answer here and texts it to the account's phone. */
export default function InquiryButton({ offer, productId }: { offer: Offer; productId: string }) {
  const s = offer.shop;
  const session = useSession();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Inquiry | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    // Another shop was selected: start over.
    setRunning(false);
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

  async function start() {
    setError(null);
    try {
      const j = await startInquiry({ product_id: productId, shop_id: s.id });
      setJob(j);
      setRunning(true);
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
        {known.status === "available" && known.verified_price ? ` · قیمت تلفنی ${money(known.verified_price)} تومان` : ""}
        {known.checked_at ? ` · ${ago(known.checked_at)}` : ""}
      </span>
    </div>
  ) : null;

  if (!running) {
    if (s.hours.open_now !== true) return stockLine;
    return (
      <div className="inq">
        {stockLine}
        <button className="btn btn-secondary btn-block inq-btn" onClick={start}>
          <PhoneIcon className="icon-sm" />
          استعلام دستگاه
          <span className="row-sub">ترب از فروشگاه موجودی و قیمت رو می‌پرسه{session ? ` و به ${faDigits(session.phone)} پیامک می‌کنه` : ""}</span>
        </button>
        {error ? <div className="answer-error">{error}</div> : null}
      </div>
    );
  }

  const st = job?.status ?? "queued";
  const done = FINAL.includes(st);
  const at = STEPS.findIndex((x) => x.key(job));
  const priceLine =
    job?.price_status === "confirmed" ? `قیمت ${money(job.quoted_price)} تومان رو هم تأیید کرد.`
      : job?.price_status === "corrected" ? `قیمت درست رو ${money(job.quoted_price)} تومان گفت${job.listed_price ? ` (نه ${money(job.listed_price)})` : ""}.`
        : job?.price_status === "unverified" ? "قیمت تأیید نشد؛ قبل از رفتن تماس بگیر." : null;

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
            <span>{s.name} تلفنی تأیید کرد این کالا رو الان داره.{priceLine ? ` ${priceLine}` : ""}</span>
          </div>
        </div>
      ) : st === "unavailable" ? (
        <div className="inq-result is-no">
          <InfoIcon />
          <div>
            <b>موجود نیست</b>
            <span>{s.name} گفت الان این کالا رو نداره. فروشگاه‌های دیگه رو ببین.</span>
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
        <span className="row-sub">
          {job.sms.sent ? `نتیجه به ${faDigits("0" + job.sms.to.slice(2))} پیامک شد.` : "پیامک نتیجه ارسال نشد."}
        </span>
      ) : null}

      {done && (st === "no_answer" || st === "failed") ? (
        <button className="btn btn-secondary btn-sm" onClick={start}>دوباره بپرس</button>
      ) : null}
    </div>
  );
}
