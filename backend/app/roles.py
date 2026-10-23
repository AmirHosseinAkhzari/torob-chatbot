"""Who may do what: admins (پنل مدیریت) by phone from ADMIN_PHONES, shop staff (پنل فروشگاه) from store_staff."""
import os

from . import config  # noqa: F401  (loads .env)
from . import db, pg


def _mobile(phone: str) -> str:
    digits = "".join(c for c in phone if c.isdigit())
    if digits.startswith("98") and len(digits) == 12:
        digits = "0" + digits[2:]
    return digits


ADMIN_PHONES = {_mobile(p) for p in os.environ.get("ADMIN_PHONES", "").split(",") if p.strip()}


def is_admin(user: dict | None) -> bool:
    return bool(user) and _mobile(user["phone"]) in ADMIN_PHONES


def staff_shop_ids(user: dict) -> list[str]:
    return [r["shop_id"] for r in pg.all_rows("SELECT shop_id FROM store_staff WHERE phone = %s ORDER BY created_at",
                                              (_mobile(user["phone"]),))]


def can_manage_shop(user: dict, shop_id: str) -> bool:
    """Admins see every shop; staff only their own."""
    if is_admin(user):
        return True
    return pg.one("SELECT 1 AS ok FROM store_staff WHERE shop_id = %s AND phone = %s",
                  (shop_id, _mobile(user["phone"]))) is not None


def shops_for(user: dict) -> list[dict]:
    """[{id, name, area}] of the shops this user staffs."""
    ids = staff_shop_ids(user)
    if not ids:
        return []
    rows = db.read("MATCH (s:Shop) WHERE s.shop_id IN $ids RETURN s.shop_id AS id, s.name AS name, s.area AS area", ids=ids)
    by_id = {r["id"]: r for r in rows}
    return [by_id[i] for i in ids if i in by_id]


def roles_for(user: dict) -> dict:
    return {"admin": is_admin(user), "shops": shops_for(user)}
