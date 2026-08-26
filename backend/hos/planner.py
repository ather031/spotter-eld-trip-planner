"""
Pure-Python Hours of Service (HOS) trip planner.

Property-carrying driver, 70 hrs / 8 days. No Django dependency.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


# ---------------------------------------------------------------------------
# FMCSA property-carrying constants (hard assessment assumptions)
# ---------------------------------------------------------------------------

CYCLE_LIMIT_HOURS = 70.0
DRIVING_LIMIT_HOURS = 11.0
DUTY_WINDOW_HOURS = 14.0
BREAK_AFTER_DRIVING_HOURS = 8.0
BREAK_DURATION_HOURS = 0.5  # 30 minutes
MIN_OFF_DUTY_RESET_HOURS = 10.0
RESTART_34_HOURS = 34.0

PICKUP_ON_DUTY_HOURS = 1.0
DROPOFF_ON_DUTY_HOURS = 1.0
FUEL_INTERVAL_MILES = 1000.0
FUEL_STOP_HOURS = 0.5  # assumed on-duty not driving
DEFAULT_SPEED_MPH = 55.0

# Deadhead skip threshold: if current≈pickup, treat as same location
NEAR_ZERO_MILES = 1.0


class DutyStatus(str, Enum):
    OFF_DUTY = "off_duty"
    SLEEPER = "sleeper"
    DRIVING = "driving"
    ON_DUTY = "on_duty"  # on-duty not driving


class StopKind(str, Enum):
    START = "start"
    PICKUP = "pickup"
    DROPOFF = "dropoff"
    FUEL = "fuel"
    BREAK_30 = "break_30"
    REST_10 = "rest_10"
    RESTART_34 = "restart_34"
    END = "end"


@dataclass(frozen=True)
class RouteLeg:
    """One continuous driving segment between two known waypoints."""

    label: str
    distance_miles: float
    duration_hours: float


@dataclass
class PlanRequest:
    """
    Inputs for the HOS scheduler.

    Provide legs in order: optional deadhead (current→pickup), then loaded
    (pickup→dropoff). Distances/durations typically come from a routing API.
    """

    legs: list[RouteLeg]
    cycle_used_hours: float
    start_hour_of_day: float = 6.0  # 0–24 local clock for day-1 log sheets
    average_speed_mph: float = DEFAULT_SPEED_MPH

    def __post_init__(self) -> None:
        if self.cycle_used_hours < 0:
            raise ValueError("cycle_used_hours must be >= 0")
        if self.cycle_used_hours > CYCLE_LIMIT_HOURS:
            raise ValueError(f"cycle_used_hours cannot exceed {CYCLE_LIMIT_HOURS}")
        if not 0 <= self.start_hour_of_day < 24:
            raise ValueError("start_hour_of_day must be in [0, 24)")
        if self.average_speed_mph <= 0:
            raise ValueError("average_speed_mph must be > 0")
        if not self.legs:
            raise ValueError("at least one route leg is required")


@dataclass
class HosEvent:
    """A contiguous duty-status block on the timeline."""

    status: DutyStatus
    start_hours: float  # hours from trip t=0
    end_hours: float
    label: str
    miles: float = 0.0
    stop_kind: StopKind | None = None
    day_index: int = 0  # 0-based calendar day relative to start

    @property
    def duration_hours(self) -> float:
        return self.end_hours - self.start_hours

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["status"] = self.status.value
        d["stop_kind"] = self.stop_kind.value if self.stop_kind else None
        d["duration_hours"] = self.duration_hours
        return d


@dataclass
class StopMarker:
    """Labeled stop for map / UI."""

    kind: StopKind
    label: str
    at_hours: float
    miles_from_start: float
    duration_hours: float = 0.0
    day_index: int = 0

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["kind"] = self.kind.value
        return d


@dataclass
class DayLogSegment:
    """One status segment clipped to a single calendar day (for ELD grids)."""

    day_index: int
    status: DutyStatus
    start_hour_of_day: float  # 0–24
    end_hour_of_day: float  # 0–24 (24 = midnight end)
    label: str
    miles: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["status"] = self.status.value
        d["duration_hours"] = self.end_hour_of_day - self.start_hour_of_day
        return d


@dataclass
class PlanSummary:
    total_miles: float
    total_driving_hours: float
    total_on_duty_hours: float
    total_off_duty_hours: float
    trip_duration_hours: float
    days_required: int
    fuel_stops: int
    breaks_30: int
    rests_10: int
    restarts_34: int
    cycle_used_at_start: float
    cycle_used_at_end: float
    cycle_remaining_at_end: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PlanResult:
    events: list[HosEvent] = field(default_factory=list)
    stops: list[StopMarker] = field(default_factory=list)
    day_segments: list[DayLogSegment] = field(default_factory=list)
    summary: PlanSummary | None = None
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "events": [e.to_dict() for e in self.events],
            "stops": [s.to_dict() for s in self.stops],
            "day_segments": [d.to_dict() for d in self.day_segments],
            "summary": self.summary.to_dict() if self.summary else None,
            "warnings": list(self.warnings),
        }


# ---------------------------------------------------------------------------
# Scheduler state
# ---------------------------------------------------------------------------


@dataclass
class _ClockState:
    t: float = 0.0  # elapsed hours from trip start
    miles: float = 0.0
    cycle_used: float = 0.0

    # Window clocks (reset after qualifying rest / 34-hr restart)
    driving_in_window: float = 0.0
    duty_window_elapsed: float = 0.0
    driving_since_break: float = 0.0
    miles_since_fuel: float = 0.0
    window_open: bool = False

    start_hour_of_day: float = 6.0

    def day_index(self) -> int:
        absolute = self.start_hour_of_day + self.t
        return int(absolute // 24)

    def hour_of_day(self, at: float | None = None) -> float:
        abs_h = self.start_hour_of_day + (self.t if at is None else at)
        return abs_h % 24


class HosPlanner:
    """
    Greedy HOS scheduler for a property-carrying driver.

    Walks route legs chronologically, inserting fuel stops, 30-min breaks,
    10-hour rests, and 34-hour restarts as clocks require.
    """

    def __init__(self, request: PlanRequest) -> None:
        self.request = request
        self.state = _ClockState(
            cycle_used=request.cycle_used_hours,
            start_hour_of_day=request.start_hour_of_day,
        )
        self.events: list[HosEvent] = []
        self.stops: list[StopMarker] = []
        self.warnings: list[str] = []
        self._fuel_count = 0
        self._break_count = 0
        self._rest_count = 0
        self._restart_count = 0

    # -- public API ---------------------------------------------------------

    def plan(self) -> PlanResult:
        self.stops.append(
            StopMarker(
                kind=StopKind.START,
                label="Current location / trip start",
                at_hours=0.0,
                miles_from_start=0.0,
                day_index=0,
            )
        )

        # Ensure we can start duty (cycle may already be exhausted)
        self._ensure_cycle_capacity(min_needed=0.1)

        for leg in self.request.legs:
            self._drive_leg(leg)

        # Trip ends after final dropoff on-duty is already in legs via
        # build_plan_from_miles — if last event isn't end marker, add one.
        if not self.stops or self.stops[-1].kind != StopKind.END:
            self.stops.append(
                StopMarker(
                    kind=StopKind.END,
                    label="Trip complete",
                    at_hours=self.state.t,
                    miles_from_start=self.state.miles,
                    day_index=self.state.day_index(),
                )
            )

        day_segments = build_day_segments(self.events, self.request.start_hour_of_day)
        summary = self._build_summary()
        return PlanResult(
            events=list(self.events),
            stops=list(self.stops),
            day_segments=day_segments,
            summary=summary,
            warnings=list(self.warnings),
        )

    # -- core driving -------------------------------------------------------

    def _drive_leg(self, leg: RouteLeg) -> None:
        remaining_miles = leg.distance_miles
        remaining_hours = leg.duration_hours
        if remaining_miles < 0 or remaining_hours < 0:
            raise ValueError(f"leg '{leg.label}' has negative distance/duration")

        # Zero-length leg (e.g. skipped deadhead): no driving
        if remaining_miles <= 0 and remaining_hours <= 0:
            return

        # Derive speed from leg if both provided
        speed = (
            remaining_miles / remaining_hours
            if remaining_hours > 0
            else self.request.average_speed_mph
        )
        if speed <= 0:
            speed = self.request.average_speed_mph

        while remaining_miles > 1e-6 or remaining_hours > 1e-6:
            self._ensure_window_open()
            self._ensure_cycle_capacity(min_needed=0.01)

            # How much can we drive before hitting a limit?
            drive_cap = self._max_continuous_drive_hours()
            if drive_cap <= 1e-9:
                # Must rest / break / restart before more driving
                self._resolve_no_drive_capacity()
                continue

            # Fuel limit in hours
            miles_until_fuel = FUEL_INTERVAL_MILES - self.state.miles_since_fuel
            hours_until_fuel = miles_until_fuel / speed if speed > 0 else drive_cap

            chunk_hours = min(
                drive_cap,
                remaining_hours if remaining_hours > 0 else drive_cap,
                hours_until_fuel,
            )
            # Also cap by remaining miles
            chunk_miles = min(remaining_miles, chunk_hours * speed)
            if chunk_miles < remaining_miles and speed > 0:
                chunk_hours = chunk_miles / speed

            if chunk_hours <= 1e-9:
                # Likely at fuel limit with zero room — fuel now
                if self.state.miles_since_fuel >= FUEL_INTERVAL_MILES - 1e-6:
                    self._insert_fuel_stop()
                    continue
                self._resolve_no_drive_capacity()
                continue

            self._append_event(
                status=DutyStatus.DRIVING,
                duration=chunk_hours,
                label=f"Driving — {leg.label}",
                miles=chunk_miles,
            )
            self.state.driving_in_window += chunk_hours
            self.state.duty_window_elapsed += chunk_hours
            self.state.driving_since_break += chunk_hours
            self.state.miles_since_fuel += chunk_miles
            self.state.cycle_used += chunk_hours
            self.state.miles += chunk_miles

            remaining_miles -= chunk_miles
            remaining_hours = max(0.0, remaining_hours - chunk_hours)

            # Mandatory 30-min break after 8 hrs cumulative driving
            if self.state.driving_since_break >= BREAK_AFTER_DRIVING_HOURS - 1e-9:
                if remaining_miles > 1e-6:
                    self._insert_30_break()

            # Fuel if we hit interval
            if self.state.miles_since_fuel >= FUEL_INTERVAL_MILES - 1e-6:
                if remaining_miles > 1e-6:
                    self._insert_fuel_stop()

    def _max_continuous_drive_hours(self) -> float:
        """Hours of driving still allowed before any hard stop."""
        if not self.state.window_open:
            return 0.0

        caps = [
            DRIVING_LIMIT_HOURS - self.state.driving_in_window,
            DUTY_WINDOW_HOURS - self.state.duty_window_elapsed,
            BREAK_AFTER_DRIVING_HOURS - self.state.driving_since_break,
            CYCLE_LIMIT_HOURS - self.state.cycle_used,
        ]
        # Room until fuel (caller also checks; include as soft via miles)
        return max(0.0, min(caps))

    def _resolve_no_drive_capacity(self) -> None:
        """Insert the appropriate non-driving action when drive cap is 0."""
        cycle_left = CYCLE_LIMIT_HOURS - self.state.cycle_used
        if cycle_left <= 1e-9:
            self._insert_34_restart()
            return

        # Need break if driving_since_break is at limit but window still has room
        if self.state.driving_since_break >= BREAK_AFTER_DRIVING_HOURS - 1e-9:
            if (
                self.state.driving_in_window < DRIVING_LIMIT_HOURS - 1e-9
                and self.state.duty_window_elapsed + BREAK_DURATION_HOURS
                <= DUTY_WINDOW_HOURS + 1e-9
            ):
                self._insert_30_break()
                return

        # Otherwise need a 10-hour rest to open a new window
        self._insert_10_rest()

    # -- inserts ------------------------------------------------------------

    def _ensure_window_open(self) -> None:
        if not self.state.window_open:
            # Coming on duty starts the 14-hour window when first on-duty/drive
            self.state.window_open = True
            self.state.driving_in_window = 0.0
            self.state.duty_window_elapsed = 0.0
            self.state.driving_since_break = 0.0

    def _ensure_cycle_capacity(self, min_needed: float) -> None:
        if CYCLE_LIMIT_HOURS - self.state.cycle_used < min_needed:
            self._insert_34_restart()

    def _insert_30_break(self) -> None:
        # Break does NOT extend past 14-hr window for driving afterward;
        # break itself can occur within the window and counts toward 14-hr.
        self._ensure_window_open()
        # If break won't fit in remaining duty window, take 10-hr rest instead
        if self.state.duty_window_elapsed + BREAK_DURATION_HOURS > DUTY_WINDOW_HOURS + 1e-9:
            self._insert_10_rest()
            return

        self._append_event(
            status=DutyStatus.OFF_DUTY,
            duration=BREAK_DURATION_HOURS,
            label="30-minute break",
            stop_kind=StopKind.BREAK_30,
        )
        self.state.duty_window_elapsed += BREAK_DURATION_HOURS
        # 30-min break does not count toward 70-hr cycle (off-duty)
        self.state.driving_since_break = 0.0
        self._break_count += 1
        self.stops.append(
            StopMarker(
                kind=StopKind.BREAK_30,
                label="30-minute rest break",
                at_hours=self.state.t - BREAK_DURATION_HOURS,
                miles_from_start=self.state.miles,
                duration_hours=BREAK_DURATION_HOURS,
                day_index=self.state.day_index(),
            )
        )

    def _insert_fuel_stop(self) -> None:
        self._ensure_window_open()
        needed = FUEL_STOP_HOURS
        # Fuel is on-duty; need cycle + duty window room
        if CYCLE_LIMIT_HOURS - self.state.cycle_used < needed:
            self._insert_34_restart()
            self._ensure_window_open()

        if self.state.duty_window_elapsed + needed > DUTY_WINDOW_HOURS + 1e-9:
            self._insert_10_rest()
            self._ensure_window_open()

        self._append_event(
            status=DutyStatus.ON_DUTY,
            duration=needed,
            label="Fuel stop",
            stop_kind=StopKind.FUEL,
        )
        self.state.duty_window_elapsed += needed
        self.state.cycle_used += needed
        self.state.miles_since_fuel = 0.0
        self._fuel_count += 1
        self.stops.append(
            StopMarker(
                kind=StopKind.FUEL,
                label="Fuel stop",
                at_hours=self.state.t - needed,
                miles_from_start=self.state.miles,
                duration_hours=needed,
                day_index=self.state.day_index(),
            )
        )

    def _insert_10_rest(self) -> None:
        self._append_event(
            status=DutyStatus.OFF_DUTY,
            duration=MIN_OFF_DUTY_RESET_HOURS,
            label="10-hour off-duty reset",
            stop_kind=StopKind.REST_10,
        )
        self.state.window_open = False
        self.state.driving_in_window = 0.0
        self.state.duty_window_elapsed = 0.0
        self.state.driving_since_break = 0.0
        self._rest_count += 1
        self.stops.append(
            StopMarker(
                kind=StopKind.REST_10,
                label="10-hour off-duty reset",
                at_hours=self.state.t - MIN_OFF_DUTY_RESET_HOURS,
                miles_from_start=self.state.miles,
                duration_hours=MIN_OFF_DUTY_RESET_HOURS,
                day_index=self.state.day_index(),
            )
        )

    def _insert_34_restart(self) -> None:
        self._append_event(
            status=DutyStatus.OFF_DUTY,
            duration=RESTART_34_HOURS,
            label="34-hour restart (cycle reset)",
            stop_kind=StopKind.RESTART_34,
        )
        self.state.cycle_used = 0.0
        self.state.window_open = False
        self.state.driving_in_window = 0.0
        self.state.duty_window_elapsed = 0.0
        self.state.driving_since_break = 0.0
        self._restart_count += 1
        self.warnings.append(
            f"34-hour restart scheduled at t={self.state.t - RESTART_34_HOURS:.1f}h "
            "because the 70-hour/8-day cycle was exhausted."
        )
        self.stops.append(
            StopMarker(
                kind=StopKind.RESTART_34,
                label="34-hour restart",
                at_hours=self.state.t - RESTART_34_HOURS,
                miles_from_start=self.state.miles,
                duration_hours=RESTART_34_HOURS,
                day_index=self.state.day_index(),
            )
        )

    def insert_on_duty_stop(
        self,
        *,
        duration: float,
        label: str,
        stop_kind: StopKind,
    ) -> None:
        """Public helper for pickup/dropoff on-duty blocks."""
        self._ensure_cycle_capacity(min_needed=duration)
        self._ensure_window_open()

        # On-duty must fit in 14-hr window (does not require driving room)
        while self.state.duty_window_elapsed + duration > DUTY_WINDOW_HOURS + 1e-9:
            self._insert_10_rest()
            self._ensure_window_open()
            self._ensure_cycle_capacity(min_needed=duration)

        self._append_event(
            status=DutyStatus.ON_DUTY,
            duration=duration,
            label=label,
            stop_kind=stop_kind,
        )
        self.state.duty_window_elapsed += duration
        self.state.cycle_used += duration
        self.stops.append(
            StopMarker(
                kind=stop_kind,
                label=label,
                at_hours=self.state.t - duration,
                miles_from_start=self.state.miles,
                duration_hours=duration,
                day_index=self.state.day_index(),
            )
        )

    def _append_event(
        self,
        *,
        status: DutyStatus,
        duration: float,
        label: str,
        miles: float = 0.0,
        stop_kind: StopKind | None = None,
    ) -> None:
        if duration <= 0:
            return
        start = self.state.t
        end = start + duration
        self.events.append(
            HosEvent(
                status=status,
                start_hours=start,
                end_hours=end,
                label=label,
                miles=miles,
                stop_kind=stop_kind,
                day_index=self.state.day_index(),
            )
        )
        self.state.t = end

    def _build_summary(self) -> PlanSummary:
        driving = sum(e.duration_hours for e in self.events if e.status == DutyStatus.DRIVING)
        on_duty = sum(
            e.duration_hours
            for e in self.events
            if e.status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY)
        )
        off_duty = sum(
            e.duration_hours
            for e in self.events
            if e.status in (DutyStatus.OFF_DUTY, DutyStatus.SLEEPER)
        )
        days = 1
        if self.events:
            last = self.events[-1].end_hours
            days = int((self.request.start_hour_of_day + last - 1e-9) // 24) + 1

        return PlanSummary(
            total_miles=round(self.state.miles, 2),
            total_driving_hours=round(driving, 3),
            total_on_duty_hours=round(on_duty, 3),
            total_off_duty_hours=round(off_duty, 3),
            trip_duration_hours=round(self.state.t, 3),
            days_required=days,
            fuel_stops=self._fuel_count,
            breaks_30=self._break_count,
            rests_10=self._rest_count,
            restarts_34=self._restart_count,
            cycle_used_at_start=round(self.request.cycle_used_hours, 3),
            cycle_used_at_end=round(self.state.cycle_used, 3),
            cycle_remaining_at_end=round(CYCLE_LIMIT_HOURS - self.state.cycle_used, 3),
        )


# ---------------------------------------------------------------------------
# Day log splitting (for paper-style ELD grids)
# ---------------------------------------------------------------------------


def build_day_segments(
    events: list[HosEvent],
    start_hour_of_day: float,
) -> list[DayLogSegment]:
    """Split timeline events into per-calendar-day segments (midnight boundaries)."""
    segments: list[DayLogSegment] = []
    for event in events:
        abs_start = start_hour_of_day + event.start_hours
        abs_end = start_hour_of_day + event.end_hours
        total_dur = event.duration_hours
        if total_dur <= 0:
            continue

        cursor = abs_start
        while cursor < abs_end - 1e-12:
            day_idx = int(cursor // 24)
            day_end_abs = (day_idx + 1) * 24.0
            slice_end = min(abs_end, day_end_abs)
            dur = slice_end - cursor
            mile_share = event.miles * (dur / total_dur) if event.miles else 0.0

            start_hod = cursor - day_idx * 24.0
            end_hod = slice_end - day_idx * 24.0
            # Midnight end of day → 24.0 on the grid
            if abs(end_hod - 0.0) < 1e-9 or end_hod >= 24.0 - 1e-9:
                end_hod = 24.0

            if dur > 1e-9:
                segments.append(
                    DayLogSegment(
                        day_index=day_idx,
                        status=event.status,
                        start_hour_of_day=round(start_hod, 6),
                        end_hour_of_day=round(end_hod, 6),
                        label=event.label,
                        miles=round(mile_share, 3),
                    )
                )
            cursor = slice_end

    return segments


# ---------------------------------------------------------------------------
# Convenience builders
# ---------------------------------------------------------------------------


def plan_trip(
    *,
    deadhead_miles: float,
    deadhead_hours: float | None = None,
    loaded_miles: float,
    loaded_hours: float | None = None,
    cycle_used_hours: float,
    start_hour_of_day: float = 6.0,
    average_speed_mph: float = DEFAULT_SPEED_MPH,
    include_pickup: bool = True,
    include_dropoff: bool = True,
) -> PlanResult:
    """
    High-level planner: current → pickup → dropoff with HOS compliance.

    If deadhead_miles < NEAR_ZERO_MILES, deadhead is skipped (current ≈ pickup).
    """
    _validate_plan_inputs(
        cycle_used_hours=cycle_used_hours,
        start_hour_of_day=start_hour_of_day,
        average_speed_mph=average_speed_mph,
    )
    if loaded_miles < 0 or deadhead_miles < 0:
        raise ValueError("mileages must be >= 0")

    speed = average_speed_mph
    if deadhead_hours is None:
        deadhead_hours = deadhead_miles / speed if deadhead_miles > 0 else 0.0
    if loaded_hours is None:
        loaded_hours = loaded_miles / speed if loaded_miles > 0 else 0.0

    # Miles without duration (or vice versa) — keep clocks consistent
    if deadhead_miles >= NEAR_ZERO_MILES and deadhead_hours <= 0:
        deadhead_hours = deadhead_miles / speed
    if loaded_miles >= NEAR_ZERO_MILES and loaded_hours <= 0:
        loaded_hours = loaded_miles / speed
    if deadhead_hours > 0 and deadhead_miles <= 0:
        deadhead_miles = deadhead_hours * speed
    if loaded_hours > 0 and loaded_miles <= 0:
        loaded_miles = loaded_hours * speed

    if loaded_miles < NEAR_ZERO_MILES:
        raise ValueError("loaded haul distance must be greater than ~1 mile")

    planner = _planner_without_legs(
        cycle_used_hours=cycle_used_hours,
        start_hour_of_day=start_hour_of_day,
        average_speed_mph=speed,
    )

    planner.stops.append(
        StopMarker(
            kind=StopKind.START,
            label="Current location / trip start",
            at_hours=0.0,
            miles_from_start=0.0,
            day_index=0,
        )
    )
    planner._ensure_cycle_capacity(min_needed=0.1)

    # Deadhead
    if deadhead_miles >= NEAR_ZERO_MILES:
        planner._drive_leg(
            RouteLeg(
                label="Deadhead to pickup",
                distance_miles=deadhead_miles,
                duration_hours=deadhead_hours,
            )
        )
    else:
        planner.warnings.append(
            "Current location ≈ pickup; deadhead leg skipped."
        )

    if include_pickup:
        planner.insert_on_duty_stop(
            duration=PICKUP_ON_DUTY_HOURS,
            label="Pickup (on-duty not driving)",
            stop_kind=StopKind.PICKUP,
        )

    planner._drive_leg(
        RouteLeg(
            label="Loaded haul to dropoff",
            distance_miles=loaded_miles,
            duration_hours=loaded_hours,
        )
    )

    if include_dropoff:
        planner.insert_on_duty_stop(
            duration=DROPOFF_ON_DUTY_HOURS,
            label="Dropoff (on-duty not driving)",
            stop_kind=StopKind.DROPOFF,
        )

    planner.stops.append(
        StopMarker(
            kind=StopKind.END,
            label="Trip complete",
            at_hours=planner.state.t,
            miles_from_start=planner.state.miles,
            day_index=planner.state.day_index(),
        )
    )

    day_segments = build_day_segments(planner.events, start_hour_of_day)
    summary = planner._build_summary()
    return PlanResult(
        events=list(planner.events),
        stops=list(planner.stops),
        day_segments=day_segments,
        summary=summary,
        warnings=list(planner.warnings),
    )


def _validate_plan_inputs(
    *,
    cycle_used_hours: float,
    start_hour_of_day: float,
    average_speed_mph: float,
) -> None:
    if cycle_used_hours < 0:
        raise ValueError("cycle_used_hours must be >= 0")
    if cycle_used_hours > CYCLE_LIMIT_HOURS:
        raise ValueError(f"cycle_used_hours cannot exceed {CYCLE_LIMIT_HOURS}")
    if not 0 <= start_hour_of_day < 24:
        raise ValueError("start_hour_of_day must be in [0, 24)")
    if average_speed_mph <= 0:
        raise ValueError("average_speed_mph must be > 0")


def _planner_without_legs(
    *,
    cycle_used_hours: float,
    start_hour_of_day: float,
    average_speed_mph: float,
) -> HosPlanner:
    """Create a planner used by plan_trip (legs driven manually with pickup/dropoff)."""
    req = PlanRequest(
        legs=[RouteLeg(label="_placeholder", distance_miles=0.0, duration_hours=0.0)],
        cycle_used_hours=cycle_used_hours,
        start_hour_of_day=start_hour_of_day,
        average_speed_mph=average_speed_mph,
    )
    return HosPlanner(req)


def assert_plan_compliant(result: PlanResult) -> list[str]:
    """
    Post-condition checks used by tests (and optionally API warnings).

    Returns a list of violation strings (empty => OK).
    """
    violations: list[str] = []
    driving_in_window = 0.0
    duty_elapsed = 0.0
    driving_since_break = 0.0
    window_open = False
    cycle = result.summary.cycle_used_at_start if result.summary else 0.0
    miles_since_fuel = 0.0

    for e in result.events:
        if e.stop_kind == StopKind.RESTART_34:
            cycle = 0.0
            window_open = False
            driving_in_window = 0.0
            duty_elapsed = 0.0
            driving_since_break = 0.0
            continue

        if e.stop_kind == StopKind.REST_10 and e.duration_hours >= MIN_OFF_DUTY_RESET_HOURS - 1e-6:
            window_open = False
            driving_in_window = 0.0
            duty_elapsed = 0.0
            driving_since_break = 0.0
            continue

        if e.status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY):
            if not window_open:
                window_open = True
                driving_in_window = 0.0
                duty_elapsed = 0.0
                driving_since_break = 0.0
            duty_elapsed += e.duration_hours
            cycle += e.duration_hours
            if duty_elapsed > DUTY_WINDOW_HOURS + 1e-6:
                violations.append(
                    f"14-hour window exceeded at t={e.end_hours:.2f} ({duty_elapsed:.2f}h)"
                )
            if cycle > CYCLE_LIMIT_HOURS + 1e-6:
                violations.append(
                    f"70-hour cycle exceeded at t={e.end_hours:.2f} ({cycle:.2f}h)"
                )

        if e.status == DutyStatus.DRIVING:
            driving_in_window += e.duration_hours
            driving_since_break += e.duration_hours
            miles_since_fuel += e.miles
            if driving_in_window > DRIVING_LIMIT_HOURS + 1e-6:
                violations.append(
                    f"11-hour driving limit exceeded at t={e.end_hours:.2f}"
                )
            if driving_since_break > BREAK_AFTER_DRIVING_HOURS + 1e-6:
                violations.append(
                    f"Drove >8h without 30-min break at t={e.end_hours:.2f}"
                )
            if miles_since_fuel > FUEL_INTERVAL_MILES + 1.0:
                violations.append(
                    f"Drove >1000 miles without fuel at t={e.end_hours:.2f}"
                )

        if e.stop_kind == StopKind.BREAK_30:
            driving_since_break = 0.0
            # Off-duty/sleeper break still counts toward the 14-hour window.
            if e.status in (DutyStatus.OFF_DUTY, DutyStatus.SLEEPER) and window_open:
                duty_elapsed += e.duration_hours
                if duty_elapsed > DUTY_WINDOW_HOURS + 1e-6:
                    violations.append(
                        f"14-hour window exceeded during break at t={e.end_hours:.2f}"
                    )

        if e.stop_kind == StopKind.FUEL:
            miles_since_fuel = 0.0

    return violations
