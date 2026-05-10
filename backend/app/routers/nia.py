"""Nia search router — exposes Nia's agentic /v2/query to the frontend."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.database import get_db
from app.services import nia as nia_service
from app.services.auth import get_optional_user_id

router = APIRouter()


class NiaSearchRequest(BaseModel):
    query: str
    location: str | None = None


class NiaSearchResponse(BaseModel):
    results: list[dict]
    answer: str
    query_time_ms: int
    sources_searched: int
    retrieval_log_id: str | None = None
    live: bool


@router.post("/nia/search", response_model=NiaSearchResponse)
async def nia_search(
    req: NiaSearchRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(get_optional_user_id),
):
    """Search Nia's /v2/query oracle for negotiation-relevant pricing context."""
    payload = await nia_service.search_pricing_context(
        req.query, location=req.location,
    )
    return NiaSearchResponse(
        results=payload.get("results") or [],
        answer=payload.get("answer") or "",
        query_time_ms=payload.get("query_time_ms") or 0,
        sources_searched=payload.get("sources_searched") or 0,
        retrieval_log_id=payload.get("retrieval_log_id"),
        live=bool(payload.get("live")),
    )
