import type { DayLogSegment, DutyStatus, HosEvent, StopMarker, TripPlanResponse } from '../types'

export const DUTY_ROWS: DutyStatus[] = ['off_duty', 'sleeper', 'driving', 'on_duty']

export const DUTY_ROW_LABELS: Record<DutyStatus, string> = {
  off_duty: '1 Off Duty',
  sleeper: '2 Sleeper Berth',
  driving: '3 Driving',
  on_duty: '4 On Duty (Not Driving)',
}

export interface FilledSegment {
  status: DutyStatus
  start: number
  end: number
  label: string
  miles: number
  isGap: boolean
}

export interface DayRemark {
  time: number
  text: string
}

export interface CalendarDate {
  year: number
  month: number
  day: number
}

export interface DayLogModel {
  dayIndex: number
  calendarDate: CalendarDate
  segments: FilledSegment[]
  totals: Record<DutyStatus, number>
  remarks: DayRemark[]
  totalMiles: number
  coveredHours: number
}

function clampHour(h: number): number {
  if (!Number.isFinite(h)) return 0
  return Math.min(24, Math.max(0, h))
}

/** Fill uncovered hours with Off Duty so each sheet spans a full 24h grid. */
export function fillDaySegments(raw: DayLogSegment[]): FilledSegment[] {
  const sorted = [...raw]
    .map((s) => ({
      status: s.status,
      start: clampHour(s.start_hour_of_day),
      end: clampHour(s.end_hour_of_day),
      label: s.label,
      miles: s.miles || 0,
      isGap: false,
    }))
    .filter((s) => s.end > s.start + 1e-6)
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const filled: FilledSegment[] = []
  let cursor = 0

  for (const seg of sorted) {
    const start = Math.max(seg.start, cursor)
    if (seg.start > cursor + 1e-6) {
      filled.push({
        status: 'off_duty',
        start: cursor,
        end: Math.min(seg.start, 24),
        label: 'Off duty',
        miles: 0,
        isGap: true,
      })
      cursor = seg.start
    }
    if (start >= seg.end - 1e-9) continue
    filled.push({
      status: seg.status,
      start,
      end: seg.end,
      label: seg.label,
      miles: seg.miles,
      isGap: false,
    })
    cursor = Math.max(cursor, seg.end)
  }

  if (cursor < 24 - 1e-6) {
    filled.push({
      status: 'off_duty',
      start: cursor,
      end: 24,
      label: 'Off duty',
      miles: 0,
      isGap: true,
    })
  }

  return mergeAdjacent(filled)
}

function mergeAdjacent(segs: FilledSegment[]): FilledSegment[] {
  if (!segs.length) return segs
  const out: FilledSegment[] = [{ ...segs[0] }]
  for (let i = 1; i < segs.length; i++) {
    const prev = out[out.length - 1]
    const cur = segs[i]
    if (
      prev.status === cur.status &&
      prev.isGap === cur.isGap &&
      Math.abs(prev.end - cur.start) < 1e-6 &&
      (prev.isGap || prev.label === cur.label)
    ) {
      prev.end = cur.end
      prev.miles += cur.miles
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

export function totalsFor(segments: FilledSegment[]): Record<DutyStatus, number> {
  const totals: Record<DutyStatus, number> = {
    off_duty: 0,
    sleeper: 0,
    driving: 0,
    on_duty: 0,
  }
  for (const s of segments) {
    totals[s.status] += s.end - s.start
  }
  // Round lightly for display stability
  for (const k of DUTY_ROWS) {
    totals[k] = Math.round(totals[k] * 1000) / 1000
  }
  return totals
}

/** Normalize for near-duplicate detection (Fuel stop ≈ Fuel, 30-min break variants). */
function remarkFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/driving\s*[—–-]\s*/g, '')
    .replace(/loaded haul to (dropoff|pickup)/g, 'drive')
    .replace(/on-duty not driving/g, 'onduty')
    .replace(/30-minute(\s+rest)?\s+break/g, 'break30')
    .replace(/10-hour off-duty reset/g, 'rest10')
    .replace(/34-hour restart/g, 'restart34')
    .replace(/fuel(\s+stop)?/g, 'fuel')
    .replace(/[^a-z0-9]/g, '')
}

export function shortenRemarkLabel(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^Driving\s*[—–-]\s*/i, '')
    .replace(/Loaded haul to dropoff/i, 'Driving')
    .replace(/Loaded haul to pickup/i, 'Driving (to pickup)')
    .replace(/\bon-duty not driving\b/gi, 'on-duty')
    .replace(/30-minute rest break/gi, '30-min break')
    .replace(/30-minute break/gi, '30-min break')
    .replace(/10-hour off-duty reset/gi, '10h reset')
    .replace(/34-hour restart/gi, '34h restart')
    .replace(/Fuel stop/gi, 'Fuel')
    .replace(/Pickup \(on-duty not driving\)/gi, 'Pickup')
    .replace(/Dropoff \(on-duty not driving\)/gi, 'Dropoff')
    .replace(/Dropoff \(on-duty\)/gi, 'Dropoff')
    .replace(/Pickup \(on-duty\)/gi, 'Pickup')
}

