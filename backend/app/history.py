"""Chat history on the account (Postgres). A conversation is stored whole: {id, title, createdAt, updatedAt, messages}."""
from . import pg

MAX_LIST = 100


def _ms(dt) -> int:
    return int(dt.timestamp() * 1000)


def list_for(user_id: int) -> list[dict]:
    rows = pg.all_rows(
        "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = %s ORDER BY updated_at DESC LIMIT %s",
        (user_id, MAX_LIST),
    )
    return [{"id": r["id"], "title": r["title"], "createdAt": _ms(r["created_at"]), "updatedAt": _ms(r["updated_at"]), "messages": []}
            for r in rows]


def get(user_id: int, conv_id: str) -> dict | None:
    r = pg.one("SELECT id, title, messages, created_at, updated_at FROM conversations WHERE user_id = %s AND id = %s",
               (user_id, conv_id))
    if not r:
        return None
    return {"id": r["id"], "title": r["title"], "createdAt": _ms(r["created_at"]), "updatedAt": _ms(r["updated_at"]),
            "messages": r["messages"]}


def save(user_id: int, conv: dict) -> None:
    pg.run(
        """
        INSERT INTO conversations (user_id, id, title, messages, created_at, updated_at)
        VALUES (%s, %s, %s, %s, to_timestamp(%s / 1000.0), to_timestamp(%s / 1000.0))
        ON CONFLICT (user_id, id) DO UPDATE
          SET title = EXCLUDED.title, messages = EXCLUDED.messages, updated_at = EXCLUDED.updated_at
        """,
        (user_id, conv["id"], conv.get("title") or "", pg.jsonb(conv.get("messages") or []),
         conv.get("createdAt") or 0, conv.get("updatedAt") or 0),
    )


def delete(user_id: int, conv_id: str) -> None:
    pg.run("DELETE FROM conversations WHERE user_id = %s AND id = %s", (user_id, conv_id))
