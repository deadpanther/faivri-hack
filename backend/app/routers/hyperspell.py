"""Hyperspell router -- durable negotiation memory across sessions."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.database import get_db
from app.services import hyperspell as hyperspell_service
from app.services.auth import get_optional_user_id

router = APIRouter()


class HyperspellStoreRequest(BaseModel):
    content: str
    metadata: dict | None = None


class HyperspellQueryRequest(BaseModel):
    query: str
    limit: int = 5


class HyperspellStoreResponse(BaseModel):
    id: str | None
    mode: str


class HyperspellQueryResponse(BaseModel):
    results: list[dict]
    mode: str
    query: str


@router.post("/hyperspell/memories", response_model=HyperspellStoreResponse)
async def store_memory(
    req: HyperspellStoreRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(get_optional_user_id),
):
    """Store a negotiation memory in Hyperspell."""
    memory_id = await hyperspell_service.store_negotiation_memory(
        user_id=user_id or "anonymous",
        content=req.content,
        metadata=req.metadata,
    )
    mode = "live" if hyperspell_service.HYPERSPELL_API_KEY else "simulation"
    return HyperspellStoreResponse(id=memory_id, mode=mode)


@router.post("/hyperspell/query", response_model=HyperspellQueryResponse)
async def query_memory(
    req: HyperspellQueryRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(get_optional_user_id),
):
    """Query negotiation memories from Hyperspell."""
    results = await hyperspell_service.query_negotiation_memory(
        user_id=user_id or "anonymous",
        query=req.query,
    )
    mode = "live" if hyperspell_service.HYPERSPELL_API_KEY else "simulation"
    return HyperspellQueryResponse(results=results, mode=mode, query=req.query)


@router.delete("/hyperspell/memories/{memory_id}")
async def delete_memory(
    memory_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(get_optional_user_id),
):
    """Delete a negotiation memory from Hyperspell."""
    return {"status": "deleted", "memory_id": memory_id, "mode": "simulation"}
