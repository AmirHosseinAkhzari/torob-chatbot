# Torob chatbot challenge — knowledge graph

The Torob dataset (shops, products, offers) loaded into Neo4j as a knowledge graph for the chatbot.

## Torob Chat app

```
frontend/   Next.js 15 + React 19 (RTL, Torob Chat design system, Leaflet + OpenStreetMap)
backend/    FastAPI: Neo4j queries + an OpenAI Responses-API agent that streams text, status steps and UI components
```

Start all three (Neo4j, backend, frontend):

```bash
docker compose up -d
cd backend && ../.venv/bin/pip install -r requirements.txt && ../.venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev        # http://localhost:3000
```

- Settings live in `.env` (git-ignored; template in `.env.example`): Neo4j login, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` (default `openai/gpt-6.1-sol` on BoxAPI), `OPENAI_REASONING_EFFORT`. The frontend reads `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`, see `frontend/.env.local.example`).
- `gpt-6.1-sol` only accepts function tools through the Responses API, so the agent uses `client.responses.stream(...)` and passes reasoning items back between tool steps (`store=False`, `include=["reasoning.encrypted_content"]`).
- Fonts: IRANYekan is a licensed FontIran font. Copy `iranyekanwebregular/medium/bold.woff` into `frontend/public/fonts/` (git-ignored); without them the app falls back to Vazirmatn.
- If `npm install` hangs on a mirror registry, run it with `--registry https://registry.npmjs.org`.

API (all reads):

| Endpoint | What |
|---|---|
| `GET /api/health` | Neo4j reachable, model name |
| `GET /api/search/live?q=` | Live product suggestions for the message box; detects Tehran neighborhoods and city names so they are never offered as products |
| `GET /api/products/{id}` | Product, specs, cleaned price range, every offer with shop, warranty, price age, fast delivery, payment providers, open-now |
| `GET /api/products/{id}/stores?lat=&lng=` or `?area=` | In-person stores for the map, by distance or neighborhood |
| `GET /api/areas` | The 30 Tehran neighborhoods with shop counts |
| `POST /api/chat` | Server-sent events: `text`, `status`, `sources`, `block` (understood, quick_reply, products, compare, summary, stores, payment_options), `memo`, `error`, `done` |

Data handling the UI relies on: prices under 1,000 toman are "call for price" placeholders; offers more than 3× off the median are flagged and kept out of the "from" price; hours are shown only for days the shop declared; stock (`استوک`) and lookalike (`طرح`) titles are flagged; every shop is in Tehran, so the location picker offers Tehran neighborhoods and marks other provinces as "soon".

Store pick (پیشنهاد ترب): in the in-person view, when a shop is within 4 km of the user (or in their neighborhood) and at most 7% above the cheapest price on Torob, the app picks it for them: it is selected on the map with the reasons (distance, price gap, open now, warranty, price age), directions (geo: intent) and a Snapp button on phones, call and address on desktop. When no shop qualifies, nothing is picked. Thresholds are `PICK_MAX_DISTANCE_M` and `PICK_MAX_PRICE_GAP` in `backend/app/repo.py`. The Snapp discount label comes from `NEXT_PUBLIC_SNAPP_DISCOUNT_PERCENT` (default 10, `0` hides it); it is a label only and the link opens Snapp normally.

Buy now, pay later (فروش اعتباری): when the user wants to buy on credit («قسطی», «اقساطی», «الان بخر بعدا پرداخت کن», or a provider name), search only counts shops that accept the provider (ترب‌پی, اسنپ‌پی, دیجی پی, تارا, ازکی‌وام, or any of them): prices and shop counts cover only those shops. Each product card then ends with the provider's estimated plan and the nearest accepting shop (from the user's location or neighborhood), with call, Snapp on phones, and the map. The product pop-up and map opened from that card list only accepting shops. A general "what options are there" question shows the five providers with how many shops take each. Provider terms are hard-coded in `backend/app/repo.py` (`PROVIDERS`); the amounts are estimates.

## Run the knowledge graph

```bash
# first time / full rebuild (wipes the graph and re-imports, ~30s)
./scripts/load_neo4j.sh                # uses TOROB_DATASET_DIR from .env
./scripts/load_neo4j.sh /path/to/raw   # or pass the folder with shops/products/offers.csv

# day to day
docker compose up -d
docker compose stop
```

- Browser: http://localhost:7475 (connect URL `bolt://localhost:7688`)
- Credentials: `.env` (`NEO4J_USER` / `NEO4J_PASSWORD`, git-ignored)
- Ports differ from the defaults because another Neo4j already uses 7474/7687.

