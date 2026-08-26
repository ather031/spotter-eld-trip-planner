"""Orchestrate geocode → route → HOS plan into an API payload."""

from __future__ import annotations

from typing import Any

from django.conf import settings

from hos import DEFAULT_SPEED_MPH, NEAR_ZERO_MILES, plan_trip
from trips.services.geocoding import GeoPoint, geocode, haversine_miles
from trips.services.http import MapServiceError
from trips.services.routing import point_along_route, route_driving


def plan_trip_from_locations(
    *,
    current_location: str | dict[str, Any],
    pickup_location: str | dict[str, Any],
    dropoff_location: str | dict[str, Any],
    cycle_used_hours: float,
    start_hour_of_day: float = 6.0,
) -> dict[str, Any]:
    current = geocode(current_location)
    pickup = geocode(pickup_location)
    dropoff = geocode(dropoff_location)

    if haversine_miles(pickup, dropoff) < NEAR_ZERO_MILES:
        raise MapServiceError(
            "Pickup and dropoff are too close to plan a loaded haul. "
            "Choose distinct locations.",
            status_code=400,
        )

    # Prefer road distance when available; use haversine only for near-zero skip.
    straight_deadhead = haversine_miles(current, pickup)
    skip_deadhead = straight_deadhead < NEAR_ZERO_MILES

    warnings: list[str] = []
    if skip_deadhead:
        warnings.append(
            "Current location ≈ pickup; deadhead leg skipped for routing and HOS."
        )
        waypoints = [pickup, dropoff]
        labels = ["Pickup", "Dropoff"]
    else:
        waypoints = [current, pickup, dropoff]
        labels = ["Current", "Pickup", "Dropoff"]

    route = route_driving(waypoints, labels=labels)

    if skip_deadhead:
        deadhead_miles = 0.0
        deadhead_hours = 0.0
        if not route.legs:
            raise MapServiceError("Routing returned no legs for pickup→dropoff.")
        loaded_miles, loaded_hours = _normalize_leg(
            route.legs[0].distance_miles,
            route.legs[0].duration_hours,
            label="pickup→dropoff",
        )
    else:
        if len(route.legs) < 2:
            raise MapServiceError(
                "Routing returned incomplete legs for current→pickup→dropoff."
            )
        deadhead_miles, deadhead_hours = _normalize_leg(
            route.legs[0].distance_miles,
            route.legs[0].duration_hours,
            label="current→pickup",
            allow_near_zero=True,
        )
        loaded_miles, loaded_hours = _normalize_leg(
            route.legs[1].distance_miles,
            route.legs[1].duration_hours,
            label="pickup→dropoff",
        )

    if loaded_miles < NEAR_ZERO_MILES:
        raise MapServiceError(
            "Routed loaded distance is effectively zero. "
            "Pickup and dropoff may be too close on the road network.",
            status_code=400,
        )

    # If OSRM deadhead collapsed to ~0 (one-way streets / snap), treat as skip.
    if not skip_deadhead and deadhead_miles < NEAR_ZERO_MILES:
        warnings.append(
            "Routed deadhead is under 1 mile; treating current ≈ pickup for HOS."
        )
        deadhead_miles = 0.0
        deadhead_hours = 0.0

    hos = plan_trip(
        deadhead_miles=deadhead_miles,
        deadhead_hours=deadhead_hours,
        loaded_miles=loaded_miles,
        loaded_hours=loaded_hours,
        cycle_used_hours=cycle_used_hours,
        start_hour_of_day=start_hour_of_day,
    )

    # Merge planner warnings with routing notes (avoid dup deadhead messages)
    merged_warnings = list(dict.fromkeys([*warnings, *hos.warnings]))

    stops = _enrich_stops(
        hos_stops=[s.to_dict() for s in hos.stops],
        geometry=route.geometry,
        current=current,
        pickup=pickup,
        dropoff=dropoff,
    )

    return {
        "locations": {
            "current": current.to_dict(),
            "pickup": pickup.to_dict(),
            "dropoff": dropoff.to_dict(),
        },
        "route": route.to_dict(),
        "stops": stops,
        "events": [e.to_dict() for e in hos.events],
        "day_segments": [d.to_dict() for d in hos.day_segments],
        "summary": hos.summary.to_dict() if hos.summary else None,
        "warnings": merged_warnings,
        "meta": {
            "hos_profile": "property_carrying_70_8",
            "routing_note": (
                "OSRM car profile (free). Not truck-restricted; road class "
                "and bridge/height limits are approximate."
            ),
            "fuel_interval_miles": 1000,
            "pickup_on_duty_hours": 1,
            "dropoff_on_duty_hours": 1,
            "average_speed_note": "Leg durations come from OSRM; HOS clocks use those hours.",
            "map_provider": getattr(settings, "MAP_TILE_ATTRIBUTION", "© OpenStreetMap"),
            "start_hour_of_day": start_hour_of_day,
        },
    }


def _normalize_leg(
    miles: float,
    hours: float,
    *,
    label: str,
    allow_near_zero: bool = False,
) -> tuple[float, float]:
    """Ensure miles/hours are finite and consistent; derive missing duration."""
    if miles != miles or hours != hours:  # NaN
        raise MapServiceError(f"Invalid route metrics for {label}.", status_code=502)
    if miles < 0 or hours < 0:
        raise MapServiceError(f"Negative route metrics for {label}.", status_code=502)

    miles = float(miles)
    hours = float(hours)

    if miles < NEAR_ZERO_MILES:
        if allow_near_zero:
            return 0.0, 0.0
        raise MapServiceError(
            f"Routed distance for {label} is effectively zero.",
            status_code=400,
        )

    if hours <= 1e-6:
        hours = miles / DEFAULT_SPEED_MPH

    # Guard absurd implied speeds (bad snaps) — clamp duration to a sane band
    implied = miles / hours if hours > 0 else 0.0
    if implied > 80:
        hours = miles / 55.0
    elif implied < 5 and miles > 5:
        hours = miles / 55.0

    return miles, hours


def _enrich_stops(
    *,
    hos_stops: list[dict[str, Any]],
    geometry: list[list[float]],
    current: GeoPoint,
    pickup: GeoPoint,
    dropoff: GeoPoint,
) -> list[dict[str, Any]]:
    """Attach lat/lon to each HOS stop for the map UI."""
    enriched: list[dict[str, Any]] = []
    for stop in hos_stops:
        kind = stop.get("kind")
        miles = float(stop.get("miles_from_start") or 0.0)

        if kind == "start":
            point = [current.lat, current.lon]
        elif kind == "pickup":
            point = [pickup.lat, pickup.lon]
        elif kind in ("dropoff", "end"):
            point = [dropoff.lat, dropoff.lon]
        else:
            # Intermediate stops (fuel / break / rest) along the driven polyline.
            point = point_along_route(geometry, miles)

        lat, lon = point[0], point[1]
        if lat != lat or lon != lon:  # NaN guard
            point = [pickup.lat, pickup.lon]

        enriched.append(
            {
                **stop,
                "lat": round(point[0], 6),
                "lon": round(point[1], 6),
            }
        )
    return enriched
