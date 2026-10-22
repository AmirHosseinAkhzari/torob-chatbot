"use client";

import { Fragment, useState } from "react";
import { faDigits, money } from "@/lib/format";
import type { Block, CompareRow, ProductCard } from "@/lib/types";
import { AttachIcon, ChevronDown, InfoIcon, MapIcon, StoreIcon, WarnIcon } from "../icons";
import { PaymentLogo } from "../PaymentLogo";
import StoresView from "../stores/StoresView";
import { useUI } from "../UIContext";
import BnplStrip, { BnplTag, payLabel } from "./BnplStrip";
import { useChat } from "./ChatContext";

export default function BlockView({ block, last }: { block: Block; last: boolean }) {
  switch (block.kind) {
    case "understood": return <Understood block={block} />;
    case "quick_reply": return <QuickReply block={block} active={last} />;
    case "products": return block.style === "pick" ? <ProductPick block={block} /> : <ProductRow block={block} />;
    case "compare": return <CompareTable block={block} />;
    case "summary": return <Summary block={block} />;
    case "stores": return <Stores block={block} />;
    case "payment_options": return <PaymentOptions block={block} />;
    default: return null;
  }
}

const priceLine = (p: ProductCard) => (p.price.min != null ? <>از {money(p.price.min)} <small className="muted" style={{ fontWeight: 400, fontSize: 12 }}>تومان</small></> : <span className="muted">قیمت ثبت نشده</span>);
const shopsLine = (p: ProductCard) => {
  const n = p.shop_count;
  if (p.bnpl?.seller_count) return `${n > 1 ? `در ${faDigits(n)} فروشگاه` : "یک فروشنده"} با ${payLabel(p.bnpl)}`;
  return n > 1 ? `در ${faDigits(n)} فروشگاه` : "فقط یک فروشنده";
};

function Understood({ block }: { block: Extract<Block, { kind: "understood" }> }) {
  const { send, busy } = useChat();
  const assumed = block.conditions.filter((c) => c.assumed);
  const [answered, setAnswered] = useState(false);
  return (
    <section className="understood" aria-label="برداشت از درخواست">
      <div className="chips">
        {block.conditions.map((c) => (
          <span key={c.label} className={`chip ${c.assumed ? "is-assumed" : ""}`} style={{ minHeight: 34, cursor: "default" }}>
            {c.assumed ? <span className="badge badge-plain">فرض</span> : null}
            {c.label}
          </span>
        ))}
      </div>
      {assumed.length && !answered ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 10, borderTop: "1px solid var(--divider)" }}>
          <span style={{ fontSize: 14 }}>فرض گرفتم {assumed.map((a) => `«${a.label}»`).join(" و ")}. درسته؟</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setAnswered(true)}>آره، درسته</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setAnswered(true); send(`نه، ${assumed[0].label} درست نیست.`); }}>نه، عوضش کن</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function QuickReply({ block, active }: { block: Extract<Block, { kind: "quick_reply" }>; active: boolean }) {
  const { send, busy } = useChat();
  const [picked, setPicked] = useState<string[]>([]);
  const disabled = !active || busy;
  return (
    <section className="quick" aria-label={block.question}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <img className="pixel" src="/brand/radish.png" width={28} height={28} alt="" />
        <b style={{ fontSize: 15 }}>{block.question}</b>
        {block.multi ? <span className="row-sub">(چندتا هم می‌شه)</span> : null}
      </div>
      <div className="quick-grid">
        {block.options.map((o) => (
          <button key={o} className="chip" disabled={disabled} aria-pressed={picked.includes(o)}
            onClick={() => (block.multi ? setPicked((l) => (l.includes(o) ? l.filter((x) => x !== o) : [...l, o])) : send(o))}>
            {o}
          </button>
        ))}
      </div>
      {block.multi && active ? (
        <button className="btn btn-primary" disabled={disabled || !picked.length} onClick={() => send(picked.join("، "))}>ادامه</button>
      ) : null}
    </section>
  );
}

