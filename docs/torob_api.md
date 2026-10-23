# Torob API — reverse-engineered reference

How torob.com talks to its backend, worked out from the website's JS bundles and tested live on **2026-10-21**.
Nothing here is officially documented, so it can change without notice.

- **Base URL:** `https://api.torob.com`
- **Auth:** none for product/search/shop reads. User features (likes, watch list, chatbot, complaints) need a logged-in session cookie.
- **Format:** JSON. Most paths end with a trailing `/`.
- **Website:** Next.js (`assets.torob.com/nextjs/main/desktop/<build>/`). Pages are rendered on the server, so the browser mostly doesn't call the API directly. The endpoints below come from the bundles (`${api_name}/v4/...`).

## Quick start

```bash
# Search
curl -s 'https://api.torob.com/v4/base-product/search/?q=گوشی سامسونگ&page=0&size=24&sort=popularity'

# Product page (prk = random_key from a search result)
curl -s 'https://api.torob.com/v4/base-product/details/?prk=6564b4c3-5d64-4503-8586-8a7f7af61d41'

# Autocomplete
curl -s 'https://api.torob.com/suggestion2/?q=ایفون'
```

```python
import requests

API = "https://api.torob.com"
s = requests.Session()
s.headers["User-Agent"] = "Mozilla/5.0"

def search(q, page=0, size=24, sort="popularity", **filters):
    r = s.get(f"{API}/v4/base-product/search/",
              params={"q": q, "page": page, "size": size, "sort": sort, **filters})
    r.raise_for_status()
    return r.json()

def product(prk):
    return s.get(f"{API}/v4/base-product/details/", params={"prk": prk}).json()

res = search("گوشی سامسونگ", category=94, price__gt=20_000_000, price__lt=30_000_000, sort="price")
for p in res["results"]:
    print(p["random_key"], p["price"], p["name1"])
```

## Conventions

| Thing | Meaning |
|---|---|
| `prk` / `random_key` | Product id (UUID). A **base product** is the merged product; each seller's listing also has its own `prk`. |
| `price` | Integer, **Toman**. `0` or missing = no price. |
| `price_text`, `shop_text`, `last_price_change_date` | Display strings in Persian with Persian digits (`۱۰۱٫۰۰۰٫۰۰۰ تومان`, `۳ ساعت پیش`). Use the integer fields for logic. |
| `name1` / `name2` | Persian title / English (or secondary) title. For seller rows, `name2` is often the seller's warranty/notes text. |
| `page` | **0-based**. Responses include a ready-made `next` URL; follow it rather than building your own. |
| `size` | Page size (site uses 24). |
| `source` | Client tag, e.g. `next_desktop`, `next_mobile`. Optional. |
| `suid`, `search_id`, `init_suid`, `rank`, `ad`, `discover_method` | Tracking params that appear in `more_info_url` links. Not required. |
| Cookies `search_session`, `deliver_city` | Set by the API. `deliver_city=<city_id>` personalizes results by city. Not required. |
| Errors | `{"error": {"message": "...", "code": "not_authenticated"}}` with 403. |

Images: `https://image.torob.com/base/images/...jpg`. Shop thumbnails accept a size suffix like `..._/300x300.webp`.

## robots.txt (api.torob.com)

```
User-agent: *
Disallow: /
Allow: /v4/base-product/search
Allow: /v4/base-product/similar-base-product
Allow: /v4/base-product/details
Allow: /v4/internet-shop/list
Allow: /v4/special-offers
Allow: /v4/internet-shop/special-offers
```

Only these paths are open to crawlers. Everything else works without auth but is disallowed for bots. `torob.com/robots.txt` also disallows `/search/`. No rate-limit headers came back and 12 quick requests all returned 200, but keep traffic low and cache responses.

---

## 1. Search

### `GET /v4/base-product/search/`

The main product search. It also powers category browsing (pass `category` without `q`).

| Param | Example | Notes |
|---|---|---|
| `q` | `گوشی سامسونگ` | Free text. Optional when `category` is given. |
| `page` | `0` | 0-based. |
| `size` | `24` | Page 0 usually returns **size + ~2** because ads (`is_adv: true`) are added. |
| `sort` | `popularity` (default, also `""`), `price`, `-price`, `-date`, `-supply` | Popular / cheapest / most expensive / newest / most sellers. |
| `category` | `94` | Category id (`cat_id`). |
| `brand` | `5` | Brand id (from `attributes[type=brand].items[].id`). |
| `price__gt`, `price__lt` | `20000000` | Price range in Toman. |
| `available` | `true` | "In stock only" toggle. |
| `stock_status` | `new` / `stock` | New vs used. |
| `only_offers` | `true` | Discounted only. |
| `shop_type` | `offline` | Products with an in-person seller. |
| `torobpay` | `true` | Installment (TorobPay) only. |
| `cities`, `province` | ids | City/province filter. |

