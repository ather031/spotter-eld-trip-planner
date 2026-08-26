"""Driving directions via the public OSRM demo server."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any

from django.conf import settings

from trips.services.geocoding import GeoPoint
from trips.services.http import MapServiceError, http_get_json

METERS_PER_MILE = 1609.344


@dataclass(frozen=True)
class RouteLegResult:
    distance_miles: float
    duration_hours: float
    from_label: str
    to_label: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class RouteResult:
    """Full multi-stop driving route."""

    geometry: list[list[float]]  # [[lat, lon], ...] for Leaflet
    distance_miles: float
    duration_hours: float
    legs: list[RouteLegResult]
    provider: str = "osrm"

    def to_dict(self) -> dict[str, Any]:
        return {
            "geometry": self.geometry,
            "distance_miles": round(self.distance_miles, 2),
            "duration_hours": round(self.duration_hours, 3),
            "legs": [leg.to_dict() for leg in self.legs],
            "provider": self.provider,
        }


def route_driving(points: list[GeoPoint], *, labels: list[str] | None = None) -> RouteResult:
    """
    Route through an ordered list of waypoints (lon,lat for OSRM).

    Uses car profile — not truck-restricted. Documented approximation.
    """
    if len(points) < 2:
        raise MapServiceError("Routing requires at least two waypoints.", status_code=400)

    labels = labels or [p.display_name for p in points]
    if len(labels) != len(points):
        raise MapServiceError("labels length must match points.", status_code=400)

    base = getattr(settings, "OSRM_BASE_URL", "https://router.project-osrm.org")
    coords = ";".join(f"{p.lon:.6f},{p.lat:.6f}" for p in points)
    url = f"{base.rstrip('/')}/route/v1/driving/{coords}"
    data = http_get_json(
        url,
        params={
            "overview": "full",
            "geometries": "geojson",
            "steps": "false",
        },
    )

    if not isinstance(data, dict) or data.get("code") != "Ok":
        code = str(data.get("code") if isinstance(data, dict) else "Unknown")
        message = ""
        if isinstance(data, dict):
            message = str(data.get("message") or "")
        if code == "NoRoute" or "Impossible route" in message:
            raise MapServiceError(
                "No driving route exists between these locations. "
                "They may be on different continents or otherwise unreachable by road. "
                "Please choose places connected by the road network.",
                status_code=400,
                code="no_route",
            )
        if code == "NoSegment":
            raise MapServiceError(
                "One of the locations could not be matched to a nearby road. "
                "Try a clearer city or street address.",
                status_code=400,
                code="no_segment",
            )
        raise MapServiceError(
            f"Could not build a driving route between the selected locations ({code}). "
            "Try different places from the suggestions list.",
            status_code=400,
            code="route_failed",
        )

    routes = data.get("routes") or []
    if not routes:
        raise MapServiceError(
            "No driving route was returned for these locations. Try different places.",
            status_code=400,
            code="no_route",
        )

    route = routes[0]
    geometry_geojson = route.get("geometry") or {}
    coordinates = geometry_geojson.get("coordinates") or []
    # GeoJSON is [lon, lat] → Leaflet wants [lat, lon]
    geometry = [[float(lat), float(lon)] for lon, lat in coordinates]

    osrm_legs = route.get("legs") or []
    if len(osrm_legs) != len(points) - 1:
        # Still usable if totals exist; synthesize single leg
        pass

    legs: list[RouteLegResult] = []
    for i, leg in enumerate(osrm_legs):
        dist_m = float(leg.get("distance") or 0.0)
        dur_s = float(leg.get("duration") or 0.0)
        legs.append(
            RouteLegResult(
                distance_miles=dist_m / METERS_PER_MILE,
                duration_hours=dur_s / 3600.0,
                from_label=labels[i],
                to_label=labels[i + 1],
            )
        )

    total_m = float(route.get("distance") or sum(l.distance_miles * METERS_PER_MILE for l in legs))
    total_s = float(route.get("duration") or sum(l.duration_hours * 3600.0 for l in legs))

    if not geometry and len(points) >= 2:
        # Extremely rare; fall back to straight lines between waypoints
        geometry = [[p.lat, p.lon] for p in points]

    return RouteResult(
        geometry=geometry,
        distance_miles=total_m / METERS_PER_MILE,
        duration_hours=total_s / 3600.0,
        legs=legs,
        provider="osrm",
    )


def point_along_route(geometry: list[list[float]], miles_from_start: float) -> list[float]:
    """
    Interpolate [lat, lon] at a distance along the polyline.

    geometry: [[lat, lon], ...]
    """
    if not geometry:
        return [0.0, 0.0]
    if len(geometry) == 1 or miles_from_start <= 0:
        return list(geometry[0])

    target = max(0.0, miles_from_start)
    traveled = 0.0
    for i in range(1, len(geometry)):
        a = geometry[i - 1]
        b = geometry[i]
        seg = _segment_miles(a, b)
        if traveled + seg >= target or i == len(geometry) - 1:
            if seg < 1e-9:
                return list(b)
            t = (target - traveled) / seg if seg > 0 else 0.0
            t = max(0.0, min(1.0, t))
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        traveled += seg
    return list(geometry[-1])


def _segment_miles(a: list[float], b: list[float]) -> float:
    """Haversine between [lat,lon] pairs."""
    r = 3958.7613
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))
