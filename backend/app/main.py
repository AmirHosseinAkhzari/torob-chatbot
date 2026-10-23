"""FastAPI app for تربچه (Torob Chat). Run: ../.venv/bin/uvicorn app.main:app --reload --port 8000 (from backend/).

Neo4j holds the catalog; Postgres holds accounts, sessions, settings, chat history and store insights.
Everything a person does needs a login (bearer token from /api/auth/otp/verify)."""
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import admin, agent, auth, catalog, db, history, insights, inquiry, netprobe, pg, repo, roles, test_shop, verify, voiptest
from .config import settings

log = logging.getLogger("torob-chat")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logging.getLogger("neo4j").setLevel(logging.ERROR)  # "property does not exist" notices


async def _seed_test_shop() -> None:
    try:
        await asyncio.to_thread(test_shop.add)
        await asyncio.to_thread(test_shop.add_staff)
        log.info("test shop %s is in Neo4j", test_shop.SHOP_ID)
    except Exception as e:  # Neo4j may still be starting; the app works without the test shop
        log.warning("could not add the test shop: %s", e)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await asyncio.to_thread(pg.init)
    if os.environ.get("SEED_TEST_SHOP", "false").lower() in ("1", "true", "yes"):
        asyncio.create_task(_seed_test_shop())
    if os.environ.get("NET_PROBE", "false").lower() in ("1", "true", "yes"):
        asyncio.create_task(asyncio.to_thread(netprobe.run))
    followups = asyncio.create_task(verify.run_forever())  # verification requests: 1-hour Navatel follow-up
    yield
    followups.cancel()
    db.close()
    pg.close()


