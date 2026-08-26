"""DRF serializers for trip planning API."""

from __future__ import annotations

from rest_framework import serializers

from hos import CYCLE_LIMIT_HOURS


class LocationField(serializers.Field):
    """Accept a free-text place, 'lat,lon', or {lat, lon, label?}."""

    default_error_messages = {
        "invalid": "Provide a string address, 'lat,lon', or an object with lat and lon.",
        "blank": "Location cannot be blank.",
    }

    def to_internal_value(self, data):
        if isinstance(data, dict):
            if "lat" not in data or "lon" not in data:
                self.fail("invalid")
            try:
                lat = float(data["lat"])
                lon = float(data["lon"])
            except (TypeError, ValueError):
                self.fail("invalid")
            out = {"lat": lat, "lon": lon}
            if data.get("label") or data.get("display_name"):
                out["label"] = str(data.get("label") or data.get("display_name"))
            return out

        if isinstance(data, str):
            text = data.strip()
            if not text:
                self.fail("blank")
            return text

        self.fail("invalid")

    def to_representation(self, value):
        return value


class TripPlanRequestSerializer(serializers.Serializer):
    current_location = LocationField()
    pickup_location = LocationField()
    dropoff_location = LocationField()
    cycle_used_hours = serializers.FloatField(min_value=0.0, max_value=CYCLE_LIMIT_HOURS)
    start_hour_of_day = serializers.FloatField(
        required=False, default=6.0, min_value=0.0, max_value=23.999
    )

    def validate_cycle_used_hours(self, value: float) -> float:
        if value != value:  # NaN
            raise serializers.ValidationError("cycle_used_hours must be a number.")
        return value

    def validate_start_hour_of_day(self, value: float) -> float:
        if value != value:
            raise serializers.ValidationError("start_hour_of_day must be a number.")
        return value

    def validate(self, attrs):
        # Same string inputs (common copy-paste mistake)
        locs = [
            attrs.get("current_location"),
            attrs.get("pickup_location"),
            attrs.get("dropoff_location"),
        ]
        normalized = []
        for loc in locs:
            if isinstance(loc, str):
                normalized.append(loc.strip().lower())
            elif isinstance(loc, dict):
                normalized.append(
                    (round(float(loc["lat"]), 5), round(float(loc["lon"]), 5))
                )
            else:
                normalized.append(loc)

        if normalized[1] == normalized[2]:
            raise serializers.ValidationError(
                {"dropoff_location": "Dropoff must differ from pickup."}
            )
        return attrs