function ProductPick({ block }: { block: Extract<Block, { kind: "products" }> }) {
  const { openProduct, attachToComposer } = useUI();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {block.heading ? <h3 className="section-title">{block.heading}</h3> : null}
      {block.items.map((p) => (
        <article key={p.id} className="pick">
          <div className="pick-card">
            {p.image ? <img className="product-img" src={p.image} alt={p.title} referrerPolicy="no-referrer" onClick={() => openProduct(p.id, "sellers", p.bnpl?.filter)} /> : null}
            <div className="pick-body">
              <button className="pick-title" onClick={() => openProduct(p.id, "sellers", p.bnpl?.filter)}>{p.title}</button>
              {p.specs.length ? (
                <dl className="spec-dl">{p.specs.map((s) => <Fragment key={s.key}><dt>{s.key}</dt><dd>{s.value}</dd></Fragment>)}</dl>
              ) : null}
              <div className="pick-foot">
                <span className="price num">{priceLine(p)} <small className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{shopsLine(p)}</small></span>
                <span style={{ display: "flex", gap: 4 }}>
                  <button className="btn btn-ghost btn-icon" onClick={() => attachToComposer(p)} aria-label={`پرسیدن درباره‌ی ${p.title}`} title="بپرس"><AttachIcon /></button>
                  {p.bnpl ? null : <button className="btn btn-ghost btn-icon" onClick={() => openProduct(p.id, "map")} aria-label="فروشگاه‌های حضوری" title="حضوری"><MapIcon /></button>}
                  <button className="btn btn-primary" onClick={() => openProduct(p.id, "sellers", p.bnpl?.filter)}>فروشنده‌ها</button>
                </span>
              </div>
            </div>
            {p.bnpl ? <BnplStrip p={p} /> : null}
          </div>
          {p.reason ? <p style={{ margin: 0, fontSize: 14, lineHeight: "24px" }}>{p.reason}</p> : null}
          {p.caveat ? <div className="caveat"><InfoIcon className="icon-sm muted" />{p.caveat}</div> : null}
          {p.stock || p.lookalike ? <div className="caveat"><WarnIcon className="icon-sm" />{p.stock ? "این کالا استوک یا کارکرده‌ست." : "این کالا «طرح» و غیراصله."}</div> : null}
        </article>
      ))}
    </div>
  );
}

