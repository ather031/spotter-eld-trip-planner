"""Geocoding via Nominatim (OpenStreetMap) with Photon fallback."""

from __future__ import annotations

import logging
import math
import re
from dataclasses import asdict, dataclass
from typing import Any

from django.conf import settings

from trips.services.http import MapServiceError, http_get_json

logger = logging.getLogger(__name__)

# "41.8781, -87.6298" or "41.8781,-87.6298"
_COORD_RE = re.compile(
    r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$"
)


@dataclass(frozen=True)
class GeoPoint:
    lat: float
    lon: float
    display_name: str
    source: str = "input"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def haversine_miles(a: GeoPoint, b: GeoPoint) -> float:
    """Great-circle distance in miles."""
    r = 3958.7613
    lat1, lon1 = math.radians(a.lat), math.radians(a.lon)
    lat2, lon2 = math.radians(b.lat), math.radians(b.lon)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def parse_coordinates(value: str) -> GeoPoint | None:
    match = _COORD_RE.match(value)
    if not match:
        return None
    lat = float(match.group(1))
    lon = float(match.group(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return GeoPoint(
        lat=lat,
        lon=lon,
        display_name=f"{lat:.5f}, {lon:.5f}",
        source="coordinates",
    )


def geocode(query: str | dict[str, Any]) -> GeoPoint:
    """
    Resolve a location string, coordinate pair, or {lat, lon[, label]} dict.
    """
    if isinstance(query, dict):
        try:
            lat = float(query["lat"])
            lon = float(query["lon"])
        except (KeyError, TypeError, ValueError) as exc:
            raise MapServiceError(
                "Location objects must include numeric lat and lon.",
                status_code=400,
            ) from exc
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise MapServiceError("lat/lon out of range.", status_code=400)
        label = str(query.get("label") or query.get("display_name") or f"{lat:.5f}, {lon:.5f}")
        return GeoPoint(lat=lat, lon=lon, display_name=label, source="coordinates")

    text = (query or "").strip()
    if not text:
        raise MapServiceError("Location is required.", status_code=400)

    coords = parse_coordinates(text)
    if coords is not None:
        return coords

    try:
        return _geocode_nominatim(text)
    except MapServiceError as primary:
        logger.info("Nominatim failed for %r (%s); trying Photon", text, primary)
        try:
            return _geocode_photon(text)
        except MapServiceError:
            raise MapServiceError(
                f"Could not geocode location: {text!r}. "
                "Try a clearer address or 'lat,lon' coordinates.",
                status_code=400,
            ) from primary


def search_places(query: str, *, limit: int = 8) -> list[dict[str, Any]]:
    """
    Autocomplete lookup for the UI. Returns up to `limit` candidates.

    Prefers Nominatim; falls back to Photon. No deep pagination — free
    geocoders are rate-limited; a short ranked list is the reliable UX.
    """
    text = (query or "").strip()
    if len(text) < 2:
        return []

    coords = parse_coordinates(text)
    if coords is not None:
        return [
            {
                "display_name": coords.display_name,
                "lat": coords.lat,
                "lon": coords.lon,
                "source": "coordinates",
            }
        ]

    limit = max(1, min(int(limit), 10))

    try:
        return _search_nominatim(text, limit=limit)
    except MapServiceError:
        logger.info("Nominatim search failed for %r; trying Photon", text)
        return _search_photon(text, limit=limit)


def _search_nominatim(query: str, *, limit: int) -> list[dict[str, Any]]:
    base = getattr(settings, "NOMINATIM_BASE_URL", "https://nominatim.openstreetmap.org")
    data = http_get_json(
        f"{base.rstrip('/')}/search",
        params={
            "q": query,
            "format": "json",
            "limit": limit,
            "addressdetails": 0,
        },
    )
    if not isinstance(data, list):
        raise MapServiceError("Nominatim search returned invalid payload.", status_code=502)
    out: list[dict[str, Any]] = []
    for hit in data:
        try:
            out.append(
                {
                    "display_name": str(hit.get("display_name") or query),
                    "lat": float(hit["lat"]),
                    "lon": float(hit["lon"]),
                    "source": "nominatim",
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    return out


def _search_photon(query: str, *, limit: int) -> list[dict[str, Any]]:
    base = getattr(settings, "PHOTON_BASE_URL", "https://photon.komoot.io")
    data = http_get_json(
        f"{base.rstrip('/')}/api/",
        params={"q": query, "limit": limit},
    )
    features = data.get("features") if isinstance(data, dict) else None
    if not features:
        return []
    out: list[dict[str, Any]] = []
    for feat in features:
        try:
            coords = feat.get("geometry", {}).get("coordinates") or []
            if len(coords) < 2:
                continue
            lon, lat = float(coords[0]), float(coords[1])
            props = feat.get("properties") or {}
            name = props.get("name") or query
            city = props.get("city") or props.get("county") or ""
            state = props.get("state") or ""
            country = props.get("country") or ""
            parts = [p for p in (name, city, state, country) if p]
            display = ", ".join(dict.fromkeys(parts)) or query
            out.append(
                {
                    "display_name": display,
                    "lat": lat,
                    "lon": lon,
                    "source": "photon",
                }
            )
        except (TypeError, ValueError, KeyError):
            continue
    return out


def _geocode_nominatim(query: str) -> GeoPoint:
    base = getattr(settings, "NOMINATIM_BASE_URL", "https://nominatim.openstreetmap.org")
    data = http_get_json(
        f"{base.rstrip('/')}/search",
        params={
            "q": query,
            "format": "json",
            "limit": 1,
            "addressdetails": 0,
        },
    )
    if not isinstance(data, list) or not data:
        raise MapServiceError(f"Nominatim found no results for {query!r}.", status_code=400)
    hit = data[0]
    return GeoPoint(
        lat=float(hit["lat"]),
        lon=float(hit["lon"]),
        display_name=str(hit.get("display_name") or query),
        source="nominatim",
    )


def _geocode_photon(query: str) -> GeoPoint:
    base = getattr(settings, "PHOTON_BASE_URL", "https://photon.komoot.io")
    data = http_get_json(
        f"{base.rstrip('/')}/api/",
        params={"q": query, "limit": 1},
    )
    features = data.get("features") if isinstance(data, dict) else None
    if not features:
        raise MapServiceError(f"Photon found no results for {query!r}.", status_code=400)
    feat = features[0]
    coords = feat.get("geometry", {}).get("coordinates") or []
    if len(coords) < 2:
        raise MapServiceError("Photon returned incomplete geometry.", status_code=502)
    lon, lat = float(coords[0]), float(coords[1])
    props = feat.get("properties") or {}
    name = props.get("name") or query
    city = props.get("city") or props.get("county") or ""
    state = props.get("state") or ""
    country = props.get("country") or ""
    parts = [p for p in (name, city, state, country) if p]
    display = ", ".join(dict.fromkeys(parts))  # preserve order, drop dupes
    return GeoPoint(lat=lat, lon=lon, display_name=display or query, source="photon")
