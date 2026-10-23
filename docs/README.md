---
title: Documentation index
tags: [index, overview, start-here]
summary: Map of every doc in this folder, with tags, so a reader (human or agent) can jump to the right file.
---

# Tarboche (تربچه) — documentation index

Tarboche is a Persian shopping chat built on the Torob dataset: it finds products, compares them, and finds the
physical Tehran shop to buy from. Start with [overview.md](overview.md).

| File | Tags | What it covers |
|---|---|---|
| [overview.md](overview.md) | `overview` `problem` `solution` `status` | The problem, what the app does, what is live, what is not built |
| [architecture.md](architecture.md) | `architecture` `backend` `frontend` `neo4j` `postgres` `agent` | Components, data flow, modules and where each lives |
| [features.md](features.md) | `features` `chat` `generative-ui` `stores` `bnpl` `panels` | Each user-facing feature and the code behind it |
| [store-inquiry.md](store-inquiry.md) | `voip` `sip` `dtmf` `tts` `inquiry` `verification` `sms` | Automated phone call to a shop, price/stock verification requests, SMS follow-up |
| [data-quality.md](data-quality.md) | `data` `pricing` `trust` `recommendation` `hours` | How raw dataset problems are cleaned and when a price is trusted |
| [api.md](api.md) | `api` `endpoints` `sse` | Every HTTP endpoint grouped by area |
| [setup.md](setup.md) | `setup` `run` `env` `deploy` `liara` | Run it locally, environment variables, deployment |
| [limitations.md](limitations.md) | `limitations` `known-issues` `testing` `roadmap` | What is missing or unverified |

Reference material already in this folder (not written for review):
[torob_api.md](torob_api.md), [athena_tts_api.md](athena_tts_api.md), [dataset_sample.json](dataset_sample.json).

The root [README.md](../README.md) has the graph model, indexes and example Cypher queries.

## Quick facts

- **Stack:** FastAPI (Python) + Next.js 15 / React 19 (RTL Persian UI) + Neo4j (catalog graph) + Postgres (people, history, requests).
- **AI:** one OpenAI-compatible endpoint via the Responses API, with function tools; model set by `OPENAI_MODEL`.
- **Data:** 225,903 products, 331,506 offers, 6,476 shops (all in Tehran) loaded as a graph.
- **Size:** about 4,600 lines of backend Python in `backend/app/`, plus the Next.js app in `frontend/`.
- **Hosting:** Liara (frontend, backend, Neo4j apps + managed Postgres).
