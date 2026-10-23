"use client";

import { useEffect, useRef, useState } from "react";
import { shortTitle } from "@/lib/format";
import type { ProductCard } from "@/lib/types";
import { CloseIcon, SearchIcon, SendIcon, StopIcon } from "./icons";
import { ATTACH_EVENT } from "./UIContext";

type Props = {
  onSend: (text: string, attachments: ProductCard[]) => void;
  onStop?: () => void;
  busy?: boolean;
  variant: "home" | "chat";
  placeholder?: string;
  initialText?: string;
};

const MAX_ATTACH = 4;

/** The message box, with products attached from elsewhere (the pop-up's «درباره این محصول بپرس», the compare tray). */
export default function Composer({ onSend, onStop, busy, variant, placeholder, initialText }: Props) {
  const [text, setText] = useState(initialText ?? "");
  const [attached, setAttached] = useState<ProductCard[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);

  useEffect(() => {
    const onAttach = (e: Event) => {
      const p = (e as CustomEvent<ProductCard>).detail;
      setAttached((list) => (list.some((x) => x.id === p.id) ? list : [...list, p].slice(-MAX_ATTACH)));
      ta.current?.focus();
    };
    window.addEventListener(ATTACH_EVENT, onAttach);
    return () => window.removeEventListener(ATTACH_EVENT, onAttach);
  }, []);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 208) + "px";
  }, [text]);

  const remove = (p: ProductCard) => setAttached((list) => list.filter((x) => x.id !== p.id));
  const canSend = !busy && (text.trim().length > 0 || attached.length > 0);

  function send() {
    if (!canSend) return;
    const msg = text.trim() || (attached.length > 1 ? "این‌ها رو با هم مقایسه کن" : "درباره‌ی این محصول بگو");
    onSend(msg, attached);
    setText("");
    setAttached([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !composing.current) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="composer-wrap">
      <div className="composer">
        {attached.length ? (
          <div className="attach-chips">
            {attached.map((p) => (
              <span key={p.id} className="attach-chip">
                {p.image ? <img className="product-img" src={p.image} alt="" referrerPolicy="no-referrer" /> : null}
                <span>{shortTitle(p.title, 34)}</span>
                <button type="button" onClick={() => remove(p)} aria-label={`برداشتن ${p.title}`}><CloseIcon className="icon-sm" /></button>
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