Tested: `sort`, `category`, `brand`, the price range and paging all change results. **`count` is capped at 1200**: a broad query always reports 1200, while a narrow one (price range) returns the exact number (e.g. 163). `available` and `shop_type` were accepted, but the effect wasn't clear in a quick test.

Response (trimmed):

```jsonc
{
  "count": 1200,
  "min_price": 600.0, "max_price": 25102672000.0,
  "next": "https://api.torob.com/v4/base-product/search/?page=1&...",
  "previous": null,
  "spellcheck": {"is_spellchecked": false, "initial_query": "گوشی سامسونگ", "corrected_query": ""},
  "categories": [{"title": "گوشی موبایل", "cat_id": 94, "cat_slug": "گوشی-موبایل-mobile", ...}],
  "parent_categories": [],
  "attributes": [{"title": "انتخاب برند", "slug": "brand", "type": "brand",
                  "items": [{"id": 5, "slug": "samsung-...", "name1": "سامسونگ", "name2": "Samsung"}]}],
  "filters1": [ /* price range, brand, ... */ ],
  "filters2": [ /* torobpay, shop_type, available, sort options */ ],
  "related_queries": null,
  "results": [ /* ProductCard, see below */ ]
}
```

**ProductCard** (the item shape used in search, similar products, shop listings and trends):

```jsonc
{
  "random_key": "6564b4c3-5d64-4503-8586-8a7f7af61d41",   // = prk
  "name1": "گوشی سامسونگ A27 5G | حافظه 256 رم 8 گیگابایت",
  "name2": "Samsung Galaxy A27 5G 256/8 GB",
  "price": 101000000,                 // cheapest price, Toman
  "price_prefix": "cheapest",
  "price_text": "از ۱۰۱٫۰۰۰٫۰۰۰ تومان",
  "shop_text": "در ۸۹ فروشگاه",       // number of shops
  "stock_status": "",
  "is_adv": true,                     // sponsored result
  "image_url": "https://image.torob.com/base/images/5m/f9/5mf9Qk_bW9uIDdIF.jpg",
  "media_urls": [{"type": "image", "url": "..."}],
  "more_info_url": "https://api.torob.com/v4/base-product/details/?...&prk=...",
  "similar_api":   "https://api.torob.com/v4/base-product/similar-base-product/?prk=...&limit=24",
  "media_search":  "https://api.torob.com/v4/base-product/search-by-image/?prk=...",
  "web_client_absolute_url": "/p/<prk>/<slug>/",   // https://torob.com + this
  "badges": [], "discount_info": [], "has_wiki": false, "is_authentic": false
}
```

### `GET /suggestion2/?q=<text>&source=next_desktop`

Autocomplete (note: no `/v4`).

```json
[{"text": "ایفون", "is_history": false}, {"text": "ایفون 17", "is_history": false}]
```

### `GET /v4/search-trends/`

Trending queries, each with a sample product: `[{"query": "طلا زنانه", "category_id": 127, "partial_info": ProductCard}, ...]`.

### `GET /v4/base-product/search-by-image/?prk=<prk>&size=24`

Visually similar products. Returns `{"results": [ProductCard...]}`. Uploading your own image goes through `POST /v4/base-product/search-image-upload/` (multipart, not tested).

---

## 2. Product

### `GET /v4/base-product/details/?prk=<prk>`

The full product page (~75 KB). Contains everything on top of the ProductCard fields:

| Field | Content |
|---|---|
| `min_price`, `max_price` | Price range across sellers (Toman). |
| `products_info` | **Online sellers**: `{title, count, result: [OnlineOffer...], sellers_url}`. In testing, `result` held all 179 sellers. |
| `products_in_store_info` | **Physical stores**: `{count, result: [StoreOffer...], sellers_url, map_sellers_api_url}`. |
| `structural_specs` | `{"headers": [{"header": "مشخصات کلی", "specs": {"وزن (گرم)": "200, ,", ...}}]}`. Values contain stray `", ,"` fragments; clean them before use. |
| `key_specs` | `[{"header": "مشخصات کلیدی", "items": [{"key": "حافظه داخلی", "value": ["256 گیگابایت"]}]}]` |
| `variants` | Other storage/RAM/color variants: `[{"title": "حافظه و رم", "items": [ProductCard...]}]`. |
| `breadcrumbs` | Category path: `[{"id": 175, "title": "موبایل و کالای دیجیتال", "cat_id": 175, "url": "/browse/175/..."}, ...]`. A final crumb with `/b/<brand_id>/` gives the brand. |
| `torob_category` | Leaf category id. |
| `filters` | Seller filters with the cheapest price each: Torob warranty, installments, etc. |
| `buy_box_*`, `new_buy_box_*` | The "buy from cheapest seller" box (shop name, price, link). |
| `image_urls`, `media_urls` | Gallery. |
| `similar_products`, `similar_listing` | URLs for related endpoints. |
| `availability`, `is_confirmed` | Booleans. |

