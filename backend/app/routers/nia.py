"""Nia search router -- exposes Nia's agentic search to the frontend."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.database import get_db
from app.services import nia as nia_service
from app.services.auth import get_optional_user_id

router = APIRouter()


class NiaSearchRequest(BaseModel):
    query: str


class NiaSearchResponse(BaseModel):
    results: list[dict]
    mode: str
    query: str


@router.post("/nia/search", response_model=NiaSearchResponse)
async def nia_search(
    req: NiaSearchRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(get_optional_user_id),
):
    """Search Nia for pricing context."""
    result = await nia_service.search_pricing_context(req.query)
    return NiaSearchResponse(**result)
