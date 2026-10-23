#!/usr/bin/env python3
"""Add (or refresh) the test shop «آستین» for trying the store inquiry (استعلام دستگاه).

The shop and its products are defined in backend/app/test_shop.py. Safe to run again (MERGE).

    .venv/bin/python scripts/add_test_shop.py          # add / update
    .venv/bin/python scripts/add_test_shop.py --remove # delete the shop, its offers and products
"""
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
logging.getLogger("neo4j").setLevel(logging.ERROR)

from app import test_shop  # noqa: E402

if __name__ == "__main__":
    if "--remove" in sys.argv:
        test_shop.remove()
        print("removed", test_shop.SHOP_ID)
    else:
        test_shop.add()
        print(f"«{test_shop.SHOP['name']}» ({test_shop.SHOP_ID}) with {len(test_shop.PRODUCTS)} products:")
        for pid, title, price in test_shop.PRODUCTS:
            print(f"  {title:10} {price:>9,} toman  http://localhost:3000/p/{pid}?shop={test_shop.SHOP_ID}")
