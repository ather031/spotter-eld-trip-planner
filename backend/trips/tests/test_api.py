"""API + orchestration tests with mocked geocode/route."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from trips.services.geocoding import GeoPoint
from trips.services.routing import RouteLegResult, RouteResult


@pytest.fixture
def api():
    return APIClient()


def _points():
    return (
        GeoPoint(41.88, -87.63, "Chicago, IL", source="coordinates"),
        GeoPoint(39.77, -86.16, "Indianapolis, IN", source="coordinates"),
        GeoPoint(39.10, -84.51, "Cincinnati, OH", source="coordinates"),
    )


def _fake_route(skip_deadhead: bool = False) -> RouteResult:
    if skip_deadhead:
        return RouteResult(
            geometry=[[39.77, -86.16], [39.4, -85.3], [39.10, -84.51]],
            distance_miles=110.0,
            duration_hours=2.0,
            legs=[
                RouteLegResult(110.0, 2.0, "Pickup", "Dropoff"),
            ],
        )
    return RouteResult(
        geometry=[
            [41.88, -87.63],
            [40.8, -86.9],
            [39.77, -86.16],
            [39.4, -85.3],
            [39.10, -84.51],
        ],
        distance_miles=290.0,
        duration_hours=5.2,
        legs=[
            RouteLegResult(180.0, 3.2, "Current", "Pickup"),
            RouteLegResult(110.0, 2.0, "Pickup", "Dropoff"),
        ],
    )


class TestHealth:
    def test_health(self, api):
        resp = api.get("/api/health/")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


class TestPlaceSearch:
    @patch("trips.views.search_places")
    def test_place_search(self, mock_search, api):
        mock_search.return_value = [
            {
                "display_name": "Chicago, Illinois, United States",
                "lat": 41.88,
                "lon": -87.63,
                "source": "nominatim",
            }
        ]
        resp = api.get("/api/places/search/", {"q": "chicago"})
        assert resp.status_code == 200
        assert len(resp.json()["results"]) == 1

    def test_place_search_short_query(self, api):
        resp = api.get("/api/places/search/", {"q": "c"})
        assert resp.status_code == 200
        assert resp.json()["results"] == []


class TestTripPlanValidation:
    def test_missing_fields(self, api):
        resp = api.post("/api/trips/plan/", {}, format="json")
        assert resp.status_code == 400

    def test_cycle_used_too_high(self, api):
        resp = api.post(
            "/api/trips/plan/",
            {
                "current_location": "41.88,-87.63",
                "pickup_location": "39.77,-86.16",
                "dropoff_location": "39.10,-84.51",
                "cycle_used_hours": 71,
            },
            format="json",
        )
        assert resp.status_code == 400


class TestTripPlanHappyPath:
    @patch("trips.services.trip_planner.route_driving")
    @patch("trips.services.trip_planner.geocode")
    def test_plan_with_coordinates(self, mock_geocode, mock_route, api):
        current, pickup, dropoff = _points()
        mock_geocode.side_effect = [current, pickup, dropoff]
        mock_route.return_value = _fake_route()

        resp = api.post(
            "/api/trips/plan/",
            {
                "current_location": "41.88,-87.63",
                "pickup_location": "39.77,-86.16",
                "dropoff_location": "39.10,-84.51",
                "cycle_used_hours": 10,
                "start_hour_of_day": 6,
            },
            format="json",
        )
        assert resp.status_code == 200, resp.content
        body = resp.json()

        assert "route" in body
        assert "geometry" in body["route"]
        assert len(body["route"]["geometry"]) >= 2
        assert body["summary"]["total_miles"] == pytest.approx(290.0, abs=1.0)
        assert body["summary"]["fuel_stops"] == 0

        kinds = {s["kind"] for s in body["stops"]}
        assert "start" in kinds
        assert "pickup" in kinds
        assert "dropoff" in kinds
        assert "end" in kinds

        pickup_stop = next(s for s in body["stops"] if s["kind"] == "pickup")
        assert pickup_stop["duration_hours"] == 1.0
        assert "lat" in pickup_stop and "lon" in pickup_stop

        assert body["events"]
        assert body["day_segments"]
        assert "meta" in body
        assert body["locations"]["current"]["lat"] == pytest.approx(41.88)

    @patch("trips.services.trip_planner.route_driving")
    @patch("trips.services.trip_planner.geocode")
    def test_skip_deadhead_when_current_near_pickup(self, mock_geocode, mock_route, api):
        pickup = GeoPoint(39.77, -86.16, "Indianapolis", source="coordinates")
        # Current essentially same as pickup
        current = GeoPoint(39.7701, -86.1601, "Near pickup", source="coordinates")
        dropoff = GeoPoint(39.10, -84.51, "Cincinnati", source="coordinates")
        mock_geocode.side_effect = [current, pickup, dropoff]
        mock_route.return_value = _fake_route(skip_deadhead=True)

        resp = api.post(
            "/api/trips/plan/",
            {
                "current_location": {"lat": 39.7701, "lon": -86.1601},
                "pickup_location": {"lat": 39.77, "lon": -86.16},
                "dropoff_location": {"lat": 39.10, "lon": -84.51},
                "cycle_used_hours": 5,
            },
            format="json",
        )
        assert resp.status_code == 200, resp.content
        body = resp.json()
        assert any("deadhead" in w.lower() for w in body["warnings"])
        assert body["summary"]["total_miles"] == pytest.approx(110.0, abs=1.0)
        # route_driving called with 2 waypoints
        args, kwargs = mock_route.call_args
        assert len(args[0]) == 2

    @patch("trips.services.trip_planner.route_driving")
    @patch("trips.services.trip_planner.geocode")
    def test_high_cycle_adds_restart_warning(self, mock_geocode, mock_route, api):
        current, pickup, dropoff = _points()
        mock_geocode.side_effect = [current, pickup, dropoff]
        mock_route.return_value = _fake_route()

        resp = api.post(
            "/api/trips/plan/",
            {
                "current_location": "41.88,-87.63",
                "pickup_location": "39.77,-86.16",
                "dropoff_location": "39.10,-84.51",
                "cycle_used_hours": 68,
            },
            format="json",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["summary"]["restarts_34"] >= 1
        assert any("34" in w for w in body["warnings"])


class TestTripPlanErrors:
    @patch("trips.services.trip_planner.geocode")
    def test_geocode_failure_maps_to_400(self, mock_geocode, api):
        from trips.services.http import MapServiceError

        mock_geocode.side_effect = MapServiceError("Could not geocode", status_code=400)
        resp = api.post(
            "/api/trips/plan/",
            {
                "current_location": "Nowhereville ZZ",
                "pickup_location": "39.77,-86.16",
                "dropoff_location": "39.10,-84.51",
                "cycle_used_hours": 0,
            },
            format="json",
        )
        assert resp.status_code == 400
        assert "detail" in resp.json()

    def test_same_pickup_and_dropoff_rejected(self, api):
        resp = api.post(
            "/api/trips/plan/",
            {
                "current_location": "Chicago, IL",
                "pickup_location": "Indianapolis, IN",
                "dropoff_location": "Indianapolis, IN",
                "cycle_used_hours": 0,
            },
            format="json",
        )
        assert resp.status_code == 400

    @patch("trips.services.trip_planner.route_driving")
    @patch("trips.services.trip_planner.geocode")
    def test_pickup_dropoff_too_close_after_geocode(self, mock_geocode, mock_route, api):
        near = GeoPoint(39.77, -86.16, "A", source="coordinates")
        near2 = GeoPoint(39.7702, -86.1602, "B", source="coordinates")
        current = GeoPoint(41.88, -87.63, "C", source="coordinates")
        mock_geocode.side_effect = [current, near, near2]
        resp = api.post(
            "/api/trips/plan/",
            {
                "current_location": {"lat": 41.88, "lon": -87.63},
                "pickup_location": {"lat": 39.77, "lon": -86.16},
                "dropoff_location": {"lat": 39.7702, "lon": -86.1602},
                "cycle_used_hours": 0,
            },
            format="json",
        )
        assert resp.status_code == 400
        mock_route.assert_not_called()