function ProductRow({ block }: { block: Extract<Block, { kind: "products" }> }) {
  const { openProduct } = useUI();
  const { send, busy } = useChat();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((l) => (l.includes(id) ? l.filter((x) => x !== id) : l.length >= 3 ? l : [...l, id]));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {block.heading ? <h3 className="section-title">{block.heading}</h3> : null}
      <div className="cards">
        {block.items.map((p) => {
          const on = picked.includes(p.id);
          return (
            <div key={p.id} className={`p-card ${on ? "is-selected" : ""}`}>
              <button className="p-card-media" onClick={() => openProduct(p.id, "sellers", p.bnpl?.filter)} aria-label={p.title}>
                {p.image ? <img src={p.image} alt="" referrerPolicy="no-referrer" /> : null}
              </button>
              <div className="p-card-body">
                <p className="p-card-title">{p.title}</p>
                <span className="price num" style={{ fontSize: 15 }}>{priceLine(p)}</span>
                <span className="row-sub">{shopsLine(p)}</span>
                {p.bnpl ? <BnplTag b={p.bnpl} /> : null}
                <button className="chip" aria-pressed={on} onClick={() => toggle(p.id)} style={{ justifyContent: "center", marginTop: 4 }}>
                  {on ? "انتخاب شد" : "افزودن به مقایسه"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {picked.length ? (
        <div className="compare-tray">
          <span className="num" style={{ fontSize: 14 }}><b>{faDigits(picked.length)}</b> از ۳ محصول برای مقایسه</span>
          <button className="btn btn-primary btn-sm" disabled={picked.length < 2 || busy}
            onClick={() => send("این‌ها رو با هم مقایسه کن", block.items.filter((p) => picked.includes(p.id)))}>
            مقایسه کن
          </button>
        </div>
      ) : null}
    </div>
  );
}

function cell(row: CompareRow, v: string | number | null) {
  if (v == null || v === "") return <span className="muted">ثبت نشده</span>;
  if (row.type === "price") return <span className="num">{money(Number(v))}</span>;
  if (row.type === "number") return <span className="num">{faDigits(v)}</span>;
  return <>{v}</>;
}

function CompareTable({ block }: { block: Extract<Block, { kind: "compare" }> }) {
  const { openProduct } = useUI();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {block.heading ? <h3 className="section-title">{block.heading}</h3> : null}
      <div className="compare-wrap">
        <table className="compare">
          <thead>
            <tr>
              <th scope="col" style={{ width: 120 }}><span className="sr-only">ویژگی</span></th>
              {block.products.map((p) => (
                <th key={p.id} scope="col">
                  <div className="head-prod">
                    {p.image ? <img className="product-img" src={p.image} alt="" referrerPolicy="no-referrer" /> : null}
                    <button onClick={() => openProduct(p.id)}>{p.title}</button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {r.values.map((v, i) => <td key={i} className={r.best === i ? "is-best" : undefined}>{cell(r, v)}</td>)}
              </tr>
            ))}
            <tr>
              <th scope="row"><span className="sr-only">فروشنده‌ها</span></th>
              {block.products.map((p, i) => (
                <td key={p.id}><button className={`btn btn-sm ${i === 0 ? "btn-primary" : "btn-secondary"}`} onClick={() => openProduct(p.id)}>فروشنده‌ها</button></td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <span className="row-sub">▲ یعنی توی اون ردیف بهتره.</span>
    </div>
  );
}

function Summary({ block }: { block: Extract<Block, { kind: "summary" }> }) {
  const { openProduct } = useUI();
  const { send, busy } = useChat();
  return (
    <section className="summary" aria-label={block.heading ?? "جمع‌بندی"}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <img className="pixel" src="/brand/radish.png" width={24} height={24} alt="" />
        <b style={{ fontSize: 15 }}>{block.heading ?? "جمع‌بندی"}</b>
      </div>
      <ol>
        {block.items.map((p, i) => (
          <li key={p.id}>
            <span className={`rank badge ${i === 0 ? "badge-brand" : "badge-plain"}`}>{faDigits(i + 1)}</span>
            {p.image ? <img className="product-img" src={p.image} alt="" referrerPolicy="no-referrer" /> : <span />}
            <button style={{ border: 0, background: "none", padding: 0, textAlign: "start", cursor: "pointer", minWidth: 0 }} onClick={() => openProduct(p.id)}>
              <b style={{ display: "block", fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</b>
              {p.reason ? <span className="row-sub" style={{ fontSize: 13 }}>{p.reason}</span> : null}
            </button>
            <span className="num" style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>{p.price.min != null ? money(p.price.min) : "—"}</span>
          </li>
        ))}
      </ol>
      {block.next_steps.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: "1px solid var(--divider)" }}>
          <span className="row-sub">قدم بعدی</span>
          <div className="chips">
            {block.next_steps.map((s) => <button key={s} className="chip" disabled={busy} onClick={() => send(s)}>{s}</button>)}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** General answer to "what credit options are there": the five providers, their terms and how many shops take each.
    Product answers show installments at the bottom of each product card instead (BnplStrip). */
function PaymentOptions({ block }: { block: Extract<Block, { kind: "payment_options" }> }) {
  const { send, busy } = useChat();
  return (
    <section className="pay-options" aria-label="خرید قسطی و اعتباری">
      <b style={{ fontSize: 15, lineHeight: "24px" }}>خرید قسطی در فروشگاه‌های ترب</b>
      <div className="pay-list">
        {block.providers.map((p) => (
          <div key={p.name} className="pay-row">
            <PaymentLogo name={p.name} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <b style={{ fontSize: 14 }}>{p.name}</b>
                {p.online_only ? <span className="badge badge-plain">فقط آنلاین</span> : null}
              </span>
              <span className="row-sub">{p.terms} · <span className="num">در {faDigits(p.shops)} فروشگاه</span></span>
            </div>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => send(`کالاهایی که با ${p.name} قسطی می‌شه خرید رو نشونم بده`)}>
              کالاها
            </button>
          </div>
        ))}
      </div>
      <span className="row-sub" style={{ fontSize: 11 }}>مبالغ تخمینیه؛ سقف اعتبار و شرایط نهایی رو خود درگاه موقع پرداخت تعیین می‌کنه.</span>
    </section>
  );
}

function Stores({ block }: { block: Extract<Block, { kind: "stores" }> }) {
  const [open, setOpen] = useState(true);
  const p = block.product;
  return (
    <section className="stores" aria-label={`فروشگاه‌های حضوری ${p.title}`}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ display: "flex", alignItems: "center", gap: 10, border: 0, background: "none", padding: 0, cursor: "pointer", textAlign: "start" }}>
        <StoreIcon className="icon" />
        <b style={{ flex: 1, fontSize: 14 }}>{p.title} · حضوری</b>
        <ChevronDown className="icon-sm muted" />
      </button>
      {open ? <StoresView productId={p.id} productTitle={p.title} productImage={p.image} /> : null}
    </section>
  );
}
