import { CardIcon } from "./icons";

const LOGOS: Record<string, { src: string; cls?: string }> = {
  "ترب‌پی": { src: "/brand/pay/torobpay.png" },
  "اسنپ‌پی": { src: "/brand/pay/snapppay.png", cls: "is-snapppay" },
  "دیجی پی": { src: "/brand/pay/digipay.png" },
  "تارا": { src: "/brand/pay/tara.png" },
  "ازکی‌وام": { src: "/brand/pay/azkivam.svg", cls: "is-azki" },
};

export const BNPL_PROVIDERS = Object.keys(LOGOS);

/** True when a shop's payment list matches an installment filter ("any" = any of the five). */
export const acceptsPay = (payments: string[], pay: string) =>
  pay === "any" ? payments.some((x) => BNPL_PROVIDERS.includes(x)) : payments.includes(pay);

/** Installment terms as Torob shows them on product pages. */
export const PAYMENT_TERMS: Record<string, string> = {
  "ترب‌پی": "پرداخت قسطی بخشی از مبلغ در ۴ قسط",
  "اسنپ‌پی": "الان بخر، بعدا پرداخت کن: ۴ قسط",
  "دیجی پی": "۱۲ قسط تا سقف ۱۰۰ میلیون، سود سالانه ۲۳٪",
  "تارا": "پرداخت قسطی بخشی از مبلغ در ۲ قسط",
  "ازکی‌وام": "تا ۱۰۰ میلیون، ۱۸ قسط، سود سالانه ۲۲٪",
};

export function PaymentLogo({ name, small }: { name: string; small?: boolean }) {
  const logo = LOGOS[name];
  if (name === "card") {
    return (
      <span className={`pay-logo ${small ? "sm" : ""}`} style={{ background: "var(--surface-sunken)", color: "var(--ink)" }} title="پرداخت با کارت">
        <CardIcon className="icon-sm" />
      </span>
    );
  }
  if (!logo) {
    return (
      <span className={`pay-logo is-text ${small ? "sm" : ""}`} title={`اقساط خود فروشگاه: ${name}`}>
        قسطی
      </span>
    );
  }
  return (
    <span className={`pay-logo ${logo.cls ?? ""} ${small ? "sm" : ""}`} title={name}>
      <img src={logo.src} alt={name} />
    </span>
  );
}

export function PaymentChips({ payments, inStore }: { payments: string[]; inStore?: boolean }) {
  return (
    <div className="chips" style={{ gap: 6 }}>
      <span className="pay-chip">
        <PaymentLogo name="card" small />
        {inStore ? "کارتخوان" : "پرداخت کامل"}
      </span>
      {payments.map((p) => (
        <span key={p} className="pay-chip" title={PAYMENT_TERMS[p] ?? "اقساط خود فروشگاه"}>
          <PaymentLogo name={p} small />
          {LOGOS[p] ? p : "اقساط فروشگاه"}
        </span>
      ))}
    </div>
  );
}
