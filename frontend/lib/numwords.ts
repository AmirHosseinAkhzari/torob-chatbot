/** A price in Persian words, to check a typed price: 450000 -> «چهارصد و پنجاه هزار تومان» (backend/app/numwords.py). */
const ONES = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"];
const TEENS = ["ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"];
const TENS = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
const HUNDREDS = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
const SCALES = ["", "هزار", "میلیون", "میلیارد", "تریلیون"];

function underThousand(n: number) {
  const parts: string[] = [];
  const h = Math.floor(n / 100), rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    if (Math.floor(rest / 10)) parts.push(TENS[Math.floor(rest / 10)]);
    if (rest % 10) parts.push(ONES[rest % 10]);
  }
  return parts.join(" و ");
}

export function toWords(n: number): string {
  if (!n) return "صفر";
  const groups: string[] = [];
  for (let i = 0; n > 0 && i < SCALES.length; i++) {
    const g = n % 1000;
    n = Math.floor(n / 1000);
    if (g) groups.push(`${i === 1 && g === 1 ? "" : underThousand(g)} ${SCALES[i]}`.trim());
  }
  return groups.reverse().join(" و ");
}

export const toman = (n: number) => `${toWords(n)} تومان`;
