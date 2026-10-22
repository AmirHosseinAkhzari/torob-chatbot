export type PriceSummary = { min: number | null; max: number | null; median: number | null; priced: number; contact: number };

export type ProductCard = {
  id: string;
  title: string;
  category?: string | null;
  brand?: string | null;
  image: string | null;
  images?: string[];
  shop_count: number;
  price: PriceSummary;
  specs: { key: string; value: string }[];
  stock?: boolean;
  lookalike?: boolean;
  reason?: string | null;
  caveat?: string | null;
  /** Present when the user is buying on credit: price and shop count then cover only shops that accept it. */
  bnpl?: Bnpl;
};

export type BnplSeller = {
  offer_id: string;
  shop: string;
  area: string | null;
  address: string | null;
  phone: string | null;
  price: number | null;
  open_now: boolean | null;
  today: string | null;
  lat: number | null;
  lng: number | null;
  distance_m: number | null;
  providers: string[];
};

export type Bnpl = {
  filter: string; // "any" or a provider name
  provider: string | null;
  terms: string | null;
  providers: string[];
  price: number | null;
  plan: { label: string; value: number }[] | null;
  seller_count: number;
  sellers: BnplSeller[];
  located: boolean;
};

export type Hours = { open_now: boolean | null; today: string | null; week: { day: string; key: string; text: string | null }[] };

export type Shop = {
  id: string;
  name: string;
  area: string | null;
  address: string | null;
  phones: string[];
  website: string | null;
  instagram: string | null;
  fast_delivery: boolean;
  payments: string[];
  hours: Hours;
  lat: number | null;
  lng: number | null;
};

export type Offer = {
  offer_id: string;
  price: number | null;
  price_note: string | null;
  outlier: boolean;
  updated_days: number | null;
  warranty: string | null;
  warranty_months: number | null;
  warranty_provider: string | null;
  seller_title: string | null;
  description: string | null;
  shop: Shop;
  distance_m?: number | null;
  /** The shop's last answer to a phone inquiry (استعلام دستگاه). */
  stock?: { status: "available" | "unavailable"; checked_at: string | null } | null;
};

export type InquiryStatus = "queued" | "preparing" | "ringing" | "in_call" | "available" | "unavailable" | "no_answer" | "failed";

export type Inquiry = {
  id: string;
  product_id: string;
  product_title: string;
  shop_id: string;
  shop_name: string;
  status: InquiryStatus;
  digit: string | null;
  reason: string | null;
  test_call: boolean;
  created_at: string;
  finished_at: string | null;
  url: string;
  sms: { sent: boolean; to: string; reason: string | null; text: string } | null;
};

export type ProductDetail = ProductCard & {
  specs_all: { section: string; key: string; value: string }[];
  offers: Offer[];
  fast_delivery_count: number;
  warranty_count: number;
};

export type StoresResponse = {
  product: Pick<ProductCard, "id" | "title" | "image" | "price" | "shop_count">;
  online_min: number | null;
  center: { lat: number; lng: number } | null;
  stores: Offer[];
  area: string | null;
  /** No shop inside the chosen neighborhood: these are the nearest ones to it. */
  area_fallback?: boolean;
  /** The shop Torob picks for the user: near, and priced close to the cheapest. Null when none qualifies. */
  pick?: StorePick | null;
};

export type StorePick = {
  offer_id: string;
  price_gap: number;
  price_gap_pct: number;
  cheapest_overall: boolean;
  distance_m: number | null;
  in_area: boolean;
  open_now: boolean | null;
  warranty: string | null;
  updated_days: number | null;
};

export type Area = { name: string; shops: number; lat: number; lng: number };

export type Place = { name: string; kind: "area" | "city"; covered: boolean; lat?: number; lng?: number } | null;

export type LiveResult = { query: string; place: Place; products: ProductCard[] };

export type CompareRow = { label: string; type: "price" | "number" | "text"; values: (string | number | null)[]; best: number | null };

export type Block =
  | { kind: "understood"; conditions: { label: string; assumed: boolean }[] }
  | { kind: "quick_reply"; question: string; options: string[]; multi: boolean }
  | { kind: "products"; style: "pick" | "row"; heading?: string | null; items: ProductCard[] }
  | { kind: "compare"; heading?: string | null; products: Pick<ProductCard, "id" | "title" | "image" | "price" | "shop_count">[]; rows: CompareRow[] }
  | { kind: "summary"; heading?: string | null; items: ProductCard[]; next_steps: string[] }
  | { kind: "stores"; product: ProductCard }
  | { kind: "payment_options"; product: Pick<ProductCard, "id" | "title" | "image" | "price" | "shop_count"> | null; providers: PaymentProvider[] };

export type PaymentProvider = {
  name: string;
  terms: string;
  shops: number;
  online_only: boolean;
  plan: { label: string; value: number }[] | null;
  plan_price: number | null;
  sellers: { offer_id: string; shop: string; area: string | null; price: number | null; fast_delivery: boolean }[];
  seller_count: number;
};

export type Status = { id: number; state: "running" | "done"; text: string; count?: number };
export type Source = { id: string; title: string; image: string | null; price: number | null };

export type Part = { type: "text"; text: string } | { type: "block"; block: Block };

export type Message =
  | { id: string; role: "user"; text: string; attachments: ProductCard[] }
  | {
      id: string;
      role: "assistant";
      parts: Part[];
      status: Status[];
      sources: { searches: number; items: Source[] } | null;
      memo: string | null;
      error: string | null;
      done: boolean;
    };

export type Conversation = { id: string; title: string; createdAt: number; updatedAt: number; messages: Message[] };

export type UserLocation = { lat?: number; lng?: number; area?: string; label: string };
