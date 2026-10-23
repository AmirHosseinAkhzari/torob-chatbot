import { faDigits } from "@/lib/format";

/** Discount shown on every Snapp ride button. Set NEXT_PUBLIC_SNAPP_DISCOUNT_PERCENT=0 to hide it. */
export const SNAPP_DISCOUNT_PERCENT = Number(process.env.NEXT_PUBLIC_SNAPP_DISCOUNT_PERCENT ?? 10) || 0;

/** "Take Snapp to the shop" with Snapp's logo, the animated green border and the discount. */
export default function SnappButton({ shopName, size }: { shopName: string; size?: "sm" }) {
  const off = SNAPP_DISCOUNT_PERCENT > 0 ? `${faDigits(SNAPP_DISCOUNT_PERCENT)}٪ تخفیف` : null;
  return (
    <a
      className={`snapp-btn ${size ?? ""}`}
      href="https://app.snapp.taxi/"
      target="_blank"
      rel="noreferrer"
      aria-label={`سفر با اسنپ تا ${shopName}${off ? `، ${off}` : ""}`}
    >
      <img src="/brand/snapp.svg" alt="" />
      <span>تا فروشگاه</span>
      {off ? <span className="snapp-off">{off}</span> : null}
    </a>
  );
}