**OnlineOffer** (`products_info.result[]`):

```jsonc
{
  "prk": "75f814b8-...",            // this seller's listing id
  "shop_id": 20456, "shop_name": "جی اس ام", "shop_name2": "تهران",   // shop_name2 = city
  "name1": "<seller's own product title>",
  "name2": "۱۸ ماه گارانتی شرکتی + ...",   // seller notes / warranty
  "price": 111099000, "price_text": "۱۱۱٫۰۹۹٫۰۰۰ تومان", "price_text_striked": "",
  "is_price_unreliable": false, "availability": true,
  "last_price_change_date": "۳ ساعت پیش",
  "shop_score": 5,
  "score_info": {"score": 5.0, "score_text": "★۵ (۲ سال در ترب)",
                 "complaints_info": {"summary": ["حدود ۳۰۰ تا ۵۰۰ سفارش در ۹۰ روز اخیر ..."]}},
  "more_info": {"same_day_delivery": "...", "shipping_types": ["پیک", "..."], "delivery_info": "...",
                "free_shipping": null, "payment_on_delivery": null},
  "guarantee_info": {"status": "disabled"},
  "installment": null, "is_adv": true,
  "page_url": "https://api.torob.com/v4/product-page/redirect/?...&prk=..."   // click-out to the shop (logged as a click)
}
```

**StoreOffer** (`products_in_store_info.result[]`, physical shops):

```jsonc
{
  "prk": "fffd3891-...", "shop_id": 396527, "shop_name": "امیر فون میاندوآب", "shop_name2": "میاندوآب",
  "address": "خیابان شهدا غربی، بین...",
  "price": 91800000, "price_string": "۹۱٫۸۰۰٫۰۰۰ تومان",
  "is_open": true,
  "working_hours": {"type": "schedule", "title": {"status": "باز", "text": "تا ۲۳:۳۰"},
                    "schedule": [{"title": "شنبه", "text": "۰۸:۰۰ - ۲۳:۳۰", "is_today": false}, ...]},
  "supports_fast_delivery": true,
  "image_info": {"thumbnail_image_url": "...", "shop_images_api_url": "...", "count": 1},
  "page_url": "https://api.torob.com/v4/product-in-store/contact-info/?...&prk=..."   // phone reveal (logged)
}
```

### `GET /v4/base-product/sellers/?prk=<prk>&list_type=products_info|products_in_store_info`

The seller list on its own: `{"count": 179, "results": [OnlineOffer...]}`. Use the `sellers_url` from the details response; it includes a `seed` that keeps the order stable.

### `GET /v4/base-product/map/sellers/?prk=<prk>`

Physical sellers for the map view: `{"count", "name1", "name2", "image_url", "result": [StoreOffer + "location": {"lat", "lon"}]}`.

### `GET /v4/base-product/price-chart/?prk=<prk>&v=2[&range=...]`

Daily lowest and median price.

```json
{"lines": {"lowest": {"label": "کمترین قیمت"}, "median": {"label": "میانگین قیمت"}},
 "points": [{"date": "2026-07-24", "lowest": 77519000, "median": 87398850}, ...]}
```

### `GET /v4/base-product/price-history/?prk=<prk>&page=0&size=10`

Per-seller price change events (paginated, `count` can be in the thousands).

```json
{"count": 8513, "next": "...", "results": [
  {"title": "افزایش قیمت در نوتاش تل", "description": "از ۱۰۷٫۰۰۰٫۰۰۰ تومان به ۱۱۱٫۰۰۰٫۰۰۰ تومان",
   "icon": ".../trending_up.png", "timeago": "۴ دقیقه پیش"}]}
```

Other product endpoints:

