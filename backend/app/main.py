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

from . import agent, auth, db, history, insights, inquiry, netprobe, pg, repo, test_shop, voiptest
from .config import settings

log = logging.getLogger("torob-chat")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logging.getLogger("neo4j").setLevel(logging.ERROR)  # "property does not exist" notices


async def _seed_test_shop() -> None:
    try:
        await asyncio.to_thread(test_shop.add)
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
    yield
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
    return {"phone": user["phone"], "settings": user["settings"]}


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
