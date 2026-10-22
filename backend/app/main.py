"""FastAPI app for Torob Chat. Run: ../.venv/bin/uvicorn app.main:app --reload --port 8000 (from backend/)."""
import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import agent, db, inquiry, repo
from .config import settings

log = logging.getLogger("torob-chat")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logging.getLogger("neo4j").setLevel(logging.ERROR)  # "property does not exist" notices


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    db.close()


app = FastAPI(title="Torob Chat API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    ok = True
    try:
        await asyncio.to_thread(db.read, "RETURN 1 AS ok")
    except Exception:
        ok = False
    return {"ok": ok, "model": settings.openai_model, "ai_configured": bool(settings.openai_api_key)}


@app.get("/api/search/live")
async def live_search(q: str = Query("", max_length=120)):
    if len(q.strip()) < 2:
        return {"query": q, "place": None, "products": []}
    return await asyncio.to_thread(repo.live_search, q)


@app.get("/api/products/{product_id}")
async def product(product_id: str):
    p = await asyncio.to_thread(repo.get_product, product_id)
    if not p:
        raise HTTPException(404, "product not found")
    return p


@app.get("/api/products/{product_id}/stores")
async def stores(product_id: str, lat: float | None = None, lng: float | None = None, area: str | None = None,
                 pay: str | None = None, shop: str | None = None):
    r = await asyncio.to_thread(repo.stores_for_product, product_id, lat, lng, area, pay, shop)
    if r is None:
        raise HTTPException(404, "product not found")
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
async def chat(req: ChatRequest):
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
    phone: str = Field(min_length=10, max_length=20)


@app.post("/api/inquiries")
async def start_inquiry(req: InquiryRequest):
    """استعلام دستگاه: call the shop (while open), ask about stock, text the user the answer."""
    inquiry.stale()
    try:
        return await inquiry.start(req.product_id, req.shop_id, req.phone)
    except inquiry.InquiryError as e:
        raise HTTPException(e.status, e.message)


@app.get("/api/inquiries/{inquiry_id}")
async def inquiry_status(inquiry_id: str):
    job = inquiry.get(inquiry_id)
    if not job:
        raise HTTPException(404, "inquiry not found")
    return job
