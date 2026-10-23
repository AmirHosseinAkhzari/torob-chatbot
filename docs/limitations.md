---
title: Limitations and next steps
tags: [limitations, known-issues, testing, roadmap, risks]
summary: What is not built, not tested, or estimated — stated plainly.
code: [backend/app/, frontend/]
---

# Limitations and next steps

## Not built

- **No automated test suite.** Verification so far is manual: TypeScript typecheck, production builds,
  `/api/health`, the VoIP test call (`app.voiptest`), and end-to-end runs in demo mode.
  `backend/app/test_shop.py` is a test fixture (a seeded shop), not a test.
- **No checkout.** BNPL shows provider terms and estimated plans only; amounts are hard-coded estimates.
- **No price history or price alerts.** The dataset has a single price per offer; the agent is told not to offer these.
- **Store insights are recorded but not shown** in any panel yet.
- **No image search or upload.**

## Data limits

- Every shop is in Tehran; other cities have no data.
- Most products have one seller, so many "comparisons" are of one price.
- Stock is unknown until a shop answers a verification request or a phone inquiry.

## Operational limits

- Phone inquiry needs SIP credentials and a host that allows SIP over TLS; it calls only shops that are open.
- Athena TTS's free plan allows only a few clips; Edge TTS is the fallback. Clips are cached by text.
- Caches are in-process (no shared cache), so several backend instances do not share them. The follow-up job
  is written to be safe across instances.
- One AI endpoint with no automatic fallback model.

## Next steps

1. Unit tests for `pricing.py`, `hours.py`, `text.py` and `repo.recommend` (pure functions, easy to cover),
   then API tests for auth and roles.
2. Show store insights in the store panel.
3. Real BNPL integration with one provider.
