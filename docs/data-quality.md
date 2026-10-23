---
title: Data quality and trust rules
tags: [data, pricing, trust, recommendation, hours, outliers, dataset]
summary: The dataset's problems and the exact rules the code uses to clean prices, trust hours and decide which shop to recommend.
code: [backend/app/pricing.py, backend/app/hours.py, backend/app/repo.py, backend/app/text.py, scripts/prepare_import.py]
---

# Data quality and trust rules

| Dataset problem | Handling | Code |
|---|---|---|
| Prices under 1,000 toman are "call for price" placeholders | Treated as no price; shown as "contact", never quoted | `pricing.valid_prices` |
| Some offers are far off the rest | With 3+ offers, prices more than 3× from the median are flagged and kept out of the "from" price | `pricing.summarize`, `pricing.is_outlier` |
| Many prices are months old | Price age in days is shown; older than 90 days is not trusted for a recommendation | `repo.FRESH_DAYS`, `repo.reliable` |
| Placeholder hours like 08:00–08:00 | Only days marked declared or closed are used; others are unknown | `hours.parse` |
| Stock is not in the dataset | Unknown until a shop answers; an answer older than 7 days is uncertain again | `verify.needs` |
| Used and lookalike items mixed with originals | `استوک` / `کارکرده` / `طرح` titles flagged | `text.is_stock`, `text.is_lookalike` |
| English model names in Persian titles; mixed digit forms | Queries try both digit forms; agent searches with brand + model | `text.fulltext_query` |
| ~75% of products have no brand | Search relies on title/model full-text, not brand | `repo.search_products` |
| All shops are in Tehran | Location picker offers 30 Tehran neighborhoods; other cities marked "soon" | `repo.areas` |

## Which offer is "reliable"

`repo.reliable`: has a valid price, is not an outlier, is 90 days old or newer, and was not reported
unavailable by the shop. Only reliable offers can be recommended.

## Recommendation (`repo.recommend`)

- Without location: cheapest reliable offer in Tehran.
- With location: compares the nearest open shop with the cheapest within 3 km (or the user's neighborhood).
  The nearest wins unless the nearby one is more than 5% cheaper. If nothing is nearby, the nearest is used
  only when it is within 5% of the best Tehran price.
- Ties prefer shops whose stock was confirmed.
- The response also lists how many offers were left out as unreliable; `repo.left_out` gives each one's reason.

## Store pick card (`repo.pick_store`)

A shop is highlighted only if it is within 4 km (or in the user's neighborhood) and at most 7% above the
cheapest price on Torob (`PICK_MAX_DISTANCE_M`, `PICK_MAX_PRICE_GAP`).

## Price changes

Any price set by a shop, an admin, a CSV import or a phone check becomes the listed price dated now
(`catalog.update_offer`), so it is trusted again, and is logged in Postgres `data_changes`.