## Graph model

```
(:Shop)-[:HAS_OFFER]->(:Offer)-[:FOR_PRODUCT]->(:Product)
(:Product)-[:IN_CATEGORY]->(:Category)
(:Product)-[:MADE_BY]->(:Brand)
(:Shop)-[:SELLS_CATEGORY]->(:Category)
(:Shop)-[:LOCATED_IN]->(:Area)
(:Shop)-[:ACCEPTS_PAYMENT]->(:PaymentProvider)
```

| Label | Count | Key properties |
|---|---|---|
| `Product` | 225,903 | `product_id`, `title`, `brand_name`, `category_name`, `model`, `image_urls[]`, `specs_json`, `specs_text`, `offer_count`, `shop_count`, `min_price_toman`, `max_price_toman` |
| `Offer` | 331,506 | `offer_id`, `price_toman` (null = no price), `has_price`, `seller_title`, `description`, `last_price_changed_at`, `warranty`, `warranty_provider`, `warranty_months`, `warranty_description` |
| `Shop` | 6,476 | `shop_id`, `name`, `address`, `area`, `location` (WGS-84 point), `phones[]`, `website_url`, `instagram_handle`, `supports_fast_delivery`, `payment_providers[]`, `weekly_hours_text`, `weekly_hours_json` |
| `Category` | 3,988 | `name` (shared by product categories and shop categories) |
| `Brand` | 2,249 | `name` |
| `Area` | 30 | `name` (shop `location_label`) |
| `PaymentProvider` | 8 | `name` |

Every product has at least one offer, and every offer has a valid product and shop.
Prices are in Toman. `brand_name` is missing for about 75% of products.

## Indexes

- Unique constraints on every id / name.
- Range indexes: `Offer.price_toman`, `Product.min_price_toman`, `Product.brand_name`, `Product.category_name`, `Shop.name`. Point index: `Shop.location`.
- Full-text (Persian analyzer): `product_title` (title, model; use this to find a product by name), `product_text` (title, brand, category, model, specs; matches spec numbers too, so it gives false hits for names like "iPhone 15"), `offer_text` (seller_title, description), `shop_text` (name, address, area), `lookup_text` (Category/Brand/Area names).

Full-text does not unify Persian and Latin digits (`۱۳` vs `13`), so try both forms in user queries.
Titles often use English model names (`گوشی اپل iPhone 15`, not `آیفون`), and `گوشی طرح اپل` means an Apple lookalike.
Lucene syntax works: `+اپل +iPhone +15 -طرح` requires the first three words and excludes `طرح`.

## Example queries

```cypher
// Find products by free text, cheapest first
CALL db.index.fulltext.queryNodes('product_title', '+سامسونگ +A54') YIELD node, score
RETURN node.title, node.min_price_toman, node.offer_count, score LIMIT 10;

// Every offer for a product, with the shop and its contact info
MATCH (p:Product {product_id: $id})<-[:FOR_PRODUCT]-(o:Offer)<-[:HAS_OFFER]-(s:Shop)
RETURN s.name, s.area, s.phones, o.price_toman, o.warranty ORDER BY o.price_toman;

// Shops near a point (meters) that sell a category
MATCH (s:Shop)-[:SELLS_CATEGORY]->(:Category {name: 'دوربین مدار بسته'})
WHERE point.distance(s.location, point({latitude: 35.70, longitude: 51.41})) < 2000
RETURN s.name, s.address, s.weekly_hours_text;

// Cheapest products of a brand within a category
MATCH (b:Brand {name: 'سونی'})<-[:MADE_BY]-(p:Product)-[:IN_CATEGORY]->(:Category {name: 'لنز دوربین'})
RETURN p.title, p.min_price_toman ORDER BY p.min_price_toman LIMIT 10;
```

## Files

- `scripts/prepare_import.py`: raw CSVs → `data/import/*.csv` in neo4j-admin format (standard library only)
- `scripts/load_neo4j.sh`: prepare, then bulk import, then start the server and apply the schema
- `scripts/schema.cypher`: constraints and indexes
- `scripts/check_connection.py`: connects with the `.env` settings and runs a sample search (`python3 -m venv .venv && .venv/bin/pip install neo4j`, then `.venv/bin/python scripts/check_connection.py`)
- `docker-compose.yml`: the `torob-neo4j` container and its `torob-neo4j-data` volume
