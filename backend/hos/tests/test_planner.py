"""Unit tests for the pure-Python HOS planner."""

from __future__ import annotations

import pytest

from hos import (
    BREAK_AFTER_DRIVING_HOURS,
    CYCLE_LIMIT_HOURS,
    DRIVING_LIMIT_HOURS,
    DROPOFF_ON_DUTY_HOURS,
    DUTY_WINDOW_HOURS,
    FUEL_INTERVAL_MILES,
    MIN_OFF_DUTY_RESET_HOURS,
    PICKUP_ON_DUTY_HOURS,
    RESTART_34_HOURS,
    DutyStatus,
    StopKind,
    assert_plan_compliant,
    build_day_segments,
    plan_trip,
)
from hos.planner import HosEvent


SPEED = 55.0


def _plan(**kwargs):
    defaults = {
        "deadhead_miles": 0.0,
        "loaded_miles": 100.0,
        "cycle_used_hours": 0.0,
        "average_speed_mph": SPEED,
        "start_hour_of_day": 6.0,
    }
    defaults.update(kwargs)
    return plan_trip(**defaults)


# ---------------------------------------------------------------------------
# Basics: pickup / dropoff / deadhead
# ---------------------------------------------------------------------------


class TestPickupDropoffDeadhead:
    def test_pickup_and_dropoff_are_one_hour_on_duty(self):
        result = _plan(loaded_miles=50)
        pickups = [s for s in result.stops if s.kind == StopKind.PICKUP]
        dropoffs = [s for s in result.stops if s.kind == StopKind.DROPOFF]
        assert len(pickups) == 1
        assert len(dropoffs) == 1
        assert pickups[0].duration_hours == PICKUP_ON_DUTY_HOURS
        assert dropoffs[0].duration_hours == DROPOFF_ON_DUTY_HOURS

        on_duty_events = [
            e
            for e in result.events
            if e.stop_kind in (StopKind.PICKUP, StopKind.DROPOFF)
        ]
        assert all(e.status == DutyStatus.ON_DUTY for e in on_duty_events)
        assert all(e.duration_hours == 1.0 for e in on_duty_events)

    def test_near_zero_deadhead_is_skipped(self):
        result = _plan(deadhead_miles=0.5, loaded_miles=40)
        assert any("deadhead" in w.lower() for w in result.warnings)
        deadhead_drive = [
            e for e in result.events if "Deadhead" in e.label and e.status == DutyStatus.DRIVING
        ]
        assert deadhead_drive == []
        assert result.summary is not None
        assert result.summary.total_miles == pytest.approx(40.0, abs=0.1)

    def test_deadhead_counts_against_clocks(self):
        # Deadhead long enough to consume most of the 11-hr drive clock
        result = _plan(deadhead_miles=10 * SPEED, loaded_miles=2 * SPEED, cycle_used_hours=0)
        assert result.summary is not None
        # Must insert a 10-hr rest somewhere because 12h driving > 11h limit
        assert result.summary.rests_10 >= 1
        assert assert_plan_compliant(result) == []


# ---------------------------------------------------------------------------
# 11-hour driving / 14-hour window / 30-min break / 10-hr rest
# ---------------------------------------------------------------------------


