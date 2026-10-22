"use client";

import { useState } from "react";
import { faDigits, money } from "@/lib/format";
import type { Source, Status } from "@/lib/types";
import { CheckIcon, ChevronDown, ChevronLeft, SearchIcon } from "../icons";
import { useUI } from "../UIContext";

/** While working: the search GIF and real steps with counts. When done: a sources chip that opens the list. */
export default function SearchProgress({ status, sources, working }: { status: Status[]; sources: { searches: number; items: Source[] } | null; working: boolean }) {
  const [open, setOpen] = useState(false);
  const { openProduct } = useUI();
  const items = sources?.items ?? [];

  if (working) {
    return (
      <div className="search-card" role="status" aria-live="polite">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img className="pixel" src="/brand/searching.gif" width={36} height={36} alt="" />
          <b style={{ fontSize: 15 }}>{status.length ? "دارم توی ترب می‌گردم…" : "دارم پیامت رو می‌خونم…"}</b>
        </div>
        {status.length ? (
          <div className="search-steps">
            {status.map((s) => (
              <div key={s.id} className="search-step" style={{ color: s.state === "done" ? "var(--ink)" : "var(--ink-muted)" }}>
                {s.state === "done" ? <CheckIcon className="icon-sm" /> : <span className="dot" />}
                <span>{s.text}{s.state === "done" && s.count != null ? <span className="muted"> · {faDigits(s.count)} نتیجه</span> : null}</span>
              </div>
            ))}
          </div>
        ) : null}
        {items.length ? (
          <div className="thumb-stack" aria-hidden="true">
            {items.slice(0, 6).map((s) => (s.image ? <img key={s.id} src={s.image} alt="" referrerPolicy="no-referrer" /> : null))}
          </div>
        ) : null}
      </div>
    );
  }

  if (!sources || !sources.searches) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button className="sources-chip" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <SearchIcon className="icon-sm muted" />
        <span className="num">{faDigits(sources.searches)} جست‌وجو · {faDigits(items.length)} منبع</span>
        <span className="thumb-stack">
          {items.slice(0, 3).map((s) => (s.image ? <img key={s.id} src={s.image} alt="" referrerPolicy="no-referrer" /> : null))}
        </span>
        <span style={{ color: "var(--brand-ink)", fontWeight: 500 }}>{open ? "بستن منبع‌ها" : "دیدن منبع‌ها"}</span>
        <ChevronDown className="icon-sm" />
      </button>
      {open ? (
        <div className="list" style={{ border: "1px solid var(--divider)" }}>
          {items.map((s) => (
            <button key={s.id} className="list-row" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }} onClick={() => openProduct(s.id)}>
              {s.image ? <img className="product-img" src={s.image} alt="" width={40} height={40} referrerPolicy="no-referrer" /> : <span style={{ width: 40 }} />}
              <span className="row-main"><b>{s.title}</b><span className="row-sub num">{s.price ? `از ${money(s.price)} تومان` : "قیمت ثبت نشده"} · torob.com</span></span>
              <ChevronLeft className="icon-sm muted" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