| Endpoint | Returns |
|---|---|
| `GET /v4/base-product/similar-base-product/?prk=<prk>&limit=24` | `{"results": [ProductCard...]}` |
| `GET /v4/base-product/last-modified-date/?prk=<prk>` | `{"last_modified_date": "2026-10-21T16:39:37.885368+00:00"}`: cheap way to check whether to re-fetch. |
| `GET /v4/base-product/similar-listings/?prk=<prk>` | Related classified ads `{"results": [], "title": "آگهی‌های مرتبط"}` |
| `GET /v4/base-product/member/images/?prk=&base_rk=&shop_id=&member_type=product_in_store` | Store photos (URL comes from `image_info.shop_images_api_url`). |
| `GET /v4/base-product/price-change-info/?random_key=` | Staff only (302 → admin login). |

---

## 3. Online shops

| Endpoint | Notes |
|---|---|
| `GET /v4/internet-shop/list/?shop_type=all&size=20&page=0` | All shops (`count` ≈ 324k). Item: `{id, name, domain, shop_logo, shop_type, city, is_marketplace, upvotes, downvotes, score_percentile, guarantee_info, has_active_torobpay}`. Also takes `ids=1,2,3`. |
| `GET /v4/internet-shop/details/?id=<shop_id>` | Shop profile: `name`, `domain`, `city`, `province`, `address`, `phone`, `shop_type`, `date_added`, `active_time`, `enamad_level` (e-trust badge), `licenses`, `payment_info.items[]`, `delivery_info.items[]`, `score_info[]`, `additional_infos[]` (about / payment / shipping / returns), `shop_score`, `upvotes`/`downvotes`. |
| `GET /v4/internet-shop/base-product/list/?shop_id=<id>&page=0` | A shop's products. Same response shape and filters as search (`q`, `category`, `price__gt/lt`, `stock_status`, `only_offers`, `available`, `sort`). |
| `GET /v4/internet-shop/all-details/?id=` | 403 without permission. |

> `internet-shop/details` also returns what look like internal fields: `click_price`, `credit`, `daily_budget`, `billing_info`, `referral_code`, `users` (list of user ids), `search_vector`. Don't depend on them. They may be removed, and they may be worth reporting to Torob.

---

## 4. Local / physical stores ("VLP")

Torob's "near me" product. Uses `city_id` (see §6) or `lat`/`lon` plus map bounds.

| Endpoint | Notes |
|---|---|
| `GET /v4/vlp/search/?q=<text>&city_id=392` | `{"title": "۱۲ نتیجه در این محدوده", "results": [{"shop_type", "details": {id, name, address, full_address, location_label, working_hours, distance, shop_profile_url, shop_profile_search_url, ...}}], "next"}` |
| `GET /v4/vlp/search/clusters/?...` | Map clusters. |
| `GET /v4/vlp/search/related-queries/?q=&city_id=&...bounds` | `{"suggestions": [...]}` |
| `GET /v4/vlp/products/?...`, `GET /v4/vlp/product/details/?...`, `/v4/vlp/product/sellers/`, `/v4/vlp/product/similar/` | Product views scoped to local stores. |
| `GET /v4/vlp/shop/details/?id=<id>&city_id=392` | `{id, name, shop_label, address, domain, active_time, phones: [{number, type, log_url}], image_info, supports_fast_delivery, ...}` |
| `GET /v4/vlp/shop/products/?id=<id>&city_id=392&sort=popularity[&q=]` | `{"results": [{"type": "default", "context": {name1, price_text, prk, ...}}]}` |
| `GET /v4/vlp/business-types/` and `/featured/` | `[{"title": "سوپرمارکت", "value": "supermarket", "icon_url": "..."}]` |

---

## 5. Deals

| Endpoint | Notes |
|---|---|
| `GET /v4/special-offers/?page=0&size=10&flavor_name=default` | Home-page deal rows: `{"results": [{"type": 0 \| 4, "data": [{title, description, api_url, action, action_params, ...}], "base_products": [...]}], "next"}`. |
| `GET /v4/special-offers/details/?prk=<row id>&...` | One row's products (use `api_url` from above). |

---

## 6. Locations

| Endpoint | Example response |
|---|---|
| `GET /v4/province/list/?size=200` | `{"count": 31, "results": [{"id": 8, "name": "تهران"}, ...]}` |
| `GET /v4/city/list/?size=20&search=تهران[&province=8]` | `{"count": 1, "results": [{"id": 392, "name": "تهران"}]}` |
| `GET /v4/city/most-visited/list/?count=8` | `[{"id": 392, "name": "تهران"}, {"id": 468, "name": "مشهد"}, ...]` |
| `GET /v4/geocode/city-reverse/?lat=35.7&lon=51.4` | `{"id": 392, "name": "تهران"}` |
| `GET /v4/vlp/geocode/reverse/?lat=&lon=&provider=torob_geo_reverse` | Address from coordinates. |
| `GET /v4/vlp/geocode/search/?address=&lat=&lon=` | Coordinates from address. |
| `GET /v4/vlp/geocode/query-location/?query=&lat=&lon=` | Location hint from a search query. |
| `GET /v4/vlp/geocode/city_coordinates/?city=<id>` | City center. |

