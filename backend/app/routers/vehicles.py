"""Vehicle profiles + predictive maintenance."""

import logging
import uuid
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.models.db import Vehicle
from app.services.database import get_db
from app.services.auth import require_user_id
from app.services.limiter import limiter, RATE_LIMIT_VEHICLES_WRITE
from app.services.market import DEFAULT_COUNTRY, enforce_supported_country

logger = logging.getLogger(__name__)

router = APIRouter()

# Maintenance schedule: (service, interval_km, interval_months, typical cost description)
MAINTENANCE_SCHEDULE = {
    "oil_change": {"interval_km": 10000, "interval_months": 6, "label": "Engine Oil Change"},
    "air_filter": {"interval_km": 20000, "interval_months": 12, "label": "Air Filter Replacement"},
    "brake_inspection": {"interval_km": 20000, "interval_months": 12, "label": "Brake Inspection"},
    "brake_pads": {"interval_km": 40000, "interval_months": 24, "label": "Brake Pad Replacement"},
    "spark_plugs": {"interval_km": 40000, "interval_months": 36, "label": "Spark Plug Replacement"},
    "timing_belt": {"interval_km": 60000, "interval_months": 48, "label": "Timing Belt Replacement"},
    "coolant_flush": {"interval_km": 40000, "interval_months": 24, "label": "Coolant Flush"},
    "transmission_fluid": {"interval_km": 60000, "interval_months": 48, "label": "Transmission Fluid Change"},
    "battery": {"interval_km": 50000, "interval_months": 36, "label": "Battery Replacement"},
    "tire_rotation": {"interval_km": 10000, "interval_months": 6, "label": "Tire Rotation & Balance"},
}


_NEXT_YEAR = datetime.utcnow().year + 1


class VehicleCreate(BaseModel):
    """Owner-facing vehicle profile.

    Bounds: year within the automotive era (1900) through next calendar
    year (covers pre-orders) and mileage up to 2M km (past any plausible
    odometer). Prevents negative / overflow values from poisoning the
    maintenance schedule math downstream.
    """
    make: str = Field(..., min_length=1, max_length=80)
    model: str = Field(..., min_length=1, max_length=80)
    year: Optional[int] = Field(None, ge=1900, le=_NEXT_YEAR)
    mileage_km: Optional[int] = Field(None, ge=0, le=2_000_000)
    nickname: Optional[str] = Field(None, max_length=80)
    country: str = DEFAULT_COUNTRY


class VehicleUpdate(BaseModel):
    mileage_km: Optional[int] = Field(None, ge=0, le=2_000_000)
    nickname: Optional[str] = Field(None, max_length=80)


@router.get("/vehicles")
async def list_vehicles(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """List vehicles owned by the current user."""
    query = (
        select(Vehicle)
        .where(Vehicle.user_id == user_id)
        .order_by(Vehicle.created_at.desc())
    )
    result = await db.execute(query)
    vehicles = result.scalars().all()
    return [_vehicle_to_dict(v) for v in vehicles]


@router.post("/vehicles")
@limiter.limit(RATE_LIMIT_VEHICLES_WRITE)
async def create_vehicle(
    request: Request,
    req: VehicleCreate,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Register a new vehicle owned by the current user."""
    try:
        validated_country = enforce_supported_country(req.country)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    vehicle = Vehicle(
        id=str(uuid.uuid4()),
        user_id=user_id,
        make=req.make,
        model=req.model,
        year=req.year,
        mileage_km=req.mileage_km,
        nickname=req.nickname,
        country=validated_country,
        created_at=datetime.utcnow(),
    )
    db.add(vehicle)
    await db.commit()
    return _vehicle_to_dict(vehicle)


@router.get("/vehicles/{vehicle_id}/maintenance")
async def get_maintenance_schedule(
    vehicle_id: UUID,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Get predictive maintenance schedule for a vehicle owned by the current user."""
    result = await db.execute(
        select(Vehicle).where(
            Vehicle.id == vehicle_id,
            Vehicle.user_id == user_id,
        )
    )
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    mileage = vehicle.mileage_km or 0
    alerts = []

    for service_key, schedule in MAINTENANCE_SCHEDULE.items():
        interval = schedule["interval_km"]
        if interval == 0:
            continue

        # How many intervals have passed
        intervals_passed = mileage // interval
        next_due_km = (intervals_passed + 1) * interval
        km_until_due = next_due_km - mileage
        overdue = km_until_due <= 0

        status = "overdue" if overdue else "upcoming" if km_until_due < 2000 else "ok"

        alerts.append({
            "service": service_key,
            "label": schedule["label"],
            "interval_km": interval,
            "next_due_km": next_due_km,
            "km_until_due": max(0, km_until_due),
            "status": status,
            "query_hint": f"{schedule['label']} for {vehicle.make} {vehicle.model}" + (f" {vehicle.year}" if vehicle.year else ""),
        })

    # Sort: overdue first, then upcoming, then ok
    priority = {"overdue": 0, "upcoming": 1, "ok": 2}
    alerts.sort(key=lambda a: (priority.get(a["status"], 2), a["km_until_due"]))

    return {
        "vehicle": _vehicle_to_dict(vehicle),
        "maintenance": alerts,
    }


def _vehicle_to_dict(v: Vehicle) -> dict:
    return {
        "id": str(v.id),
        "make": v.make,
        "model": v.model,
        "year": v.year,
        "mileage_km": v.mileage_km,
        "nickname": v.nickname,
        "country": v.country,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }
