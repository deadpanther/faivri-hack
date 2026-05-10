"""
S2 Geometry-based location service.

Uses Google's S2 cell system for geohashing:
- Level 10 cell (~10km) for city-level grouping
- Level 14 cell (~500m) for neighborhood-level
- No hardcoded city lists — works anywhere on Earth

Frontend sends lat/lng silently (no user prompt).
Backend converts to S2 cell token + reverse-geocodes for display name.
"""

import logging

import s2sphere
import httpx

logger = logging.getLogger(__name__)


def lat_lng_to_s2_token(lat: float, lng: float, level: int = 10) -> str:
    """Convert lat/lng to an S2 cell token at the given level.

    Level 10 ≈ 10km (city-level)
    Level 14 ≈ 500m (neighborhood-level)
    """
    ll = s2sphere.LatLng.from_degrees(lat, lng)
    cell_id = s2sphere.CellId.from_lat_lng(ll).parent(level)
    return cell_id.to_token()


def s2_token_to_lat_lng(token: str) -> tuple[float, float]:
    """Convert S2 token back to lat/lng (cell center)."""
    cell_id = s2sphere.CellId.from_token(token)
    ll = cell_id.to_lat_lng()
    return ll.lat().degrees, ll.lng().degrees


def s2_tokens_nearby(lat: float, lng: float, level: int = 10) -> list[str]:
    """Get S2 tokens for the cell and its immediate neighbors.

    Useful for finding nearby community prices / vendors.
    """
    ll = s2sphere.LatLng.from_degrees(lat, lng)
    cell_id = s2sphere.CellId.from_lat_lng(ll).parent(level)
    neighbors = []
    for edge in range(4):
        neighbors.append(cell_id.get_edge_neighbors()[edge].to_token())
    return [cell_id.to_token()] + neighbors


async def reverse_geocode(lat: float, lng: float) -> dict:
    """Reverse-geocode lat/lng to city, country, region.

    Uses free BigDataCloud API (no key needed).
    Returns: { city, country_code, country_name, region }
    """
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            res = await client.get(
                "https://api.bigdatacloud.net/data/reverse-geocode-client",
                params={"latitude": lat, "longitude": lng, "localityLanguage": "en"},
            )
            res.raise_for_status()
            data = res.json()
            return {
                "city": data.get("city") or data.get("locality") or "Unknown",
                "country_code": data.get("countryCode", ""),
                "country_name": data.get("countryName", ""),
                "region": data.get("principalSubdivision", ""),
            }
        except httpx.TimeoutException:
            logger.warning("Reverse geocode timed out for lat=%.4f, lng=%.4f", lat, lng)
            return {
                "city": "Unknown",
                "country_code": "",
                "country_name": "",
                "region": "",
            }
        except Exception as e:
            logger.warning("Reverse geocode failed for lat=%.4f, lng=%.4f: %s", lat, lng, str(e))
            return {
                "city": "Unknown",
                "country_code": "",
                "country_name": "",
                "region": "",
            }
