import { describe, expect, it } from 'vitest'
import type { DayLogSegment, StopMarker } from '../types'
import {
  assertDayTotalsNear24,
  buildRemarks,
  fillDaySegments,
  totalsFor,
} from './logSheet'

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
