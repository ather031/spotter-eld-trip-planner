"""HTTP views for trip planning."""

from __future__ import annotations

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from trips.serializers import TripPlanRequestSerializer
from trips.services.geocoding import search_places
from trips.services.http import MapServiceError
from trips.services.trip_planner import plan_trip_from_locations


class HealthView(APIView):
    authentication_classes: list = []
    permission_classes: list = []

    def get(self, _request: Request) -> Response:
        return Response({"status": "ok", "service": "spotter-eld-trip-planner"})


class PlaceSearchView(APIView):
    """GET /api/places/search/?q=chicago&limit=8 — autocomplete candidates."""

    authentication_classes: list = []
    permission_classes: list = []

    def get(self, request: Request) -> Response:
        q = str(request.query_params.get("q") or "").strip()
        try:
            limit = int(request.query_params.get("limit") or 8)
        except (TypeError, ValueError):
            limit = 8

        if len(q) < 2:
            return Response({"results": []})

        try:
            results = search_places(q, limit=limit)
        except MapServiceError as exc:
            return Response(
                {"detail": str(exc), "results": [], "code": exc.code},
                status=exc.status_code
                if exc.status_code in {400, 429, 502, 503, 504}
                else status.HTTP_502_BAD_GATEWAY,
            )

        return Response({"results": results})


class TripPlanView(APIView):
    """
    POST /api/trips/plan/

    Geocode inputs → OSRM route → HOS-compliant schedule.
    """

    authentication_classes: list = []
    permission_classes: list = []

    def post(self, request: Request) -> Response:
        serializer = TripPlanRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            payload = plan_trip_from_locations(
                current_location=data["current_location"],
                pickup_location=data["pickup_location"],
                dropoff_location=data["dropoff_location"],
                cycle_used_hours=data["cycle_used_hours"],
                start_hour_of_day=data.get("start_hour_of_day", 6.0),
            )
        except MapServiceError as exc:
            return Response(
                {"detail": str(exc), "code": exc.code},
                status=exc.status_code
                if exc.status_code in {400, 429, 502, 503, 504}
                else status.HTTP_502_BAD_GATEWAY,
            )
        except ValueError as exc:
            return Response(
                {"detail": str(exc), "code": "validation_error"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(payload, status=status.HTTP_200_OK)
