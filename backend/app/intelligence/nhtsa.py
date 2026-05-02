"""NHTSA free API client — recalls and complaints for US vehicles."""

import httpx

NHTSA_RECALLS_URL = "https://api.nhtsa.dot.gov/recalls/recallsByVehicle"
NHTSA_COMPLAINTS_URL = "https://api.nhtsa.dot.gov/complaints/complaintsByVehicle"


async def get_recalls(make: str, model: str, year: int) -> list[dict]:
    """Get open recalls for a vehicle from NHTSA."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(
                NHTSA_RECALLS_URL,
                params={"make": make, "model": model, "modelYear": year},
            )
            response.raise_for_status()
            data = response.json()
            results = data.get("results", [])
            return [
                {
                    "component": r.get("Component", ""),
                    "summary": r.get("Summary", ""),
                    "consequence": r.get("Consequence", ""),
                    "remedy": r.get("Remedy", ""),
                    "report_date": r.get("ReportReceivedDate", ""),
                }
                for r in results[:5]
            ]
        except Exception:
            return []


async def get_complaints(make: str, model: str, year: int) -> list[dict]:
    """Get common complaints for a vehicle from NHTSA."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(
                NHTSA_COMPLAINTS_URL,
                params={"make": make, "model": model, "modelYear": year},
            )
            response.raise_for_status()
            data = response.json()
            results = data.get("results", [])
            return [
                {
                    "component": r.get("components", ""),
                    "summary": r.get("summary", ""),
                    "crash": r.get("crash", False),
                    "fire": r.get("fire", False),
                    "date": r.get("dateComplaintFiled", ""),
                }
                for r in results[:10]
            ]
        except Exception:
            return []
