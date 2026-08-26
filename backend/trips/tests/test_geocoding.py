"""Tests for geocoding helpers (no network)."""

from __future__ import annotations

import pytest

from trips.services.geocoding import GeoPoint, geocode, haversine_miles, parse_coordinates
from trips.services.http import MapServiceError


def test_parse_coordinates():
    p = parse_coordinates("41.8781, -87.6298")
    assert p is not None
    assert p.lat == pytest.approx(41.8781)
    assert p.lon == pytest.approx(-87.6298)
    assert p.source == "coordinates"


def test_parse_coordinates_invalid():
    assert parse_coordinates("Chicago, IL") is None
    assert parse_coordinates("99.0, 0.0") is None  # lat out of range


def test_geocode_dict():
    p = geocode({"lat": 40.7, "lon": -74.0, "label": "NYC"})
    assert p.display_name == "NYC"
    assert p.lat == 40.7


def test_geocode_coord_string():
    p = geocode("34.05,-118.25")
    assert p.source == "coordinates"


def test_geocode_blank_raises():
    with pytest.raises(MapServiceError):
        geocode("   ")


def test_haversine_same_point_zero():
    a = GeoPoint(41.0, -87.0, "a")
    assert haversine_miles(a, a) == pytest.approx(0.0, abs=1e-6)


def test_haversine_known_ballpark():
    # Chicago ≈ NYC is roughly 700–800 miles
    chi = GeoPoint(41.8781, -87.6298, "Chicago")
    nyc = GeoPoint(40.7128, -74.0060, "NYC")
    d = haversine_miles(chi, nyc)
    assert 700 < d < 850
