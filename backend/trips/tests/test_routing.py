"""Tests for OSRM routing helpers (no network)."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from trips.services.geocoding import GeoPoint
from trips.services.http import MapServiceError
from trips.services.routing import point_along_route, route_driving


def test_point_along_route_endpoints():
    geom = [[0.0, 0.0], [0.0, 1.0]]  # ~69 miles north-south? actually lon change at lat 0
    # At lat 0, 1 degree lon ≈ 69.17 miles
    start = point_along_route(geom, 0)
    assert start == [0.0, 0.0]
    end = point_along_route(geom, 10_000)
    assert end[0] == pytest.approx(0.0, abs=1e-6)
    assert end[1] == pytest.approx(1.0, abs=1e-6)


def test_point_along_route_midpoint():
    geom = [[0.0, 0.0], [0.0, 1.0]]
    mid = point_along_route(geom, 34.5)  # ~half of ~69 mi
    assert mid[0] == pytest.approx(0.0, abs=1e-5)
    assert 0.4 < mid[1] < 0.6


@patch("trips.services.routing.http_get_json")
def test_route_driving_parses_osrm(mock_get):
    mock_get.return_value = {
        "code": "Ok",
        "routes": [
            {
                "distance": 160934.4,  # 100 miles
                "duration": 7200,  # 2 hours
                "geometry": {
                    "coordinates": [
                        [-87.63, 41.88],
                        [-87.0, 41.5],
                        [-86.5, 41.2],
                    ]
                },
                "legs": [
                    {"distance": 80467.2, "duration": 3600},
                    {"distance": 80467.2, "duration": 3600},
                ],
            }
        ],
    }
    a = GeoPoint(41.88, -87.63, "A")
    b = GeoPoint(41.5, -87.0, "B")
    c = GeoPoint(41.2, -86.5, "C")
    result = route_driving([a, b, c], labels=["A", "B", "C"])
    assert result.distance_miles == pytest.approx(100.0, abs=0.1)
    assert result.duration_hours == pytest.approx(2.0)
    assert len(result.legs) == 2
    assert result.geometry[0] == [41.88, -87.63]  # lat, lon order


@patch("trips.services.routing.http_get_json")
def test_route_driving_failure(mock_get):
    mock_get.return_value = {"code": "NoRoute", "routes": []}
    a = GeoPoint(0, 0, "a")
    b = GeoPoint(1, 1, "b")
    with pytest.raises(MapServiceError):
        route_driving([a, b])
