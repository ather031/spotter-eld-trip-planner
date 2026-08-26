"""Tests for friendly map/routing error messages."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from trips.services.http import MapServiceError, _error_from_response, http_get_json
from trips.services.geocoding import GeoPoint
from trips.services.routing import route_driving


def test_osrm_no_route_http_body_is_friendly():
    resp = MagicMock()
    resp.status_code = 400
    resp.json.return_value = {
        "message": "Impossible route between points",
        "code": "NoRoute",
    }
    err = _error_from_response(resp)
    assert isinstance(err, MapServiceError)
    assert err.status_code == 400
    assert err.code == "no_route"
    assert "No driving route exists" in str(err)
    assert "continents" in str(err).lower() or "road" in str(err).lower()


def test_osrm_no_segment_message():
    resp = MagicMock()
    resp.status_code = 400
    resp.json.return_value = {"code": "NoSegment", "message": "Could not find a matching segment"}
    err = _error_from_response(resp)
    assert err.code == "no_segment"
    assert err.status_code == 400


@patch("trips.services.routing.http_get_json")
def test_route_driving_no_route_code_in_200_body(mock_get):
    mock_get.return_value = {"code": "NoRoute", "message": "Impossible route between points"}
    a = GeoPoint(52.25, -0.81, "UK")
    b = GeoPoint(39.77, -86.16, "US")
    with pytest.raises(MapServiceError) as exc:
        route_driving([a, b])
    assert exc.value.code == "no_route"
    assert exc.value.status_code == 400


@patch("trips.services.http.requests.get")
def test_http_get_json_surfaces_no_route(mock_get):
    resp = MagicMock()
    resp.status_code = 400
    resp.text = '{"code":"NoRoute"}'
    resp.json.return_value = {"code": "NoRoute", "message": "Impossible route between points"}
    mock_get.return_value = resp
    with pytest.raises(MapServiceError) as exc:
        http_get_json("https://example.test/route")
    assert "No driving route exists" in str(exc.value)
