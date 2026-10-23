"""The test shop «آستین» for trying the store inquiry (استعلام دستگاه).

Open 24/7, so the inquiry button is always shown. Its phone is the test phone, so the call rings that
number even when INQUIRY_CALL_OVERRIDE is empty. `add` is safe to run again (MERGE): the backend runs it
on startup when SEED_TEST_SHOP=true, and scripts/add_test_shop.py runs it by hand.
"""
import json

from . import db, pg

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


def add() -> None:
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
            ON CREATE SET p.min_price_toman = $price, p.max_price_toman = $price
            SET p.title = $title, p.category_name = $category, p.image_urls = [], p.specs_json = '[]',
                p.specs_text = '', p.offer_count = 1, p.shop_count = 1, p.test = true
            MERGE (c:Category {name: $category})
            MERGE (p)-[:IN_CATEGORY]->(c)
            MERGE (o:Offer {offer_id: $oid})
            // Prices only when first made: later the shop's own answers (its panel) are kept.
            ON CREATE SET o.price_toman = $price, o.has_price = true, o.last_price_changed_at = toString(datetime())
            SET o.seller_title = $title, o.description = 'فروشگاه آزمایشی آستین', o.warranty = 'بدون گارانتی',
                o.test = true
            MERGE (s)-[:HAS_OFFER]->(o)
            MERGE (o)-[:FOR_PRODUCT]->(p)
            """,
            shop=SHOP_ID, pid=pid, oid=pid.replace("product_", "offer_"), title=title, price=price, category=CATEGORY,
        )


def add_staff() -> None:
    """The test shop's phone may open its panel (پنل فروشگاه)."""
    for phone in SHOP["phones"]:
        pg.run("INSERT INTO store_staff (shop_id, phone, name, role) VALUES (%s, %s, %s, 'owner') ON CONFLICT DO NOTHING",
               (SHOP_ID, phone, "آستین"))


def remove() -> None:
    db.write(
        """
        MATCH (s:Shop {shop_id: $shop})
        OPTIONAL MATCH (s)-[:HAS_OFFER]->(o:Offer)-[:FOR_PRODUCT]->(p:Product {test: true})
        OPTIONAL MATCH (i:Inquiry)-[:ABOUT]->(o)
        DETACH DELETE i, o, p, s
        """,
        shop=SHOP_ID,
    )
