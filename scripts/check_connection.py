"""Connect to the Torob Neo4j and print a few sanity checks.

Usage: .venv/bin/python scripts/check_connection.py
"""
import os
from pathlib import Path

from neo4j import GraphDatabase

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def load_env():
    for line in ENV_FILE.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def main():
    load_env()
    uri = f"bolt://localhost:{os.environ.get('NEO4J_BOLT_PORT', '7688')}"
    auth = (os.environ["NEO4J_USER"], os.environ["NEO4J_PASSWORD"])

    with GraphDatabase.driver(uri, auth=auth) as driver:
        driver.verify_connectivity()
        print(f"Connected to {uri}")
        with driver.session(database="neo4j") as session:
            for record in session.run(
                    "MATCH (n) RETURN labels(n)[0] AS label, count(*) AS n ORDER BY n DESC"):
                print(f"  {record['label']:<16} {record['n']:>8,}")

            print("\nCheapest offers for '+اپل +iPhone +15 -طرح':")
            result = session.run("""
                CALL db.index.fulltext.queryNodes('product_title', $q) YIELD node AS p
                WHERE p.category_name = 'گوشی موبایل'
                WITH p LIMIT 20
                MATCH (p)<-[:FOR_PRODUCT]-(o:Offer)<-[:HAS_OFFER]-(s:Shop)
                WHERE o.price_toman IS NOT NULL
                RETURN p.title AS title, o.price_toman AS price, s.name AS shop, s.area AS area
                ORDER BY price LIMIT 5
                """, q="+اپل +iPhone +15 -طرح")
            for r in result:
                print(f"  {r['price']:>13,} toman | {r['shop']} ({r['area']}) | {r['title']}")


if __name__ == "__main__":
    main()
