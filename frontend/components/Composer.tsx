"use client";

import { useEffect, useRef, useState } from "react";
import { liveSearch } from "@/lib/api";
import { money, shortTitle } from "@/lib/format";
import type { LiveResult, ProductCard } from "@/lib/types";
import { ChevronLeft, CloseIcon, PinIcon, SearchIcon, SendIcon, StopIcon } from "./icons";
import { ATTACH_EVENT, useUI } from "./UIContext";

type Props = {
  onSend: (text: string, attachments: ProductCard[]) => void;
  onStop?: () => void;
  busy?: boolean;
  variant: "home" | "chat";
  placeholder?: string;
  initialText?: string;
};

const MAX_ATTACH = 4;

/** The message box: live Torob search while typing, attachable products, city names kept out of product matches. */
export default function Composer({ onSend, onStop, busy, variant, placeholder, initialText }: Props) {
  const { openProduct } = useUI();
  const [text, setText] = useState(initialText ?? "");
  const [attached, setAttached] = useState<ProductCard[]>([]);
  const [live, setLive] = useState<LiveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const ta = useRef<HTMLTextAreaElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const composing = useRef(false);

  // Products attached from elsewhere (pop-up "ask about this product", compare tray).
  useEffect(() => {
    const onAttach = (e: Event) => {
      const p = (e as CustomEvent<ProductCard>).detail;
      setAttached((list) => (list.some((x) => x.id === p.id) ? list : [...list, p].slice(-MAX_ATTACH)));
      ta.current?.focus();
    };
    window.addEventListener(ATTACH_EVENT, onAttach);
    return () => window.removeEventListener(ATTACH_EVENT, onAttach);
  }, []);

  // Live search, debounced. Long sentences are questions, not product names: skip them.
  useEffect(() => {
    const q = text.trim();
    const words = q.split(/\s+/).filter(Boolean);
    if (q.length < 2 || words.length > 6) {
      setLive(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      liveSearch(q, ctrl.signal)
        .then((r) => {
          setLive(r);
          setActive(-1);
          setOpen(true);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [text]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 208) + "px";
  }, [text]);

  const toggle = (p: ProductCard) =>
    setAttached((list) => (list.some((x) => x.id === p.id) ? list.filter((x) => x.id !== p.id) : [...list, p].slice(-MAX_ATTACH)));

  // Suggestions open the product pop-up; attaching happens there ("درباره این محصول بپرس").
  function openFromList(p: ProductCard) {
    setOpen(false);
    openProduct(p.id);
  }

  const canSend = !busy && (text.trim().length > 0 || attached.length > 0);

  function send() {
    if (!canSend) return;
    const msg = text.trim() || (attached.length > 1 ? "این‌ها رو با هم مقایسه کن" : "درباره‌ی این محصول بگو");
    onSend(msg, attached);
    setText("");
    setAttached([]);
    setOpen(false);
    setLive(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const items = live?.products ?? [];
    if (open && items.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % items.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? items.length - 1 : i - 1)); return; }
      if (e.key === "Enter" && active >= 0 && !composing.current) { e.preventDefault(); openFromList(items[active]); return; }
    }
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "Enter" && !e.shiftKey && !composing.current) {
      e.preventDefault();
      send();
    }
  }

  const showDrop = open && live && (live.products.length > 0 || live.place || !loading);
  const placeOnly = live?.place && live.products.length === 0;

  return (
    <div className="composer-wrap" ref={wrap}>
      {showDrop && live ? (
        <div className={`live ${variant === "home" ? "down" : "up"}`} role="listbox" aria-label="پیشنهادهای زنده از ترب">
          <div className="live-head">
            {loading ? <img className="pixel" src="/brand/searching.gif" width={20} height={20} alt="" /> : <SearchIcon className="icon-sm" />}
            <span>نتیجه‌ی زنده از ترب برای «{live.query}»</span>
          </div>
          {live.place ? (
            <div className="live-place">
              <PinIcon className="icon" />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <b style={{ fontSize: 13, fontWeight: 500 }}>{live.place.name} اسم {live.place.kind === "area" ? "محله" : "شهر"}ه، نه محصول</b>
                <span className="row-sub">
                  {live.place.covered ? `فروشگاه‌های حضوری ${live.place.name} رو هم می‌تونم پیدا کنم` : "فعلاً فقط فروشگاه‌های تهران در ترب ثبت شده"}
                </span>
              </div>
            </div>
          ) : null}
          {live.products.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={`live-row ${i === active ? "is-active" : ""}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => openFromList(p)}
            >
              {p.image ? <img className="product-img" src={p.image} alt="" referrerPolicy="no-referrer" /> : <span style={{ width: 44 }} />}
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span className="live-title">{p.title}</span>
                <span className="row-sub num">
                  {p.price.min != null ? `از ${money(p.price.min)} تومان` : "قیمت ثبت نشده"}
                  {p.shop_count > 1 ? ` · در ${p.shop_count.toLocaleString("fa-IR")} فروشگاه` : " · یک فروشنده"}
                </span>
              </span>
              <ChevronLeft className="icon-sm muted" />
            </button>
          ))}
          {!loading && live.products.length === 0 && !placeOnly ? (
            <div className="row-sub" style={{ padding: 12 }}>محصولی با این اسم پیدا نشد. پیام رو بفرست تا بیشتر بگردم.</div>
          ) : null}
          <button type="button" className="live-foot" onMouseDown={(e) => e.preventDefault()} onClick={send}>
            <SearchIcon className="icon-sm" />
            بپرس: «{shortTitle(live.query, 40)}»
          </button>
        </div>
      ) : null}

      <div className="composer">
        {attached.length ? (
          <div className="attach-chips">
            {attached.map((p) => (
              <span key={p.id} className="attach-chip">
                {p.image ? <img className="product-img" src={p.image} alt="" referrerPolicy="no-referrer" /> : null}
                <span>{shortTitle(p.title, 34)}</span>
                <button type="button" onClick={() => toggle(p)} aria-label={`برداشتن ${p.title}`}><CloseIcon className="icon-sm" /></button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="composer-row">
          <label className="sr-only" htmlFor={`composer-${variant}`}>پیام</label>
          <textarea
            id={`composer-${variant}`}
            ref={ta}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => live && setOpen(true)}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            placeholder={placeholder ?? "اسم محصول یا سؤالت رو بنویس"}
            autoFocus={variant === "home"}
          />
          {busy && onStop ? (
            <button type="button" className="send is-stop" onClick={onStop} aria-label="توقف پاسخ"><StopIcon /></button>
          ) : (
            <button type="button" className="send" onClick={send} disabled={!canSend} aria-label={variant === "home" ? "جست‌وجو در ترب" : "ارسال"}>
              {variant === "home" ? <SearchIcon /> : <SendIcon />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
