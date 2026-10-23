---
title: Overview
tags: [overview, problem, solution, status]
summary: What problem Tarboche solves, what it does end to end, and what is live versus not built.
code: [backend/app/agent.py, backend/app/repo.py, frontend/app/page.tsx]
---

# Overview

## Problem

Torob lists prices from thousands of shops, but a shopper still has to answer three questions alone:

1. Which product fits my need and budget?
2. Is the listed price still true, and is it in stock today?
3. Which shop near me should I actually go to?

The dataset makes question 2 hard: many prices are placeholders (`1` toman = "call for price"), some are far
off the rest, many are months old, and stock is not recorded at all.

## What Tarboche does

- **Chat in colloquial Persian.** The user asks for a product; the agent searches the graph and answers with
  UI components (product cards, comparisons, summaries, store maps), not long text. See [features.md](features.md).
- **Answers only from data.** Prices, sellers, warranty, delivery and payment methods come from tool results.
  The system prompt forbids inventing them (`backend/app/agent.py`, `SYSTEM_PROMPT`).
- **Picks a shop for in-person buying.** With the user's GPS or neighborhood it recommends the nearest shop,
  the cheapest nearby, or the cheapest in Tehran, using only prices it trusts. See [data-quality.md](data-quality.md).
- **Checks prices with the shop.** When a price is old, missing, or stock is unknown, it opens a verification
  request in the shop's panel, can phone the shop with an automated Persian voice script, and texts the
  customer the answer. See [store-inquiry.md](store-inquiry.md).
- **Buy now, pay later.** Filters shops by installment provider and shows an estimated plan per product.
- **Panels.** A store panel (`/store`) for shop staff and an admin panel (`/admin`) for analytics, shops,
  prices, CSV import and change history.

## Status

| Area | State |
|---|---|
| Chat agent, generative UI, product pages | Built |
| Neo4j graph with full dataset | Built, deployed |
| Store map, store pick, Snapp/directions buttons | Built |
| BNPL filtering and plan estimates | Built (amounts are estimates; no checkout) |
| OTP login, accounts, synced chat history | Built (Postgres) |
| Phone inquiry to shops (SIP + TTS + keypad) | Built; tested with a test shop and real calls |
| Verification requests + SMS follow-up | Built |
| Store panel and admin panel | Built on branch `feature/store-inquiry` |
| Automated test suite | Not built — see [limitations.md](limitations.md) |

Live frontend: https://torob-frontend.liara.run
