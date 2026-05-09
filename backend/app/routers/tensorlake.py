"""Tensorlake router -- background price monitoring sandboxes."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.database import get_session as get_db
from app.services import tensorlake as tensorlake_service
from app.services.auth import get_optional_user_id

router = APIRouter()


class CreateMonitorRequest(BaseModel):
    query: str
    check_interval_minutes: int = 60


class MonitorResponse(BaseModel):
    id: str | None
    query: str
    status: str
    mode: str


class ListMonitorsResponse(BaseModel):
    monitors: list[dict]
    mode: str


@router.post("/tensorlake/monitors", response_model=MonitorResponse)
async def create_monitor(
    req: CreateMonitorRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(get_optional_user_id),
):
    """Create a background price monitor in a Tensorlake sandbox."""
    result = await tensorlake_service.create_monitor(
        query=req.query,
        check_interval_minutes=req.check_interval_minutes,
        user_id=user_id,
    )
    return MonitorResponse(**result)


@router.get("/tensorlake/monitors", response_model=ListMonitorsResponse)
async def list_monitors(
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(get_optional_user_id),
):
    """List all active Tensorlake price monitors."""
    result = await tensorlake_service.list_monitors(user_id=user_id)
    return ListMonitorsResponse(**result)


@router.delete("/tensorlake/monitors/{monitor_id}")
async def delete_monitor(
    monitor_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(get_optional_user_id),
):
    """Stop and delete a Tensorlake price monitor."""
    result = await tensorlake_service.delete_monitor(monitor_id)
    return result