app = FastAPI(title="Torob Chat API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _token(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


async def current_user(authorization: str | None = Header(None)) -> dict:
    user = await asyncio.to_thread(auth.user_for_token, _token(authorization))
    if not user:
        raise HTTPException(401, "اول وارد شو.")
    return user


async def maybe_user(authorization: str | None = Header(None)) -> dict | None:
    return await asyncio.to_thread(auth.user_for_token, _token(authorization))


@app.get("/api/health")
async def health():
    ok = True
    try:
        await asyncio.to_thread(db.read, "RETURN 1 AS ok")
    except Exception:
        ok = False
    return {"ok": ok, "model": settings.openai_model, "ai_configured": bool(settings.openai_api_key)}


@app.get("/api/products/{product_id}")
async def product(product_id: str):
    p = await asyncio.to_thread(repo.get_product, product_id)
    if not p:
        raise HTTPException(404, "product not found")
    return p


@app.get("/api/products/{product_id}/stores")
async def stores(product_id: str, lat: float | None = None, lng: float | None = None, area: str | None = None,
                 pay: str | None = None, shop: str | None = None, user: dict | None = Depends(maybe_user)):
    r = await asyncio.to_thread(repo.stores_for_product, product_id, lat, lng, area, pay, shop)
    if r is None:
        raise HTTPException(404, "product not found")
    # Saved for the shops (why they were or were not recommended); never sent to the client.
    await asyncio.to_thread(insights.record_recommendation, user["id"] if user else None, product_id, r,
                            "shop_page" if shop else "stores")
    r.pop("_left_out", None)
    # Old price, unknown stock or a closed shop: ask the shop (its panel), and say so on each listed shop.
    await asyncio.to_thread(verify.annotate, r, user["id"] if user else None, shop)
    return r


@app.get("/api/areas")
async def areas():
    return {"city": "تهران", "areas": await asyncio.to_thread(repo.areas)}


class HistoryItem(BaseModel):
    role: str
    content: str


class Location(BaseModel):
    lat: float | None = None
    lng: float | None = None
    area: str | None = None


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[HistoryItem] = []
    attachments: list[str] = []
    location: Location | None = None


@app.post("/api/chat")
async def chat(req: ChatRequest, user: dict = Depends(current_user)):
    async def events():
        try:
            async for event in agent.run_turn(
                [h.model_dump() for h in req.history], req.message, req.attachments[:6],
                req.location.model_dump() if req.location else None,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
        except Exception:
            log.exception("chat turn failed")
            yield f"data: {json.dumps({'type': 'error', 'message': 'مشکلی پیش اومد. دوباره امتحان کن.'}, ensure_ascii=False)}\n\n"
            yield 'data: {"type": "done"}\n\n'

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class InquiryRequest(BaseModel):
    product_id: str = Field(min_length=1, max_length=64)
    shop_id: str = Field(min_length=1, max_length=64)


@app.post("/api/inquiries")
async def start_inquiry(req: InquiryRequest, user: dict = Depends(current_user)):
    """استعلام دستگاه: call the shop (while open), ask about stock, text the answer to the account's phone."""
    inquiry.stale()
    try:
        return await inquiry.start(req.product_id, req.shop_id, user["phone"], user["id"])
    except inquiry.InquiryError as e:
        raise HTTPException(e.status, e.message)


@app.post("/api/voip-test")
async def voip_test_start(dtmf: str | None = None, user: dict = Depends(current_user)):
    """Diagnostic: ring the account's own phone, ask for a few keys and #, report what reached the backend.
    dtmf=info|rfc2833 overrides VOIP_DTMF (info: keys as SIP INFO, rfc2833: keys inside the audio)."""
    return voiptest.start(user["phone"], dtmf)


@app.get("/api/voip-test/{test_id}")
async def voip_test_status(test_id: str, user: dict = Depends(current_user)):
    job = voiptest.get(test_id)
    if not job or job["phone"] != user["phone"]:
        raise HTTPException(404, "test not found")
    return {"id": job["id"], "status": job["status"], "report": job["report"]}


@app.get("/api/inquiries/{inquiry_id}")
async def inquiry_status(inquiry_id: str, user: dict = Depends(current_user)):
    job = inquiry.get(inquiry_id)
    if not job:
        raise HTTPException(404, "inquiry not found")
    return job


class OtpRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=20)


class OtpVerify(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    code: str = Field(min_length=4, max_length=8)


def _mobile(phone: str) -> str:
    m = inquiry.normalize_mobile(phone)
    if not m:
        raise HTTPException(422, "شماره موبایل درست نیست. مثل ۰۹۱۲۱۲۳۴۵۶۷ بنویس.")
    return m


@app.post("/api/auth/otp/request")
async def otp_request(req: OtpRequest):
    try:
        return await asyncio.to_thread(auth.request_code, _mobile(req.phone))
    except auth.AuthError as e:
        raise HTTPException(e.status, e.message)


@app.post("/api/auth/otp/verify")
async def otp_verify(req: OtpVerify):
    code = req.code.translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789"))
    try:
        return await asyncio.to_thread(auth.verify_code, _mobile(req.phone), code)
    except auth.AuthError as e:
        raise HTTPException(e.status, e.message)


@app.get("/api/me")
async def me(user: dict = Depends(current_user)):
    return {"phone": user["phone"], "settings": user["settings"], "roles": await asyncio.to_thread(roles.roles_for, user)}


class SettingsPatch(BaseModel):
    theme: str | None = None


@app.put("/api/me/settings")
async def put_settings(req: SettingsPatch, user: dict = Depends(current_user)):
    try:
        return {"settings": await asyncio.to_thread(auth.save_settings, user["id"], req.theme)}
    except auth.AuthError as e:
        raise HTTPException(e.status, e.message)


@app.post("/api/auth/logout")
async def logout(authorization: str | None = Header(None)):
    t = _token(authorization)
    if t:
        await asyncio.to_thread(auth.logout, t)
    return {"ok": True}


# Chat history on the account.
@app.get("/api/conversations")
async def conversations(user: dict = Depends(current_user)):
    return {"conversations": await asyncio.to_thread(history.list_for, user["id"])}


@app.get("/api/conversations/{conv_id}")
async def conversation(conv_id: str, user: dict = Depends(current_user)):
    c = await asyncio.to_thread(history.get, user["id"], conv_id)
    if not c:
        raise HTTPException(404, "conversation not found")
    return c


class ConversationBody(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=300)
    createdAt: int
    updatedAt: int
    messages: list[dict]


@app.put("/api/conversations/{conv_id}")
async def put_conversation(conv_id: str, body: ConversationBody, user: dict = Depends(current_user)):
    if body.id != conv_id:
        raise HTTPException(422, "id mismatch")
    await asyncio.to_thread(history.save, user["id"], body.model_dump())
    return {"ok": True}


@app.delete("/api/conversations/{conv_id}")
async def delete_conversation(conv_id: str, user: dict = Depends(current_user)):
    await asyncio.to_thread(history.delete, user["id"], conv_id)
    return {"ok": True}


# Store insights: where the user chose to buy, and (optionally) why. Saved only.
class StoreChoice(BaseModel):
    product_id: str = Field(min_length=1, max_length=64)
    offer_id: str = Field(min_length=1, max_length=64)
    recommended_offer_id: str | None = None
    lat: float | None = None
    lng: float | None = None
    user_said: str | None = Field(default=None, max_length=80)
    context: str = Field(default="", max_length=40)


@app.post("/api/store-events/choice")
async def store_choice(req: StoreChoice, user: dict = Depends(current_user)):
    return await asyncio.to_thread(insights.record_choice, user["id"], req.product_id, req.offer_id,
                                   req.recommended_offer_id, req.lat, req.lng, req.user_said, req.context)


# --- پنل مدیریت (admin.<domain>) ----------------------------------------------------------------------------

async def admin_user(user: dict = Depends(current_user)) -> dict:
    if not roles.is_admin(user):
        raise HTTPException(403, "این بخش فقط برای مدیرهاست.")
    return user


@app.get("/api/admin/overview")
async def admin_overview(days: int | None = 30, user: dict = Depends(admin_user)):
    return await asyncio.to_thread(admin.overview, days if days and days > 0 else None)


@app.get("/api/admin/totals")
async def admin_totals(user: dict = Depends(admin_user)):
    return await asyncio.to_thread(admin.totals)


@app.get("/api/admin/stores")
async def admin_stores(q: str | None = None, area: str | None = None, test: bool = False, page: int = 1,
                       user: dict = Depends(admin_user)):
    return await asyncio.to_thread(admin.stores, (q or "").strip() or None, area or None, test, max(1, page))


class HoursDay(BaseModel):
    status: str = "unknown"  # open | all_day | closed | unknown
    start: str = ""
    end: str = ""


class ShopForm(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    area: str = Field(default="", max_length=80)
    address: str = Field(default="", max_length=400)
    phones: list[str] = Field(default_factory=list, max_length=5)
    lat: float | None = Field(default=None, ge=35.4, le=36.0)
    lng: float | None = Field(default=None, ge=51.0, le=51.8)
    hours: dict[str, HoursDay] = Field(default_factory=dict)
    payments: list[str] = Field(default_factory=list, max_length=10)
    categories: list[str] = Field(default_factory=list, max_length=20)
    test: bool = False


@app.get("/api/admin/stores/{shop_id}")
async def admin_store(shop_id: str, user: dict = Depends(admin_user)):
    s = await asyncio.to_thread(admin.store, shop_id)
    if not s:
        raise HTTPException(404, "فروشگاه پیدا نشد.")
    return s


@app.post("/api/admin/stores")
async def admin_store_create(req: ShopForm, user: dict = Depends(admin_user)):
    sid = await asyncio.to_thread(catalog.save_shop, None, req.model_dump(), user["phone"])
    return {"id": sid}


@app.put("/api/admin/stores/{shop_id}")
async def admin_store_update(shop_id: str, req: ShopForm, user: dict = Depends(admin_user)):
    if not await asyncio.to_thread(admin.store, shop_id):
        raise HTTPException(404, "فروشگاه پیدا نشد.")
    await asyncio.to_thread(catalog.save_shop, shop_id, req.model_dump(), user["phone"])
    return {"id": shop_id}


class StaffIn(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    name: str = Field(default="", max_length=60)
    role: str = "staff"


@app.post("/api/admin/stores/{shop_id}/staff")
async def admin_staff_add(shop_id: str, req: StaffIn, user: dict = Depends(admin_user)):
    await asyncio.to_thread(admin.add_staff, shop_id, _mobile(req.phone), req.name, req.role, user["phone"])
    return {"ok": True}


@app.delete("/api/admin/stores/{shop_id}/staff/{phone}")
async def admin_staff_remove(shop_id: str, phone: str, user: dict = Depends(admin_user)):
    await asyncio.to_thread(admin.remove_staff, shop_id, _mobile(phone), user["phone"])
    return {"ok": True}


@app.get("/api/admin/offers")
async def admin_offers(q: str | None = None, shop: str | None = None, stale: bool = False, user: dict = Depends(admin_user)):
    return {"offers": await asyncio.to_thread(admin.offers, (q or "").strip() or None, shop or None, stale)}


class OfferPatch(BaseModel):
    price: int | None = Field(default=None, ge=1000, le=100_000_000_000)
    stock: str | None = None


async def _patch_offer(offer_id: str, req: OfferPatch, actor: str, source: str):
    try:
        return await asyncio.to_thread(catalog.update_offer, offer_id, req.price, req.stock, actor, source)
    except LookupError:
        raise HTTPException(404, "کالا پیدا نشد.")
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.patch("/api/admin/offers/{offer_id}")
async def admin_offer_patch(offer_id: str, req: OfferPatch, user: dict = Depends(admin_user)):
    return await _patch_offer(offer_id, req, user["phone"], "admin")


class ImportIn(BaseModel):
    text: str = Field(min_length=1, max_length=5_000_000)
    apply: bool = False


@app.post("/api/admin/import")
async def admin_import(req: ImportIn, user: dict = Depends(admin_user)):
    return await asyncio.to_thread(admin.import_prices, req.text, req.apply, user["phone"])


@app.get("/api/admin/changes")
async def admin_changes(user: dict = Depends(admin_user)):
    return {"changes": await asyncio.to_thread(admin.changes)}


# --- پنل فروشگاه: each shop's staff see only their own shop ----------------------------------------------

async def _shop_access(shop_id: str, user: dict) -> None:
    if not await asyncio.to_thread(roles.can_manage_shop, user, shop_id):
        raise HTTPException(403, "به پنل این فروشگاه دسترسی نداری.")


@app.get("/api/store/requests/{rid}")
async def store_request_any(rid: int, user: dict = Depends(current_user)):
    """A request by id alone (the follow-up SMS links here): finds its shop, then checks access."""
    row = await asyncio.to_thread(pg.one, "SELECT shop_id FROM verification_requests WHERE id = %s", (rid,))
    if not row:
        raise HTTPException(404, "درخواست پیدا نشد.")
    await _shop_access(row["shop_id"], user)
    return await asyncio.to_thread(verify.detail, row["shop_id"], rid)


@app.get("/api/store/{shop_id}/dashboard")
async def store_dashboard(shop_id: str, user: dict = Depends(current_user)):
    await _shop_access(shop_id, user)
    return await asyncio.to_thread(verify.dashboard, shop_id)


@app.get("/api/store/{shop_id}/requests")
async def store_requests(shop_id: str, status: str = "open", user: dict = Depends(current_user)):
    await _shop_access(shop_id, user)
    if status not in ("open", "all", "pending", "in_progress", "verified", "unavailable", "expired", "cancelled"):
        raise HTTPException(422, "bad status")
    return {"requests": await asyncio.to_thread(verify.list_requests, shop_id, status)}


@app.get("/api/store/{shop_id}/requests/{rid}")
async def store_request(shop_id: str, rid: int, user: dict = Depends(current_user)):
    await _shop_access(shop_id, user)
    r = await asyncio.to_thread(verify.detail, shop_id, rid)
    if not r:
        raise HTTPException(404, "درخواست پیدا نشد.")
    return r


@app.post("/api/store/{shop_id}/requests/{rid}/claim")
async def store_request_claim(shop_id: str, rid: int, user: dict = Depends(current_user)):
    await _shop_access(shop_id, user)
    return {"ok": await asyncio.to_thread(verify.claim, shop_id, rid, user["phone"])}


class ResolveIn(BaseModel):
    stock: str
    price: int | None = Field(default=None, ge=1000, le=100_000_000_000)
    note: str | None = Field(default=None, max_length=300)


@app.post("/api/store/{shop_id}/requests/{rid}/resolve")
async def store_request_resolve(shop_id: str, rid: int, req: ResolveIn, user: dict = Depends(current_user)):
    await _shop_access(shop_id, user)
    try:
        return await asyncio.to_thread(verify.resolve, shop_id, rid, user["phone"], req.stock, req.price, req.note)
    except LookupError:
        raise HTTPException(404, "درخواست پیدا نشد.")
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.get("/api/store/{shop_id}/offers")
async def store_offers(shop_id: str, q: str | None = None, stale: bool = False, user: dict = Depends(current_user)):
    await _shop_access(shop_id, user)
    return {"offers": await asyncio.to_thread(admin.offers, (q or "").strip() or None, shop_id, stale, 200)}


@app.patch("/api/store/{shop_id}/offers/{offer_id}")
async def store_offer_patch(shop_id: str, offer_id: str, req: OfferPatch, user: dict = Depends(current_user)):
    await _shop_access(shop_id, user)
    info = await asyncio.to_thread(catalog.offer_info, offer_id)
    if not info or info["shop_id"] != shop_id:
        raise HTTPException(404, "کالا پیدا نشد.")
    out = await _patch_offer(offer_id, req, user["phone"], "store")
    if req.stock:  # answers an open request for this offer too
        await asyncio.to_thread(verify.resolve_by_offer, offer_id, req.stock, req.price, user["phone"])
    return out
