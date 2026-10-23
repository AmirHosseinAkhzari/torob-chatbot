"""Neo4j access. Everything is a read except store-inquiry results (write)."""
from typing import Any

from neo4j import GraphDatabase, Driver

from .config import settings

_driver: Driver | None = None


def driver() -> Driver:
    global _driver
    if _driver is None:
        _driver = GraphDatabase.driver(settings.neo4j_uri, auth=(settings.neo4j_user, settings.neo4j_password))
    return _driver


def close() -> None:
    global _driver
    if _driver is not None:
        _driver.close()
        _driver = None


def read(query: str, **params: Any) -> list[dict[str, Any]]:
    def work(tx):
        return [record.data() for record in tx.run(query, **params)]

    with driver().session(database=settings.neo4j_database) as session:
        return session.execute_read(work)


def write(query: str, **params: Any) -> list[dict[str, Any]]:
    """The one kind of write the app makes: store-inquiry results."""
    def work(tx):
        return [record.data() for record in tx.run(query, **params)]

    with driver().session(database=settings.neo4j_database) as session:
        return session.execute_write(work)
