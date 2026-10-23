---
title: Setup, run and deploy
tags: [setup, run, env, configuration, deploy, liara, docker]
summary: How to run Tarboche locally, the environment variables it reads, and how it is deployed.
code: [.env.example, docker-compose.yml, .claude/launch.json, backend/Dockerfile, backend/liara.json, frontend/liara.json, deploy/neo4j/]
---

# Setup, run and deploy

## Local

Requirements: Docker, Python 3.11+, Node 20+, and the Torob dataset CSVs.

```bash
cp .env.example .env                  # fill in Neo4j, Postgres and AI settings
./scripts/load_neo4j.sh               # first time: import the dataset into Neo4j (~30 s)
docker compose up -d                  # Neo4j (+ Postgres)
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
.venv/bin/uvicorn app.main:app --app-dir backend --port 8000 --reload
npm --prefix frontend install && npm --prefix frontend run dev     # http://localhost:3000
```

### Demo mode without SMS or calls

`.claude/launch.json` has a `backend-demo` configuration that runs safely without credit or real phones:

```
NAVATEL_SEND=false            # login returns the code as dev_code instead of texting it
ADMIN_PHONES=09120000001      # this test phone gets the admin panel
VERIFY_SMS_OVERRIDE=09120000009
VOIP_SERVER=invalid.invalid   # no real calls
SEED_TEST_SHOP=true           # a 24/7 test shop for the inquiry flow
```

## Environment variables (`.env.example`)

| Group | Variables |
|---|---|
| Neo4j | `NEO4J_USER`, `NEO4J_PASSWORD`, `NEO4J_HTTP_PORT`, `NEO4J_BOLT_PORT`, `TOROB_DATASET_DIR` |
| AI | `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT` |
| Backend | `BACKEND_PORT`, `FRONTEND_ORIGIN`, `PUBLIC_APP_URL` |
| Postgres | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` |
| Phone line | `VOIP_SERVER`, `VOIP_USER`, `VOIP_PASSWORD`, `VOIP_TRANSPORT`, `VOIP_DTMF`, `NET_PROBE`, `INQUIRY_CALL_OVERRIDE` |
| Voice | `TTS_PROVIDER`, `ATHENA_ACCESS_TOKEN`, `ATHENA_REFRESH_TOKEN` |
| SMS | `NAVATEL_BASE_URL`, `NAVATEL_API_KEY`, `NAVATEL_SRC_PHONE`, `NAVATEL_SEND` |
| Roles | `ADMIN_PHONES`, `VERIFY_SMS_OVERRIDE`, `VERIFY_EXPIRE_HOURS` |
| Frontend | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SNAPP_DISCOUNT_PERCENT` |

## Checks

```bash
npm --prefix frontend run typecheck   # TypeScript
npm --prefix frontend run build       # production build
curl localhost:8000/api/health        # backend + Neo4j
```

## Deploy (Liara)

- `frontend/liara.json`, `backend/liara.json` (Dockerfile), `deploy/neo4j/liara.json` (Neo4j with seed
  entrypoint), plus Liara managed Postgres.
- Liara does not allow inbound UDP, so the phone line uses SIP over TLS (`VOIP_TRANSPORT=tls`) and keys as
  SIP INFO (`VOIP_DTMF=info`). The call helper is shipped prebuilt in `backend/callctl/dist/` instead of
  compiling pjproject on Liara's builder.
- `admin.<domain>` routes to the admin panel (`frontend/middleware.ts`).
