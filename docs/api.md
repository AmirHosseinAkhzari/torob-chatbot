---
title: HTTP API
tags: [api, endpoints, sse, auth, rest]
summary: Every backend endpoint, grouped by area, with who may call it.
code: [backend/app/main.py]
---

# HTTP API

All routes are in `backend/app/main.py`. Auth is a bearer token from `/api/auth/otp/verify`.
"Login" = any signed-in user; "Staff" = staff of that shop or an admin; "Admin" = phone in `ADMIN_PHONES`.

## Catalog (public)

| Method | Path | What |
|---|---|---|
| GET | `/api/health` | Neo4j reachable, model name |
| GET | `/api/products/{id}` | Product, specs, cleaned price range, every offer with shop, warranty, price age, delivery, payment, open-now |
| GET | `/api/products/{id}/stores?lat=&lng=` / `?area=` / `&pay=` | In-person stores, recommendation, verification flags (login optional; opens requests for signed-in users) |
| GET | `/api/areas` | 30 Tehran neighborhoods with shop counts |

## Chat (login)

| Method | Path | What |
|---|---|---|
| POST | `/api/chat` | SSE stream: `text`, `status`, `sources`, `block`, `memo`, `error`, `done` |
| GET / PUT / DELETE | `/api/conversations`, `/api/conversations/{id}` | Saved chat history |
| POST | `/api/store-events/choice` | Records which shop the user chose and why |

## Account

| Method | Path | What |
|---|---|---|
| POST | `/api/auth/otp/request` | Text a 5-digit code |
| POST | `/api/auth/otp/verify` | Exchange code for a token |
| GET | `/api/me` | User, roles, staffed shops |
| PUT | `/api/me/settings` | Save settings |
| POST | `/api/auth/logout` | End session |

## Store inquiry (login)

| Method | Path | What |
|---|---|---|
| POST | `/api/inquiries` | Start a phone inquiry to a shop |
| GET | `/api/inquiries/{id}` | Poll its status and result |
| POST / GET | `/api/voip-test`, `/api/voip-test/{id}` | Test call to the user's own phone |

## Store panel (staff)

| Method | Path | What |
|---|---|---|
| GET | `/api/store/{shop_id}/dashboard` | Counts and recent activity |
| GET | `/api/store/{shop_id}/requests[/{rid}]` | Verification requests |
| GET | `/api/store/requests/{rid}` | A request by id (from an SMS link) |
| POST | `/api/store/{shop_id}/requests/{rid}/claim` | Take a request |
| POST | `/api/store/{shop_id}/requests/{rid}/resolve` | Answer with price and stock |
| GET / PATCH | `/api/store/{shop_id}/offers[/{offer_id}]` | List / edit own prices and stock |

## Admin panel (admin)

| Method | Path | What |
|---|---|---|
| GET | `/api/admin/overview`, `/api/admin/totals` | Analytics |
| GET / POST / PUT | `/api/admin/stores[/{shop_id}]` | List, view, add, edit shops |
| POST / DELETE | `/api/admin/stores/{shop_id}/staff[/{phone}]` | Manage staff |
| GET / PATCH | `/api/admin/offers[/{offer_id}]` | Search and edit prices and stock |
| POST | `/api/admin/import` | CSV price/stock import (preview, then apply) |
| GET | `/api/admin/changes` | Change history |