export function buildRemarks(
  segments: FilledSegment[],
  stops: StopMarker[],
  dayIndex: number,
  startHourOfDay: number,
): DayRemark[] {
  const remarks: DayRemark[] = []

  const isDuplicate = (time: number, text: string) => {
    const fp = remarkFingerprint(text)
    return remarks.some(
      (r) =>
        Math.abs(r.time - time) < 0.85 &&
        (remarkFingerprint(r.text) === fp ||
          remarkFingerprint(r.text).includes(fp) ||
          fp.includes(remarkFingerprint(r.text))),
    )
  }

  // Prefer stop markers (location / operational events) — matches FMCSA "remarks" intent.
  for (const stop of stops) {
    if (stop.day_index !== dayIndex) continue
    if (!['pickup', 'dropoff', 'fuel', 'break_30', 'rest_10', 'restart_34'].includes(stop.kind)) {
      continue
    }
    const abs = startHourOfDay + stop.at_hours
    const hod = abs - dayIndex * 24
    if (hod < -0.01 || hod > 24.01) continue
    const t = clampHour(hod)
    const text = shortenRemarkLabel(stop.label)
    if (isDuplicate(t, text)) continue
    remarks.push({ time: t, text })
  }

  // Segment remarks only for non-driving ops not already covered by a stop.
  for (const seg of segments) {
    if (seg.isGap) continue
    // Skip generic haul lines — they duplicate and crowd the timeline.
    if (/loaded haul|driving\s*[—–-]/i.test(seg.label) && seg.status === 'driving') {
      continue
    }
    const interesting =
      /pickup|dropoff|fuel|break|rest|restart/i.test(seg.label) ||
      seg.status === 'on_duty' ||
      (seg.status === 'off_duty' && /break|rest|restart/i.test(seg.label)) ||
      seg.status === 'sleeper'
    if (!interesting) continue
    const text = shortenRemarkLabel(seg.label)
    if (isDuplicate(seg.start, text)) continue
    remarks.push({ time: seg.start, text })
  }

  return remarks.sort((a, b) => a.time - b.time || a.text.localeCompare(b.text)).slice(0, 10)
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function inferTripStartDate(plan: TripPlanResponse): string {
  const meta = plan.meta?.trip_start_date
  if (typeof meta === 'string' && ISO_DATE_RE.test(meta)) {
    return meta
  }
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Calendar date for a log sheet day (start date + dayIndex calendar days). */
export function calendarDateForLogDay(startIso: string, dayIndex: number): CalendarDate {
  const [y, m, d] = startIso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + dayIndex)
  return {
    year: dt.getFullYear(),
    month: dt.getMonth() + 1,
    day: dt.getDate(),
  }
}

export function formatLogSheetDate(date: CalendarDate): string {
  const month = String(date.month).padStart(2, '0')
  const day = String(date.day).padStart(2, '0')
  return `${month} / ${day} / ${date.year}`
}

export function formatLogSheetDateCompact(date: CalendarDate): string {
  const month = String(date.month).padStart(2, '0')
  const day = String(date.day).padStart(2, '0')
  return `${month}/${day}/${date.year}`
}

export function inferStartHourOfDay(plan: TripPlanResponse): number {
  const metaHour = plan.meta?.start_hour_of_day
  if (typeof metaHour === 'number' && Number.isFinite(metaHour)) {
    return ((metaHour % 24) + 24) % 24
  }
  const first = plan.day_segments[0]
  const firstEvent = plan.events[0]
  if (first && firstEvent && first.day_index === 0) {
    if (Math.abs(firstEvent.start_hours) < 1e-6) {
      return first.start_hour_of_day
    }
  }
  return 6
}

export function buildDayLogs(plan: TripPlanResponse): DayLogModel[] {
  const startHour = inferStartHourOfDay(plan)
  const tripStartDate = inferTripStartDate(plan)
  const byDay = new Map<number, DayLogSegment[]>()
  for (const seg of plan.day_segments) {
    const list = byDay.get(seg.day_index) ?? []
    list.push(seg)
    byDay.set(seg.day_index, list)
  }

  // Ensure contiguous day indexes from 0..max
  const maxDay = Math.max(0, ...byDay.keys(), (plan.summary?.days_required ?? 1) - 1)
  const days: DayLogModel[] = []

  for (let d = 0; d <= maxDay; d++) {
    const filled = fillDaySegments(byDay.get(d) ?? [])
    const totals = totalsFor(filled)
    const totalMiles = filled.reduce((sum, s) => sum + (s.miles || 0), 0)
    const coveredHours = DUTY_ROWS.reduce((sum, k) => sum + totals[k], 0)
    days.push({
      dayIndex: d,
      calendarDate: calendarDateForLogDay(tripStartDate, d),
      segments: filled,
      totals,
      remarks: buildRemarks(filled, plan.stops, d, startHour),
      totalMiles: Math.round(totalMiles * 10) / 10,
      coveredHours: Math.round(coveredHours * 1000) / 1000,
    })
  }

  return days
}

/** Orthogonal (no diagonal) duty graph path — H then V steps only. */
export function dutyLinePoints(
  segments: FilledSegment[],
  gridX: number,
  gridY: number,
  gridW: number,
  rowH: number,
): string {
  if (!segments.length) return ''

  const yFor = (status: DutyStatus) =>
    Math.round((gridY + DUTY_ROWS.indexOf(status) * rowH + rowH / 2) * 100) / 100
  const xFor = (hour: number) =>
    Math.round((gridX + (clampHour(hour) / 24) * gridW) * 100) / 100

  const parts: string[] = []
  let prevX: number | null = null
  let prevY: number | null = null

  for (const seg of segments) {
    if (seg.end <= seg.start + 1e-9) continue
    const x0 = xFor(seg.start)
    const x1 = xFor(seg.end)
    const y = yFor(seg.status)

    if (prevX === null || prevY === null) {
      parts.push(`M ${x0} ${y}`)
    } else {
      // Vertical step at the boundary (never diagonal)
      if (Math.abs(prevY - y) > 0.05) {
        parts.push(`L ${prevX} ${y}`)
      }
      // If a tiny gap exists, draw horizontal on the new row to x0
      if (Math.abs(prevX - x0) > 0.05) {
        parts.push(`L ${x0} ${y}`)
      }
    }
    parts.push(`L ${x1} ${y}`)
    prevX = x1
    prevY = y
  }

  return parts.join(' ')
}

export function formatLogTime(hour: number): string {
  const totalMin = Math.round(clampHour(hour) * 60)
  const hh = Math.floor(totalMin / 60) % 24
  const mm = totalMin % 60
  const suffix = hh >= 12 ? 'PM' : 'AM'
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`
}

export function formatTotalHours(h: number): string {
  const totalMin = Math.round(Math.max(0, h) * 60)
  const hours = Math.floor(totalMin / 60)
  const minutes = totalMin % 60
  return `${hours}:${String(minutes).padStart(2, '0')}`
}

/** Pure helper exported for quick sanity checks in console / future tests. */
export function assertDayTotalsNear24(day: DayLogModel, tol = 0.05): boolean {
  return Math.abs(day.coveredHours - 24) <= tol
}

export function collectEventRemarksForDay(
  events: HosEvent[],
  dayIndex: number,
  startHourOfDay: number,
): DayRemark[] {
  const out: DayRemark[] = []
  for (const ev of events) {
    const absStart = startHourOfDay + ev.start_hours
    const absEnd = startHourOfDay + ev.end_hours
    const dayStart = dayIndex * 24
    const dayEnd = dayStart + 24
    if (absEnd <= dayStart || absStart >= dayEnd) continue
    if (!ev.stop_kind) continue
    const hod = Math.max(0, absStart - dayStart)
    out.push({ time: hod, text: ev.label })
  }
  return out
}
