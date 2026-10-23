"""Postgres: users, login codes, sessions, settings, chat history and store insights.

Neo4j stays the product/shop catalog; everything about people lives here. Tables are created on startup.
"""
import json
import logging
import os
from contextlib import contextmanager
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from . import config  # noqa: F401  (loads .env)

log = logging.getLogger("torob-chat.pg")

DSN = os.environ.get("POSTGRES_DSN") or (
    f"postgresql://{os.environ.get('POSTGRES_USER', 'torob')}:{os.environ.get('POSTGRES_PASSWORD', '')}"
    f"@{os.environ.get('POSTGRES_HOST', '127.0.0.1')}:{os.environ.get('POSTGRES_PORT', '5433')}/{os.environ.get('POSTGRES_DB', 'torobche')}"
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  phone         TEXT NOT NULL UNIQUE,            -- 09xxxxxxxxx
  settings      JSONB NOT NULL DEFAULT '{}',     -- {"theme": "system" | "light" | "dark"}
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS otp_codes (
  phone      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,                      -- sha256 of the code, never the code
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  tries      INT NOT NULL DEFAULT 0
);

-- One row per code sent, for the per-number hourly limit.
CREATE TABLE IF NOT EXISTS otp_sends (
  phone   TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_sends_recent ON otp_sends (phone, sent_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,                 -- sha256 of the bearer token
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  messages   JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS conversations_recent ON conversations (user_id, updated_at DESC);

-- What تربچه told people about in-person shops, for the shops to learn from later (not shown anywhere yet).
-- kind: suggested       a shop was recommended (roles: nearest / cheapest_nearby / cheapest_city)
--       not_suggested   a shop that sells the product was left out (reasons: stale_price, outlier_price,
--                       said_unavailable, no_price, more_expensive, farther, closed_now, ...)
--       buy_click       the user pressed «خرید از …» on the recommended shop
--       chose_other     the user went with another shop (reasons: cheaper, nearer, stale_price_at_pick,
--                       open_now, warranty, user_said:<answer>, ...)
CREATE TABLE IF NOT EXISTS store_events (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT REFERENCES users(id) ON DELETE SET NULL,
  kind                  TEXT NOT NULL,
  product_id            TEXT NOT NULL,
  shop_id               TEXT NOT NULL,
  offer_id              TEXT,
  recommended_offer_id  TEXT,
  roles                 TEXT[] NOT NULL DEFAULT '{}',
  reasons               TEXT[] NOT NULL DEFAULT '{}',
  detail                JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_events_shop ON store_events (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS store_events_kind ON store_events (kind, created_at DESC);
"""

_pool: ConnectionPool | None = None


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(DSN, min_size=1, max_size=8, kwargs={"row_factory": dict_row, "autocommit": True}, open=True)
    return _pool


def init() -> None:
    with pool().connection() as c:
        c.execute(SCHEMA)
    log.info("postgres ready")


def close() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def conn():
    with pool().connection() as c:
        yield c


def one(sql: str, params: Any = None) -> dict | None:
    with conn() as c:
        return c.execute(sql, params).fetchone()


def all_rows(sql: str, params: Any = None) -> list[dict]:
    with conn() as c:
        return c.execute(sql, params).fetchall()


def run(sql: str, params: Any = None) -> None:
    with conn() as c:
        c.execute(sql, params)


def jsonb(v: Any) -> Jsonb:
    return Jsonb(v, dumps=lambda o: json.dumps(o, ensure_ascii=False, default=str))
