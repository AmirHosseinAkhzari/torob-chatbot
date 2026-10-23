---
title: Features
tags: [features, chat, generative-ui, stores, map, bnpl, login, history, panels, admin]
summary: Every user-facing feature with the files that implement it.
code: [backend/app/agent.py, backend/app/repo.py, frontend/components/chat/Blocks.tsx, frontend/components/stores/, frontend/components/panel/]
---

# Features

## Chat with generative UI
`backend/app/agent.py`, `frontend/components/chat/`

- Answers in short colloquial Persian; products always appear as components, never as text-only lists.
- Block kinds: `understood` (editable chips for assumptions), `quick_reply` (tappable options when the request
  is vague), `location_request`, `products` (style `pick` with reason and caveat, or `row`), `compare`,
  `summary`, `stores`, `payment_options`.
- Live search progress (`status` events) shows what the agent is looking up.
- Users can attach products to a message; the agent starts from their details.
- Single-seller products are marked so the answer does not imply a price comparison that does not exist.

## Persian search
`backend/app/text.py`, `backend/app/repo.py`

- Full-text indexes with a Persian analyzer; queries match both Persian and Latin digits (`۱۳` / `13`).
- Every word is required except filler words; the last word can be a prefix.
- Accessories (case, glass, charger…) are kept from outranking the product itself.
- Used (`استوک`, `کارکرده`, `دست دوم`, `اوپن باکس`) and lookalike (`طرح`) titles are flagged.
- Tehran neighborhoods and city names in a query are recognized as places, not product words.

## In-person stores and store pick
`backend/app/repo.py` (`stores_for_product`, `recommend`, `pick_store`), `frontend/components/stores/`

- Map of shops selling a product (Leaflet + OpenStreetMap), by GPS distance or neighborhood.
- Recommendation from trusted prices only: nearest, cheapest within 3 km / same neighborhood, or cheapest in
  Tehran. The nearest stays first unless a nearby shop is more than 5% cheaper.
- Store pick card: reasons (distance, price gap, open now, warranty, price age), directions, Snapp button on
  phones, call and address on desktop. Nothing is picked when no shop qualifies.
- Opening hours and "open now" from declared hours only.
- Each shop shows when its price needs confirming; see [store-inquiry.md](store-inquiry.md).

## Buy now, pay later (فروش اعتباری)
`backend/app/repo.py` (`PROVIDERS`, `bnpl_for`, `apply_bnpl`), `frontend/components/chat/BnplStrip.tsx`

- Recognizes credit wording and provider names (ترب‌پی, اسنپ‌پی, دیجی پی, تارا, ازکی‌وام).
- Search, prices and shop counts cover only shops that accept the provider.
- Each card shows an estimated plan and the nearest accepting shop with call / Snapp / map.
- Provider terms are hard-coded estimates; there is no checkout.

## Accounts and history
`backend/app/auth.py`, `backend/app/history.py`, `frontend/app/login/`

- Login with a 5-digit SMS code; bearer tokens; codes and tokens stored as sha256 hashes.
- Conversations saved per account and listed in the sidebar; user settings saved on the account.

## Store panel (پنل فروشگاه)
`frontend/app/store/`, `backend/app/verify.py`, `backend/app/catalog.py`

- Staff see their shop's dashboard and incoming verification requests, claim one, and answer with today's
  price and stock. Watchers get the answer by SMS.
- Staff edit their own offers' price and stock; every change is logged.

## Admin panel (پنل مدیریت)
`frontend/app/admin/`, `backend/app/admin.py`

- Overview and totals of store activity; searchable shop list.
- Add or edit shops (hours form, map pin), manage staff phones.
- Edit prices and stock across shops; CSV import with preview before apply.
- Change history (`data_changes`): who changed what, from which source (store, admin, import, phone check).

## Store insights
`backend/app/insights.py`

Records why each shop was or was not recommended (short reason codes) and which shop the user actually chose,
for later analysis. Not shown in the UI yet.
