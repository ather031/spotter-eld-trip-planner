import { describe, expect, it } from 'vitest'
import type { DayLogSegment, StopMarker, TripPlanResponse } from '../types'
import {
  assertDayTotalsNear24,
  buildDayLogs,
  buildRemarks,
  calendarDateForLogDay,
  fillDaySegments,
  formatLogSheetDate,
  totalsFor,
} from './logSheet'

function planStub(overrides: Partial<TripPlanResponse> = {}): TripPlanResponse {
  const geo = { lat: 0, lon: 0, display_name: 'Test', source: 'test' }
  return {
    locations: { current: geo, pickup: geo, dropoff: geo },
    route: {
      geometry: [],
      distance_miles: 0,
      duration_hours: 0,
      legs: [],
      provider: 'test',
    },
    stops: [],
    events: [],
    day_segments: [],
    summary: null,
    warnings: [],
    meta: {},
    ...overrides,
  }
}

describe('fillDaySegments', () => {
  it('fills leading and trailing gaps as off duty to 24h', () => {
    const raw: DayLogSegment[] = [
      {
        day_index: 0,
        status: 'driving',
        start_hour_of_day: 6,
        end_hour_of_day: 10,
        duration_hours: 4,
        label: 'Driving',
        miles: 200,
      },
    ]
    const filled = fillDaySegments(raw)
    const totals = totalsFor(filled)
    expect(totals.driving).toBeCloseTo(4, 3)
    expect(totals.off_duty).toBeCloseTo(20, 3)
    expect(assertDayTotalsNear24({
      dayIndex: 0,
      calendarDate: { year: 2026, month: 4, day: 9 },
      segments: filled,
      totals,
      remarks: [],
      totalMiles: 200,
      coveredHours: Object.values(totals).reduce((a, b) => a + b, 0),
    })).toBe(true)
  })

  it('fills midnight-crossing already-split segments without overlap', () => {
    const raw: DayLogSegment[] = [
      {
        day_index: 0,
        status: 'on_duty',
        start_hour_of_day: 22,
        end_hour_of_day: 24,
        duration_hours: 2,
        label: 'Pickup',
        miles: 0,
      },
    ]
    const filled = fillDaySegments(raw)
    expect(filled[0].start).toBe(0)
    expect(filled[0].status).toBe('off_duty')
    expect(filled.at(-1)?.end).toBe(24)
    const sum = filled.reduce((a, s) => a + (s.end - s.start), 0)
    expect(sum).toBeCloseTo(24, 5)
  })

  it('handles empty day as full off duty', () => {
    const filled = fillDaySegments([])
    expect(filled).toHaveLength(1)
    expect(filled[0].status).toBe('off_duty')
    expect(filled[0].end - filled[0].start).toBeCloseTo(24, 5)
  })
})

describe('buildRemarks', () => {
  it('dedupes stop + segment near-duplicates and skips haul lines', () => {
    const segments = fillDaySegments([
      {
        day_index: 0,
        status: 'driving',
        start_hour_of_day: 7,
        end_hour_of_day: 8,
        duration_hours: 1,
        label: 'Driving — Loaded haul to dropoff',
        miles: 50,
      },
      {
        day_index: 0,
        status: 'on_duty',
        start_hour_of_day: 8,
        end_hour_of_day: 8.5,
        duration_hours: 0.5,
        label: '30-minute rest break',
        miles: 0,
      },
    ])
    const stops: StopMarker[] = [
      {
        kind: 'break_30',
        label: '30-minute break',
        at_hours: 2,
        day_index: 0,
        miles_from_start: 50,
        duration_hours: 0.5,
        lat: 0,
        lon: 0,
      },
      {
        kind: 'fuel',
        label: 'Fuel stop',
        at_hours: 2.1,
        day_index: 0,
        miles_from_start: 55,
        duration_hours: 0.25,
        lat: 0,
        lon: 0,
      },
    ]
    const remarks = buildRemarks(segments, stops, 0, 6)
    expect(remarks.some((r) => /loaded haul/i.test(r.text))).toBe(false)
    const breakish = remarks.filter((r) => /break/i.test(r.text))
    expect(breakish.length).toBe(1)
    expect(remarks.some((r) => /fuel/i.test(r.text))).toBe(true)
  })
})

describe('buildDayLogs calendar dates', () => {
  it('assigns consecutive calendar dates from trip_start_date', () => {
    const plan = planStub({
      meta: { trip_start_date: '2026-01-30' },
      day_segments: [
        {
          day_index: 0,
          status: 'off_duty',
          start_hour_of_day: 0,
          end_hour_of_day: 24,
          duration_hours: 24,
          label: 'Off duty',
          miles: 0,
        },
      ],
      summary: {
        total_miles: 0,
        total_driving_hours: 0,
        total_on_duty_hours: 0,
        total_off_duty_hours: 0,
        trip_duration_hours: 0,
        days_required: 3,
        fuel_stops: 0,
        breaks_30: 0,
        rests_10: 0,
        restarts_34: 0,
        cycle_used_at_start: 0,
        cycle_used_at_end: 0,
        cycle_remaining_at_end: 70,
      },
    })

    const days = buildDayLogs(plan)
    expect(days).toHaveLength(3)
    expect(days[0].calendarDate).toEqual({ year: 2026, month: 1, day: 30 })
    expect(days[1].calendarDate).toEqual({ year: 2026, month: 1, day: 31 })
    expect(days[2].calendarDate).toEqual({ year: 2026, month: 2, day: 1 })
    expect(formatLogSheetDate(days[0].calendarDate)).toBe('01 / 30 / 2026')
    expect(formatLogSheetDate(days[2].calendarDate)).toBe('02 / 01 / 2026')
  })

  it('rolls year boundary correctly', () => {
    expect(calendarDateForLogDay('2026-12-31', 0)).toEqual({ year: 2026, month: 12, day: 31 })
    expect(calendarDateForLogDay('2026-12-31', 1)).toEqual({ year: 2027, month: 1, day: 1 })
  })
})