class TestDailyDrivingLimits:
    def test_never_drives_more_than_11_hours_in_a_window(self):
        # ~12 hours of driving forces at least one reset
        result = _plan(loaded_miles=12 * SPEED, cycle_used_hours=0)
        assert result.summary is not None
        assert result.summary.rests_10 >= 1

        # Validate no continuous window exceeds 11h driving
        driving = 0.0
        for e in result.events:
            if e.stop_kind in (StopKind.REST_10, StopKind.RESTART_34):
                assert driving <= DRIVING_LIMIT_HOURS + 1e-6
                driving = 0.0
            elif e.status == DutyStatus.DRIVING:
                driving += e.duration_hours
        assert driving <= DRIVING_LIMIT_HOURS + 1e-6
        assert assert_plan_compliant(result) == []

    def test_30_minute_break_after_8_hours_driving(self):
        # Exactly enough driving to require one 30-min break, still within 11/14
        result = _plan(loaded_miles=9 * SPEED, cycle_used_hours=0)
        assert result.summary is not None
        assert result.summary.breaks_30 >= 1
        breaks = [e for e in result.events if e.stop_kind == StopKind.BREAK_30]
        assert breaks
        assert breaks[0].duration_hours == pytest.approx(0.5)
        assert breaks[0].status == DutyStatus.OFF_DUTY

        # Cumulative driving before first break should be ~8h
        drove = 0.0
        for e in result.events:
            if e.stop_kind == StopKind.BREAK_30:
                break
            if e.status == DutyStatus.DRIVING:
                drove += e.duration_hours
        assert drove == pytest.approx(BREAK_AFTER_DRIVING_HOURS, abs=0.05)
        assert assert_plan_compliant(result) == []

    def test_14_hour_window_caps_duty_before_rest(self):
        """
        On-duty (pickup) + driving that would push past 14h must force a 10h rest.

        Pickup 1h + ~13.5h drive potential → rest before finishing.
        """
        result = _plan(loaded_miles=13.5 * SPEED, cycle_used_hours=0)
        assert result.summary is not None
        assert result.summary.rests_10 >= 1

        # Simulate duty window never exceeds 14h of on-duty+break time between rests
        duty = 0.0
        for e in result.events:
            if e.stop_kind in (StopKind.REST_10, StopKind.RESTART_34):
                assert duty <= DUTY_WINDOW_HOURS + 1e-6
                duty = 0.0
                continue
            if e.status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY):
                duty += e.duration_hours
            elif e.stop_kind == StopKind.BREAK_30:
                duty += e.duration_hours
        assert duty <= DUTY_WINDOW_HOURS + 1e-6
        assert assert_plan_compliant(result) == []

    def test_10_hour_rest_duration(self):
        result = _plan(loaded_miles=12 * SPEED)
        rests = [e for e in result.events if e.stop_kind == StopKind.REST_10]
        assert rests
        assert all(r.duration_hours >= MIN_OFF_DUTY_RESET_HOURS - 1e-9 for r in rests)


# ---------------------------------------------------------------------------
# Fuel every 1000 miles
# ---------------------------------------------------------------------------


class TestFueling:
    def test_fuel_stop_inserted_every_1000_miles(self):
        result = _plan(loaded_miles=2100, cycle_used_hours=0)
        assert result.summary is not None
        # At least 2 fuel stops for 2100 miles (at 1000 and 2000)
        assert result.summary.fuel_stops >= 2
        fuels = [s for s in result.stops if s.kind == StopKind.FUEL]
        assert len(fuels) >= 2
        assert all(f.duration_hours == pytest.approx(0.5) for f in fuels)
        assert assert_plan_compliant(result) == []

    def test_short_trip_needs_no_fuel(self):
        result = _plan(loaded_miles=400)
        assert result.summary is not None
        assert result.summary.fuel_stops == 0


# ---------------------------------------------------------------------------
# 70-hr / 8-day cycle + 34-hr restart
# ---------------------------------------------------------------------------


class TestCycleAndRestart:
    def test_high_cycle_used_triggers_34_hour_restart(self):
        # Almost no cycle left; any meaningful trip needs a restart
        result = _plan(
            deadhead_miles=50,
            loaded_miles=200,
            cycle_used_hours=68.0,
        )
        assert result.summary is not None
        assert result.summary.restarts_34 >= 1
        restarts = [e for e in result.events if e.stop_kind == StopKind.RESTART_34]
        assert restarts
        assert restarts[0].duration_hours == pytest.approx(RESTART_34_HOURS)
        assert any("34-hour" in w.lower() for w in result.warnings)
        assert assert_plan_compliant(result) == []

    def test_cycle_resets_after_34_hour_restart(self):
        result = _plan(loaded_miles=300, cycle_used_hours=69.0)
        assert result.summary is not None
        assert result.summary.restarts_34 >= 1
        # After restart, ending cycle used should be well below 70
        assert result.summary.cycle_used_at_end < CYCLE_LIMIT_HOURS
        assert result.summary.cycle_remaining_at_end > 0

    def test_fresh_cycle_no_restart_on_short_trip(self):
        result = _plan(loaded_miles=100, cycle_used_hours=10)
        assert result.summary is not None
        assert result.summary.restarts_34 == 0


