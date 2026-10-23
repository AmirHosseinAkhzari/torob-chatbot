---
title: Architecture
tags: [architecture, backend, frontend, neo4j, postgres, agent, modules]
summary: The components, how a chat message flows through them, and a module-by-module map of the code.
code: [backend/app/, frontend/, deploy/neo4j/, scripts/, docker-compose.yml]
---

# Architecture

```
Browser (Next.js 15, React 19, RTL)
   │  REST + Server-Sent Events
   ▼
FastAPI backend (backend/app)
   ├── agent.py ──► OpenAI-compatible Responses API (function tools, streamed)
   ├── repo.py  ──► Neo4j   catalog graph: Product, Offer, Shop, Category, Brand, Area, PaymentProvider
   ├── pg.py    ──► Postgres users, sessions, chat history, store events, verification requests, change log
   ├── voip.py  ──► callctl (pjsua) ──► SIP provider ──► shop's phone
   ├── tts.py   ──► Athena TTS / Edge TTS (Persian speech)
   └── sms.py   ──► Navatel SMS
```

**Why two databases.** Neo4j holds the catalog, where questions are graph-shaped ("shops near X that sell
category Y and accept provider Z"). Postgres holds everything about people and requests, which is
transactional. `pg.py` creates its tables on startup.

## A chat turn

1. `POST /api/chat` (`main.py`) receives the message, history, attached product ids and optional location.
2. `agent.run_turn` streams a Responses API call with the tool list `TOOLS`.
3. **Data tools** (`search_products`, `get_product_details`) query Neo4j through `repo.py` and return compact
   JSON to the model.
4. **Display tools** (`show_products`, `show_comparison`, `show_summary`, `show_stores`, `show_understood`,
   `ask_quick_reply`, `ask_location`, `show_payment_options`) do not return data to the model; they emit a
   `block` event the frontend renders as a component. This keeps answers short and grounded.
5. Events stream to the browser as SSE: `text`, `status` (search progress), `sources`, `block`, `memo`,
   `error`, `done`. Reasoning items are passed back between tool steps (`store=False`,
   `include=["reasoning.encrypted_content"]`).

## Background jobs (started in `main.py` lifespan)

- `verify.run_forever` — every minute: SMS follow-ups for open verification requests, expiry.
- `test_shop.add` when `SEED_TEST_SHOP=true` — seeds a 24/7 test shop for trying the phone inquiry.
- `netprobe.run` when `NET_PROBE=true` — logs whether UDP/SIP can leave the host.

## Backend modules

| Module | Role |
|---|---|
| `main.py` | FastAPI app, routes, auth checks, lifespan jobs |
| `agent.py` | System prompt, tool schemas, tool execution, streaming loop |
| `repo.py` | Read-only graph queries: search, product, stores, recommendation, BNPL |
| `pricing.py` | Price cleaning: placeholders, outliers, median, price age |
| `hours.py` | Opening hours; only declared days are trusted |
| `text.py` | Persian normalization, digit forms, full-text query building |
| `inquiry.py` | Phone inquiry voice script and job state |
| `voip.py` | One SIP call driven step by step (play clip, wait for keys) |
| `tts.py` | Persian text → 16 kHz WAV, cached by text |
| `numwords.py` | Numbers → spoken Persian with vowel marks, for reading prices back |
| `verify.py` | Verification requests, watchers, follow-up SMS, expiry |
| `catalog.py` | Catalog writes (price, stock, shops) with a change log |
| `admin.py` | Admin analytics, shop list, offers, CSV import, change history |
| `roles.py` | Admin by phone (`ADMIN_PHONES`), staff by `store_staff` table |
| `auth.py` | OTP login over SMS; codes and tokens stored only as sha256 hashes |
| `history.py` | Chat history per account |
| `insights.py` | Logs why a shop was or was not recommended and which shop the user chose |
| `sms.py` | Navatel SMS client (logs instead of sending when `NAVATEL_SEND=false`) |
| `voiptest.py`, `netprobe.py`, `test_shop.py` | Diagnostics and test fixtures for the phone line |

`backend/callctl/callctl.c` is a small C program on pjsua that dials, reports call state and keys, and
plays WAVs on command. A prebuilt Linux binary is shipped in `backend/callctl/dist/`.

## Frontend

| Path | Role |
|---|---|
| `app/page.tsx`, `app/c/[id]` | Chat and saved conversations |
| `app/p/[id]` | Product page |
| `app/login` | OTP login |
| `app/store/*` | Store panel: dashboard, verification requests, offers |
| `app/admin/*` | Admin panel: overview, stores, new store, data/import |
| `components/chat/Blocks.tsx` | Renders every agent `block` kind |
| `components/stores/*` | Map (Leaflet + OpenStreetMap), store cards, recommendation, route, Snapp, inquiry button |
| `components/panel/*` | Shared panel shell, offers table, store form, map pin picker |
| `middleware.ts` | `admin.<domain>` opens the admin panel |

## Data pipeline

`scripts/prepare_import.py` turns the raw CSVs into neo4j-admin import files; `scripts/load_neo4j.sh`
bulk-imports, starts Neo4j and applies `scripts/schema.cypher` (constraints, range, point and Persian
full-text indexes). `deploy/neo4j/` packages the same for Liara.
