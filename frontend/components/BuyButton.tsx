import Link from "next/link";
import { distance, money } from "@/lib/format";

/** What makes this shop the one to buy from. */
export type BuyTags = { nearest?: boolean; distanceM?: number | null; cheapest?: boolean };

type Props = {
  shop: string;
  price: number | null;
  tags?: BuyTags;
  /** Red for the recommended shop, white for the others. */
  variant?: "primary" | "secondary";
  /** In-app link (Next.js), external link (new tab), or a button. */
  href?: string;
  external?: boolean;
  /** Runs on press (for links too: e.g. to note where the user chose to buy). */
  onClick?: () => void;
  /** Shown instead of a tag when there is none (e.g. «سایت فروشگاه», a distance). */
  note?: string | null;
};

const PinIcon = ({ s }: { s: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true" className="buy-tag-icon">
    <path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" /><circle cx="12" cy="10" r="2" />
  </svg>
);
const TagIcon = ({ s }: { s: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true" className="buy-tag-icon">
    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" />
  </svg>
);

/** «خرید از [فروشگاه]» with the price under it and why it is the one: نزدیک‌ترین, ارزان‌ترین, or both. */
export default function BuyButton({ shop, price, tags, variant = "primary", href, external, onClick, note }: Props) {
  const both = !!tags?.nearest && !!tags?.cheapest;
  const near = tags?.nearest ? `نزدیک‌ترین${!both && tags.distanceM != null ? ` · ${distance(tags.distanceM)}` : ""}` : null;
  const body = (
    <>
      <span className="buy-text">
        <span className="buy-title">خرید از {shop}</span>
        <span className="buy-price num">{price != null ? `${money(price)} تومان` : "قیمت: تماس بگیرید"}</span>
      </span>
      {both ? (
        <span className="buy-tags is-stacked">
          <span className="buy-tag is-near"><PinIcon s={14} />نزدیک‌ترین</span>
          <span className="buy-tag is-cheap"><TagIcon s={14} />ارزان‌ترین</span>
        </span>
      ) : near ? (
        <span className="buy-tag is-near"><PinIcon s={16} />{near}</span>
      ) : tags?.cheapest ? (
        <span className="buy-tag is-cheap"><TagIcon s={16} />ارزان‌ترین</span>
      ) : note ? (
        <span className="buy-note">{note}</span>
      ) : null}
    </>
  );
  const cls = `buy-btn ${variant === "primary" ? "is-primary" : "is-secondary"}`;
  if (href && external) return <a className={cls} href={href} target="_blank" rel="noreferrer" onClick={onClick}>{body}</a>;
  if (href && !href.startsWith("/")) return <a className={cls} href={href} onClick={onClick}>{body}</a>; // geo:, tel:
  if (href) return <Link className={cls} href={href} onClick={onClick}>{body}</Link>;
  return <button type="button" className={cls} onClick={onClick}>{body}</button>;
}
