"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import PixelRadish, { EYE_CENTER } from "@/components/login/PixelRadish";
import { requestOtp, verifyOtp } from "@/lib/api";
import { faDigits, toLatinDigits } from "@/lib/format";
import { getSession, saveSession } from "@/lib/store";
import { applyTheme } from "@/lib/theme";

const MOBILE_KEY = "torob-chat:mobile";
const CODE_LEN = 5;

type Step = "phone" | "code" | "done";

export default function LoginPage() {
  const router = useRouter();
  // Where to go after logging in (the page that sent us here), only within this site.
  const nextPath = () => {
    const n = new URLSearchParams(location.search).get("next");
    return n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login") ? n : "/";
  };
  // Already signed in: nothing to do here.
  useEffect(() => {
    if (getSession()) router.replace(nextPath());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const radish = useRef<SVGSVGElement>(null);
  const phoneInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const typing = useRef(false);
  // The eyes ease toward a target every frame instead of jumping, so following the pointer feels smooth.
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const frame = useRef<number | null>(null);

  const aim = useCallback((t: { x: number; y: number }) => {
    target.current = t;
    if (frame.current != null) return;
    const tick = () => {
      const c = current.current, g = target.current;
      const k = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0.18;
      const nx = c.x + (g.x - c.x) * k, ny = c.y + (g.y - c.y) * k;
      const done = Math.abs(g.x - nx) < 0.005 && Math.abs(g.y - ny) < 0.005;
      current.current = done ? g : { x: nx, y: ny };
      setGaze(current.current);
      frame.current = done ? null : requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => { if (frame.current != null) cancelAnimationFrame(frame.current); }, []);

  /** Point the eyes at a screen point: up to one pixel each way, easing off toward the edges. */
  const lookAt = useCallback((x: number, y: number) => {
    const el = radish.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width * EYE_CENTER.fx;
    const ey = r.top + r.height * EYE_CENTER.fy;
    aim({ x: Math.tanh((x - ex) / (r.width * 0.7)), y: Math.tanh((y - ey) / (r.height * 0.7)) });
  }, [aim]);

  // While typing, the eyes read along the number: left at the first digit, right at the last, looking down at the field.
  const followCaret = useCallback(() => {
    const input = phoneInput.current;
    if (!input) return;
    // Every letter typed or deleted moves the eyes one step along the 11 digits.
    const pos = Math.min(input.selectionStart ?? input.value.length, 11);
    aim({ x: -1 + (2 * pos) / 11, y: 1 });
  }, [aim]);

  // Phone step: the eyes follow the mouse (or a finger) until the number field has focus, then the caret.
  useEffect(() => {
    if (step !== "phone") return;
    const onMove = (e: PointerEvent) => {
      if (!typing.current) lookAt(e.clientX, e.clientY);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [step, lookAt]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    const m = toLatinDigits(phone).replace(/\D/g, "");
    if (!/^09\d{9}$/.test(m)) {
      setError("شماره درست نیست؛ مثل ۰۹۱۲۱۲۳۴۵۶۷ بنویس.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await requestOtp(m);
      // Test mode (SMS off): the code is not shown on the page; it is in the backend log.
      if (r.dev_code) console.info("[test mode] login code:", r.dev_code);
      setResendIn(r.resend_after);
      setCode("");
      typing.current = false;
      aim({ x: 0, y: 0 });
      setStep("code");
      readSmsCode();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Android Chrome can hand over the code from the SMS by itself (Web OTP). Elsewhere this does nothing. */
  function readSmsCode() {
    if (typeof window === "undefined" || !("OTPCredential" in window)) return;
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 120_000);
    (navigator.credentials as unknown as { get: (o: object) => Promise<{ code?: string } | null> })
      .get({ otp: { transport: ["sms"] }, signal: ac.signal })
      .then((c) => { if (c?.code) onCode(c.code); })
      .catch(() => {});
  }

  async function onCode(raw: string) {
    const v = toLatinDigits(raw).replace(/\D/g, "").slice(0, CODE_LEN);
    setCode(v);
    setError(null);
    if (v.length < CODE_LEN) return;
    setBusy(true);
    try {
      const r = await verifyOtp(toLatinDigits(phone).replace(/\D/g, ""), v);
      saveSession(r);
      applyTheme(r.settings?.theme);
      try {
        localStorage.setItem(MOBILE_KEY, r.phone); // reused for the store-inquiry SMS
      } catch {
        /* private mode */
      }
      setStep("done");
    } catch (err) {
      setError((err as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-col">
        <PixelRadish ref={radish} gaze={gaze} covering={step === "code"} happy={step === "done"} />
        <div className="login-brand">
          <span className="login-wordmark">تربچه</span>
          <span className="login-slogan">تربچه، دستیار کنترل ولخرجی‌هات</span>
        </div>

        <section className="login-card">
          {step === "phone" ? (
            <form onSubmit={sendCode} className="login-form" noValidate>
              <h1>ورود یا ثبت‌نام</h1>
              <p className="muted">شماره موبایلت رو بنویس تا یه کد برات پیامک کنیم.</p>
              <label htmlFor="phone">شماره موبایل</label>
              <input
                ref={phoneInput} id="phone" className="login-input" type="tel" inputMode="numeric" autoComplete="tel" dir="ltr"
                placeholder="09121234567" value={phone} maxLength={11}
                onChange={(e) => { setPhone(e.target.value.replace(/[^\d۰-۹]/g, "").slice(0, 11)); setError(null); requestAnimationFrame(followCaret); }}
                onKeyUp={followCaret} onClick={followCaret} onSelect={followCaret}
                onFocus={() => { typing.current = true; requestAnimationFrame(followCaret); }}
                onBlur={() => { typing.current = false; aim({ x: 0, y: 0 }); }}
              />
              {error ? <span role="alert" className="login-error">{error}</span> : null}
              <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>{busy ? "در حال ارسال…" : "دریافت کد"}</button>
            </form>
          ) : step === "code" ? (
            <div className="login-form">
              <h1>کد تأیید</h1>
              <p className="muted">
                کد {faDigits(CODE_LEN)} رقمی به <b className="num" dir="ltr">{faDigits(phone)}</b> پیامک شد.{" "}
                <button type="button" className="login-link" onClick={() => { setStep("phone"); setCode(""); setError(null); }}>ویرایش شماره</button>
              </p>
              <label htmlFor="otp">کد پیامک‌شده</label>
              <input
                ref={codeInput} id="otp" className="login-input login-otp" type="text" inputMode="numeric" autoComplete="one-time-code"
                dir="ltr" maxLength={CODE_LEN} placeholder="•••••" value={code} disabled={busy}
                onChange={(e) => onCode(e.target.value)}
              />
              {error ? <span role="alert" className="login-error">{error}</span> : null}
              <div className="login-row">
                <span>{busy ? "در حال بررسی…" : "کد رو از پیامک خودکار می‌خونیم"}</span>
                {resendIn > 0 ? (
                  <span className="num">ارسال دوباره تا {faDigits(`${Math.floor(resendIn / 60)}:${String(resendIn % 60).padStart(2, "0")}`)}</span>
                ) : (
                  <button type="button" className="login-link" onClick={() => sendCode()}>ارسال دوباره</button>
                )}
              </div>
            </div>
          ) : (
            <div className="login-form login-done">
              <b>خوش اومدی!</b>
              <span className="muted">حالا بگو چی می‌خوای بخری.</span>
              <button className="btn btn-primary btn-lg btn-block" onClick={() => router.push(nextPath())}>شروع</button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
