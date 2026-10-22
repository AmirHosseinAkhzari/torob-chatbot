#!/usr/bin/env python3
"""Add (or refresh) the test shop «آستین» for trying the store inquiry (استعلام دستگاه).

Open 24/7, so the inquiry button is always shown. Its phone is the test phone, so the call
rings that number even when INQUIRY_CALL_OVERRIDE is empty. Safe to run again (MERGE).

    .venv/bin/python scripts/add_test_shop.py          # add / update
    .venv/bin/python scripts/add_test_shop.py --remove # delete the shop, its offers and products
"""
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
logging.getLogger("neo4j").setLevel(logging.ERROR)

from app import db  # noqa: E402

SHOP_ID = "shop_test_astin"
SHOP = {
    "shop_id": SHOP_ID,
    "name": "آستین",
    "area": "شیخ هادی",
    "address": "خیابان جمهوری، نرسیده به خیابان حافظ، پلاک ۱ (فروشگاه آزمایشی)",
    "phones": ["09304682860"],
    "lat": 35.6990,
    "lng": 51.4120,
    "payment_providers": ["ترب‌پی", "اسنپ‌پی"],
}
CATEGORY = "لوازم خیاطی"
PRODUCTS = [
    ("product_test_astin_head", "کله آنسان", 450_000),
    ("product_test_astin_thread", "نخ", 25_000),
    ("product_test_astin_needle", "سوزن", 15_000),
    ("product_test_astin_button", "دکمه", 5_000),
]

# Same shape as the dataset: a 00:00-00:00 shift is "all day" (hours.py shows شبانه‌روزی).
DAYS = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"]
HOURS_JSON = json.dumps({d: {"status": "declared", "shifts": [{"start_time": "00:00:00", "end_time": "00:00:00"}]}
                         for d in DAYS})
HOURS_TEXT = " | ".join(f"{n}: شبانه‌روزی" for n in ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"])


def add():
    db.write(
        """
        MERGE (s:Shop {shop_id: $s.shop_id})
        SET s.name = $s.name, s.area = $s.area, s.address = $s.address, s.phones = $s.phones,
            s.location = point({latitude: $s.lat, longitude: $s.lng}),
            s.weekly_hours_json = $hours_json, s.weekly_hours_text = $hours_text,
            s.supports_fast_delivery = false, s.payment_providers = $s.payment_providers,
            s.category_count = 1, s.test = true
        MERGE (a:Area {name: $s.area})
        MERGE (s)-[:LOCATED_IN]->(a)
        MERGE (c:Category {name: $category})
        MERGE (s)-[:SELLS_CATEGORY]->(c)
        WITH s
        UNWIND $s.payment_providers AS name
        MERGE (pp:PaymentProvider {name: name})
        MERGE (s)-[:ACCEPTS_PAYMENT]->(pp)
        """,
        s=SHOP, hours_json=HOURS_JSON, hours_text=HOURS_TEXT, category=CATEGORY,
    )
    for pid, title, price in PRODUCTS:
        db.write(
            """
            MATCH (s:Shop {shop_id: $shop})
            MERGE (p:Product {product_id: $pid})
            SET p.title = $title, p.category_name = $category, p.image_urls = [], p.specs_json = '[]',
                p.specs_text = '', p.offer_count = 1, p.shop_count = 1,
                p.min_price_toman = $price, p.max_price_toman = $price, p.test = true
            MERGE (c:Category {name: $category})
            MERGE (p)-[:IN_CATEGORY]->(c)
            MERGE (o:Offer {offer_id: $oid})
            SET o.price_toman = $price, o.has_price = true, o.seller_title = $title,
                o.description = 'فروشگاه آزمایشی آستین', o.warranty = 'بدون گارانتی',
                o.last_price_changed_at = toString(datetime()), o.test = true
            MERGE (s)-[:HAS_OFFER]->(o)
            MERGE (o)-[:FOR_PRODUCT]->(p)
            """,
            shop=SHOP_ID, pid=pid, oid=pid.replace("product_", "offer_"), title=title, price=price, category=CATEGORY,
        )
    print(f"«{SHOP['name']}» ({SHOP_ID}) with {len(PRODUCTS)} products:")
    for pid, title, price in PRODUCTS:
        print(f"  {title:10} {price:>9,} toman  http://localhost:3000/p/{pid}?shop={SHOP_ID}")


def remove():
    db.write(
        """
        MATCH (s:Shop {shop_id: $shop})
        OPTIONAL MATCH (s)-[:HAS_OFFER]->(o:Offer)-[:FOR_PRODUCT]->(p:Product {test: true})
        OPTIONAL MATCH (i:Inquiry)-[:ABOUT]->(o)
        DETACH DELETE i, o, p, s
        """,
        shop=SHOP_ID,
    )
    print("removed", SHOP_ID)


if __name__ == "__main__":
    remove() if "--remove" in sys.argv else add()