---

## 7. Endpoints that need login (not tested beyond the 403)

Found in the bundles. All return `403 not_authenticated` without a session. Writes use form or JSON POST.

**Account:** `user/details/`, `user/logout/`, `user/phone/send-pin/?phone_number=`, `user/phone/send-voice-otp/`, `user/phone/verify/?phone_number=&pin=`, `user/email/send-pin/`, `user/email/verify/`, `bale/login/?init_data=`, `telegram/login/?init_data=`

**Lists:** `user/like/{create,delete,list}/`, `user/watch/{create,delete,list,details}/` (price alerts), `user/business-like/{create,delete,list}/`, `user/history/{create,list,delete-all}/`, `user/profile/notifications/?since=`, `user/firebase/create/`, `user/shop/search/?q=`

**Torob's own buying-assistant chatbot:** `POST chatbot/conversation/create-update/` (form: `base_product_random_key`, `message`, optional `lat`/`lon`), `GET chatbot/conversation/details/?random_key=`, `POST chatbot/message-feedback/` (`message_random_key`, `liked`), `POST chatbot/seller-report/`, `POST chatbot/event/log/?session_id=`, `GET chatbot-v2/billing/scope/`. Shops have a `show_in_buying_assistant_chatbot` flag. This feature is close to what this project is building.

**Complaints / order tracking:** `complaint/{subjects,list,register,shop-orders,user-clicks,order-tracking/candidates}/`, `complaint/messages/{list,create,options}/?complaint_id=`

**Reports / feedback:** `price-report/{list,create,accuracy}/`, `report-options/<type>`, `price-survey-result/create/`, `offline-price-survey-result/create/`, `base-product/is-survey-enabled/`, `question/create/`, `feedback/create/`, `support/faqs/feedback/`

**TorobPay / installments:** `torobpay/`, `torobpay/debt-summary-v2/`, `user/installment/status/?provider_name=`, `user/installment/tara/redirect/`

**Seller panel / staff (outside `/v4`):** `/panel/...`, `/shop-panel/...`, `/eval/...`, `/ticketing/...`, `/torob-admin/`

**Redirect/tracking links:** `product-page/redirect/?prk=` (click-out to the shop) and `product-in-store/contact-info/?prk=` (reveals a store's phone). Both log a click that shops pay for, so a bot shouldn't call them automatically. Link the user to them instead.

---

## Mapping to this project's dataset

| Neo4j (this repo) | Torob API |
|---|---|
| `Product.product_id` / `Shop.shop_id` | **No direct link.** The dataset uses anonymized ids (`product_…`, `shop_…`), while Torob uses UUID `prk`s and integer shop ids. Match by title search (`search` → `name1`/`name2`) or by shop name + location. |
| `Product.min_price_toman` / `max_price_toman` | `details.min_price` / `max_price` |
| `Product.specs_json` | `details.structural_specs` + `key_specs` |
| `Product.category_name` | `details.breadcrumbs[-1]` / `torob_category` |
| `Offer` | `products_info.result[]` (online) and `products_in_store_info.result[]` (in store) |
| `Offer.warranty*` | Seller's `name2` text, `guarantee_info` |
| `Offer.last_price_changed_at` | `last_price_change_date` (relative Persian text only) |
| `Shop` (location, phones, hours) | `map/sellers` (`location`), `vlp/shop/details` (`phones`, address), StoreOffer `working_hours` |

Useful live lookups for the chatbot: current cheapest price and seller count (`details`), price trend (`price-chart`), stores open now (`working_hours.title.status`), and autocomplete/spell correction (`suggestion2`, `spellcheck.corrected_query`).

## Caveats

- Unofficial and undocumented. Field names, required params and CORS (`access-control-allow-origin: https://torob.com`) can change at any time. CORS means browser calls from another origin fail, so call the API from a backend.
- Results are personalized and contain ads (`is_adv`). Seller order is randomized by `seed`.
- Respect `robots.txt` and Torob's terms. Cache results and keep request rates low. Don't call click-out or contact-info links automatically.