# ---------------------------------------------------------------------------
# Multi-day + day log segments
# ---------------------------------------------------------------------------


class TestMultiDayAndLogs:
    def test_long_haul_spans_multiple_days(self):
        result = _plan(loaded_miles=1800, cycle_used_hours=5)
        assert result.summary is not None
        assert result.summary.days_required >= 2
        day_indexes = {d.day_index for d in result.day_segments}
        assert len(day_indexes) >= 2
        assert assert_plan_compliant(result) == []

    def test_day_segments_cover_full_event_duration(self):
        result = _plan(loaded_miles=600, start_hour_of_day=20.0)
        event_hours = sum(e.duration_hours for e in result.events)
        segment_hours = sum(d.end_hour_of_day - d.start_hour_of_day for d in result.day_segments)
        assert segment_hours == pytest.approx(event_hours, abs=0.05)

    def test_day_segments_stay_within_0_24(self):
        result = _plan(loaded_miles=900, start_hour_of_day=22.0)
        for seg in result.day_segments:
            assert 0 <= seg.start_hour_of_day <= 24
            assert 0 < seg.end_hour_of_day <= 24
            assert seg.end_hour_of_day > seg.start_hour_of_day

    def test_build_day_segments_splits_at_midnight(self):
        events = [
            HosEvent(
                status=DutyStatus.DRIVING,
                start_hours=0.0,
                end_hours=8.0,
                label="drive",
                miles=400,
            )
        ]
        # Start at 22:00 → crosses midnight after 2 hours
        segs = build_day_segments(events, start_hour_of_day=22.0)
        assert len(segs) == 2
        assert segs[0].day_index == 0
        assert segs[0].start_hour_of_day == pytest.approx(22.0)
        assert segs[0].end_hour_of_day == pytest.approx(24.0)
        assert segs[1].day_index == 1
        assert segs[1].start_hour_of_day == pytest.approx(0.0)
        assert segs[1].end_hour_of_day == pytest.approx(6.0)


# ---------------------------------------------------------------------------
# Compliance + serialization
# ---------------------------------------------------------------------------


class TestComplianceAndSerialization:
    def test_assert_plan_compliant_clean_for_demo_short_trip(self):
        result = _plan(
            deadhead_miles=30,
            loaded_miles=220,
            cycle_used_hours=12,
        )
        assert assert_plan_compliant(result) == []

    def test_to_dict_shape(self):
        result = _plan(loaded_miles=100)
        payload = result.to_dict()
        assert "events" in payload
        assert "stops" in payload
        assert "day_segments" in payload
        assert "summary" in payload
        assert "warnings" in payload
        assert payload["summary"]["total_miles"] == pytest.approx(100.0, abs=0.1)
        assert payload["events"][0]["status"] in {s.value for s in DutyStatus}

    def test_invalid_cycle_used_raises(self):
        with pytest.raises(ValueError):
            _plan(loaded_miles=50, cycle_used_hours=71)

    def test_rejection_of_negative_cycle(self):
        with pytest.raises(ValueError):
            _plan(loaded_miles=50, cycle_used_hours=-1)

    def test_loaded_haul_must_be_nontrivial(self):
        with pytest.raises(ValueError, match="loaded haul"):
            plan_trip(
                deadhead_miles=0,
                loaded_miles=0.2,
                loaded_hours=0,
                cycle_used_hours=0,
            )
