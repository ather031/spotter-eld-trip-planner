import { useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import type { TripPlanResponse } from '../types'
import {
  DUTY_ROWS,
  assertDayTotalsNear24,
  buildDayLogs,
  formatLogSheetDate,
  formatLogSheetDateCompact,
  dutyLinePoints,
  shortenRemarkLabel,
  type DayLogModel,
  type DayRemark,
} from '../lib/logSheet'

/** FMCSA completed-log style: 10, 1.75, 7.75, 4.5 */
function formatFmcsaHours(h: number): string {
  const rounded = Math.round(Math.max(0, h) * 100) / 100
  return String(rounded)
}

/**
 * Layout mirrors FMCSA Interstate Truck Driver’s Guide to HOS (April 2022)
 * “Driver’s Daily Log” / Graph Grid (pages 15–19).
 * Axis: Midnight, 2–11, Noon, 13–23, Midnight.
 */

const W = 1120
const H = 860

const INK = '#1a365d'
const INK_MUTED = '#4a5568'
const LINE = '#2c5282'
const PAPER = '#f8fafc'
const SHEET = '#ffffff'
const LINE_BLUE = '#1e3a8a'

/** Soft row fills like the FMCSA colored examples */
const ROW_FILLS = ['#dbeafe', '#93c5fd', '#fef08a', '#fde68a'] as const

const LABEL_W = 138
const TOTAL_W = 86
const PAD = 24

/**
 * Vertical rhythm (keep captions clear of next band / grid):
 * title → date row → carrier/sig → office/co-driver → gap → hour labels → grid
 */
const GRID_TOP = 214
const GRID_H = 216
const ROW_H = GRID_H / 4
const GRID_X = PAD + LABEL_W
const GRID_W = W - PAD * 2 - LABEL_W - TOTAL_W
const REMARKS_Y = GRID_TOP + GRID_H + 40
const REMARKS_H = 230
const REMARKS_RULER_Y = REMARKS_Y + 36
const REMARK_ROW_STEP = 36
const REMARK_MAX_ROWS = 5
const REMARK_CHAR_W = 5.6
const REMARK_GAP_PX = 14

const ROW_LABELS = [
  'Off Duty',
  'Sleeper Berth',
  'Driving',
  'On Duty (Not Driving)',
] as const

/** Official guide labels — skip hour 1; afternoon is 13–23 */
function fmcsaHourLabel(h: number): string | null {
  if (h === 0 || h === 24) return 'Midnight'
  if (h === 1) return null
  if (h === 12) return 'Noon'
  if (h >= 2 && h <= 11) return String(h)
  if (h >= 13 && h <= 23) return String(h)
  return null
}

function xAt(hour: number): number {
  return GRID_X + (hour / 24) * GRID_W
}

/** Value sits on the underline; caption sits below with clear gap (never on the value). */
function FormField({
  x,
  lineY,
  width,
  value,
  caption,
  valueSize = 12,
}: {
  x: number
  lineY: number
  width: number
  value: string
  caption: string
  valueSize?: number
}) {
  return (
    <g style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <text x={x} y={lineY - 6} fill={INK} style={{ fontSize: valueSize, fontWeight: 600 }}>
        {value}
      </text>
      <line x1={x} y1={lineY} x2={x + width} y2={lineY} stroke={INK} strokeWidth={1} />
      <text x={x} y={lineY + 13} fill={INK_MUTED} style={{ fontSize: 8 }}>
        {caption}
      </text>
    </g>
  )
}

/** Wrap remark copy into up to 2 lines; only ellipsize line 2 if needed. */
function wrapRemark(text: string, maxChars = 42): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return []
  if (cleaned.length <= maxChars) return [cleaned]

  const words = cleaned.split(' ')
  const line1: string[] = []
  const line2: string[] = []
  let len1 = 0
  for (const w of words) {
    const target = line1.length === 0 || len1 + 1 + w.length <= maxChars ? line1 : line2
    if (target === line1) {
      len1 += (line1.length ? 1 : 0) + w.length
      line1.push(w)
    } else {
      line2.push(w)
    }
  }
  if (!line2.length) return [line1.join(' ')]
  let second = line2.join(' ')
  if (second.length > maxChars) second = `${second.slice(0, maxChars - 1)}…`
  return [line1.join(' '), second]
}

interface EldLogSheetProps {
  day: DayLogModel
  driverName?: string
  carrierName?: string
  officeAddress?: string
  fromLabel?: string
  toLabel?: string
  vehicleNumber?: string
  shippingNo?: string
}

export function EldLogSheet({
  day,
  driverName = 'Demo Driver',
  carrierName = 'RouteLog Carrier',
  officeAddress = 'Property-carrying · 70/8 cycle',
  fromLabel,
  toLabel,
  vehicleNumber = '100 / 200',
  shippingNo,
}: EldLogSheetProps) {
  const path = useMemo(
    () => dutyLinePoints(day.segments, GRID_X, GRID_TOP, GRID_W, ROW_H),
    [day.segments],
  )
  const balanced = assertDayTotalsNear24(day)
  const drivingMiles = Math.round(
    day.segments.filter((s) => s.status === 'driving').reduce((a, s) => a + s.miles, 0),
  )
  const dateLabel = formatLogSheetDate(day.calendarDate)
  const pro = shippingNo ?? `${fromLabel ?? 'PU'} → ${toLabel ?? 'DO'}`

  const remarks = day.remarks
    .filter((r) => !/^off duty$/i.test(r.text.trim()))
    .map((r) => ({ ...r, text: shortenRemarkLabel(r.text) }))
    .slice(0, 8)

  const leftColW = 500
  const rightColX = PAD + 540
  const rightColW = W - PAD - rightColX

  return (
    <div className="overflow-x-auto rounded-sm border border-slate-300 bg-white shadow-[0_16px_40px_rgba(26,54,93,0.1)]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="min-w-[900px] w-full"
        role="img"
        aria-label={`FMCSA-style driver's daily log — day ${day.dayIndex + 1}`}
      >
        <rect width={W} height={H} fill={PAPER} />
        <rect x={10} y={10} width={W - 20} height={H - 20} fill={SHEET} stroke={INK} strokeWidth={1.75} />

        {/* ========== USDOT HEADER ========== */}
        <text
          x={W / 2}
          y={32}
          textAnchor="middle"
          fill={INK}
          style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 13, fontWeight: 700 }}
        >
          U.S. DEPARTMENT OF TRANSPORTATION
        </text>
        <text
          x={W / 2}
          y={50}
          textAnchor="middle"
          fill={INK}
          style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 15, fontWeight: 700 }}
        >
          DRIVER'S DAILY LOG
        </text>
        <text
          x={W / 2}
          y={66}
          textAnchor="middle"
          fill={INK_MUTED}
          style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 10 }}
        >
          (ONE CALENDAR DAY — 24 HOURS) · Property-carrying · Day {day.dayIndex + 1}
        </text>

        {/* Date | Miles | Vehicles — value then caption, no shared line collision */}
        <g style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
          <text x={PAD} y={88} fill={INK} style={{ fontSize: 13, fontWeight: 700 }}>
            {dateLabel}
          </text>
          <text x={PAD} y={102} fill={INK_MUTED} style={{ fontSize: 8 }}>
            (MONTH) (DAY) (YEAR)
          </text>

          <text x={PAD + 220} y={88} fill={INK} style={{ fontSize: 14, fontWeight: 700 }}>
            {drivingMiles || Math.round(day.totalMiles) || 0}
          </text>
          <text x={PAD + 220} y={102} fill={INK_MUTED} style={{ fontSize: 8 }}>
            (TOTAL MILES DRIVING TODAY)
          </text>

          <text x={PAD + 420} y={88} fill={INK} style={{ fontSize: 13, fontWeight: 600 }}>
            {vehicleNumber}
          </text>
          <text x={PAD + 420} y={102} fill={INK_MUTED} style={{ fontSize: 8 }}>
            VEHICLE NUMBERS—(SHOW EACH UNIT)
          </text>
        </g>

        {/* Carrier | Signature — underline + caption below */}
        <FormField
          x={PAD}
          lineY={128}
          width={leftColW}
          value={carrierName}
          caption="(NAME OF CARRIER OR CARRIERS)"
        />
        <text
          x={rightColX}
          y={112}
          fill={INK_MUTED}
          style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 8, fontStyle: 'italic' }}
        >
          I certify that these entries are true and correct
        </text>
        <FormField
          x={rightColX}
          lineY={128}
          width={rightColW}
          value={driverName}
          caption="(DRIVER'S SIGNATURE IN FULL)"
        />

        {/* Office | Co-driver — clear of grid hour labels */}
        <FormField
          x={PAD}
          lineY={164}
          width={leftColW}
          value={officeAddress}
          caption="(MAIN OFFICE ADDRESS)"
          valueSize={11}
        />
        <FormField
          x={rightColX}
          lineY={164}
          width={rightColW}
          value="—"
          caption="(NAME OF CO-DRIVER)"
          valueSize={11}
        />

        {/* ========== GRAPH GRID ========== */}
        {Array.from({ length: 25 }, (_, h) => {
          const label = fmcsaHourLabel(h)
          if (!label) return null
          const x = xAt(h)
          const edge = h === 0 || h === 12 || h === 24
          return (
            <text
              key={`top-${h}`}
              x={x}
              y={GRID_TOP - 12}
              textAnchor="middle"
              fill={edge ? LINE_BLUE : INK}
              style={{
                fontFamily: 'IBM Plex Sans, sans-serif',
                fontSize: edge ? 8 : 10,
                fontWeight: edge ? 700 : 600,
              }}
            >
              {label}
            </text>
          )
        })}

        {ROW_LABELS.map((label, i) => (
          <text
            key={label}
            x={GRID_X - 10}
            y={GRID_TOP + i * ROW_H + ROW_H / 2 + 4}
            textAnchor="end"
            fill={INK}
            style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 11, fontWeight: 700 }}
          >
            {label}
          </text>
        ))}

        {ROW_FILLS.map((fill, i) => (
          <rect
            key={`band-${i}`}
            x={GRID_X}
            y={GRID_TOP + i * ROW_H}
            width={GRID_W}
            height={ROW_H}
            fill={fill}
            opacity={0.55}
          />
        ))}
        <rect
          x={GRID_X}
          y={GRID_TOP}
          width={GRID_W}
          height={GRID_H}
          fill="none"
          stroke={INK}
          strokeWidth={1.75}
        />

        {[1, 2, 3].map((i) => (
          <line
            key={`h-${i}`}
            x1={GRID_X}
            x2={GRID_X + GRID_W}
            y1={GRID_TOP + i * ROW_H}
            y2={GRID_TOP + i * ROW_H}
            stroke={LINE}
            strokeWidth={1}
          />
        ))}

        {Array.from({ length: 97 }, (_, i) => {
          const hour = i / 4
          const x = xAt(hour)
          const q = i % 4
          const isHour = q === 0
          const isHalf = q === 2
          const tickLen = isHour ? GRID_H : isHalf ? 10 : 6
          return (
            <g key={`v-${i}`}>
              <line
                x1={x}
                x2={x}
                y1={GRID_TOP}
                y2={GRID_TOP + (isHour ? GRID_H : tickLen)}
                stroke={isHour ? LINE : '#64748b'}
                strokeWidth={isHour ? (hour === 12 ? 1.6 : 1.1) : 0.7}
              />
              {!isHour && (
                <line
                  x1={x}
                  x2={x}
                  y1={GRID_TOP + GRID_H - tickLen}
                  y2={GRID_TOP + GRID_H}
                  stroke="#64748b"
                  strokeWidth={0.7}
                />
              )}
            </g>
          )
        })}

        <text
          x={GRID_X + GRID_W + TOTAL_W / 2}
          y={GRID_TOP - 22}
          textAnchor="middle"
          fill={INK}
          style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 9, fontWeight: 700 }}
        >
          TOTAL
        </text>
        <text
          x={GRID_X + GRID_W + TOTAL_W / 2}
          y={GRID_TOP - 11}
          textAnchor="middle"
          fill={INK}
          style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 9, fontWeight: 700 }}
        >
          HOURS
        </text>
        {DUTY_ROWS.map((status, i) => {
          const y0 = GRID_TOP + i * ROW_H
          return (
            <g key={status}>
              <rect
                x={GRID_X + GRID_W}
                y={y0}
                width={TOTAL_W}
                height={ROW_H}
                fill="#fff"
                stroke={INK}
                strokeWidth={1.25}
              />
              <text
                x={GRID_X + GRID_W + TOTAL_W / 2}
                y={y0 + ROW_H / 2 + 5}
                textAnchor="middle"
                fill={INK}
                style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 14, fontWeight: 700 }}
              >
                {formatFmcsaHours(day.totals[status])}
              </text>
            </g>
          )
        })}
        {/* =24 sits in a small footer cell under totals */}
        <rect
          x={GRID_X + GRID_W}
          y={GRID_TOP + GRID_H}
          width={TOTAL_W}
          height={22}
          fill="#fff"
          stroke={INK}
          strokeWidth={1.25}
        />
        <text
          x={GRID_X + GRID_W + TOTAL_W / 2}
          y={GRID_TOP + GRID_H + 16}
          textAnchor="middle"
          fill={balanced ? '#166534' : '#9b1c1c'}
          style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 11, fontWeight: 700 }}
        >
          =24
        </text>

        {path && (
          <path
            d={path}
            fill="none"
            stroke={LINE_BLUE}
            strokeWidth={2.75}
            strokeLinejoin="miter"
            strokeLinecap="square"
          />
        )}

        {Array.from({ length: 25 }, (_, h) => {
          const label = fmcsaHourLabel(h)
          if (!label) return null
          const x = xAt(h)
          const edge = h === 0 || h === 12 || h === 24
          return (
            <text
              key={`bot-${h}`}
              x={x}
              y={GRID_TOP + GRID_H + 36}
              textAnchor="middle"
              fill={edge ? LINE_BLUE : INK}
              style={{
                fontFamily: 'IBM Plex Sans, sans-serif',
                fontSize: edge ? 8 : 10,
                fontWeight: edge ? 700 : 600,
              }}
            >
              {label}
            </text>
          )
        })}

        {/* ========== REMARKS ========== */}
        <text
          x={PAD}
          y={REMARKS_Y}
          fill={INK}
          style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 12, fontWeight: 700 }}
        >
          REMARKS
        </text>
        <rect
          x={PAD}
          y={REMARKS_Y + 8}
          width={W - PAD * 2}
          height={REMARKS_H}
          fill="#fff"
          stroke={INK}
          strokeWidth={1.25}
        />

        <line
          x1={GRID_X}
          x2={GRID_X + GRID_W}
          y1={REMARKS_RULER_Y}
          y2={REMARKS_RULER_Y}
          stroke={LINE}
          strokeWidth={1}
        />
        {Array.from({ length: 25 }, (_, h) => (
          <line
            key={`rm-t-${h}`}
            x1={xAt(h)}
            x2={xAt(h)}
            y1={REMARKS_RULER_Y - 6}
            y2={REMARKS_RULER_Y + 6}
            stroke={h % 12 === 0 ? LINE_BLUE : LINE}
            strokeWidth={h % 12 === 0 ? 1.4 : 0.8}
          />
        ))}

        <RemarksAnnotations remarks={remarks} />

        <text
          x={PAD + 12}
          y={REMARKS_Y + REMARKS_H - 6}
          fill={INK}
          style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 11 }}
        >
          Pro or Shipping No. {pro}
          {day.totalMiles > 0 ? `  ·  ${day.totalMiles} mi this day` : ''}
        </text>
      </svg>
    </div>
  )
}

function estimateRemarkWidth(lines: string[]): number {
  const longest = Math.max(1, ...lines.map((l) => l.length))
  return longest * REMARK_CHAR_W
}

/**
 * Greedy packing: assign each remark the lowest row whose horizontal span
 * does not collide with already-placed labels on that row.
 */
function layoutRemarks(remarks: DayRemark[]) {
  const occupied: { left: number; right: number; row: number }[] = []
  const sorted = [...remarks].sort((a, b) => a.time - b.time)

  return sorted.map((r) => {
    const x = xAt(r.time)
    const lines = wrapRemark(r.text, 28)
    const w = estimateRemarkWidth(lines)
    const half = w / 2
    const spanRows = lines.length > 1 ? 2 : 1

    let row = 0
    while (row <= REMARK_MAX_ROWS - spanRows) {
      const left = x - half
      const right = x + half
      const hits = occupied.some(
        (o) =>
          o.row >= row &&
          o.row < row + spanRows &&
          left < o.right + REMARK_GAP_PX &&
          right > o.left - REMARK_GAP_PX,
      )
      if (!hits) break
      row += 1
    }
    row = Math.min(row, REMARK_MAX_ROWS - spanRows)

    // Nudge toward open space if still tight on the last rows
    let tx = x
    const nearLeft = x < GRID_X + 70
    const nearRight = x > GRID_X + GRID_W - 70
    let anchor: 'start' | 'middle' | 'end' = 'middle'
    if (nearLeft) {
      anchor = 'start'
      tx = x + 3
    } else if (nearRight) {
      anchor = 'end'
      tx = x - 3
    }

    const left =
      anchor === 'start' ? tx : anchor === 'end' ? tx - w : tx - half
    const right = left + w
    for (let rr = 0; rr < spanRows; rr++) {
      occupied.push({ left, right, row: row + rr })
    }

    return { r, x, tx, anchor, row, lines }
  })
}

function RemarksAnnotations({ remarks }: { remarks: DayRemark[] }) {
  if (!remarks.length) {
    return (
      <text
        x={GRID_X}
        y={REMARKS_RULER_Y + 28}
        fill={INK_MUTED}
        style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 11 }}
      >
        No location remarks for this day.
      </text>
    )
  }

  const placed = layoutRemarks(remarks)

  return (
    <g>
      {placed.map(({ r, x, tx, anchor, row, lines }, i) => {
        const y = REMARKS_RULER_Y + 20 + row * REMARK_ROW_STEP
        return (
          <g key={`${r.time}-${r.text}-${i}`}>
            <line
              x1={x}
              x2={x}
              y1={REMARKS_RULER_Y}
              y2={y - 8}
              stroke={LINE_BLUE}
              strokeWidth={1}
              opacity={0.45}
            />
            <text
              x={tx}
              y={y}
              textAnchor={anchor}
              fill={INK}
              style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 10, fontWeight: 600 }}
            >
              {lines.map((line, li) => (
                <tspan key={li} x={tx} dy={li === 0 ? 0 : 11}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        )
      })}
    </g>
  )
}

interface EldLogSheetsProps {
  plan: TripPlanResponse
}

export function EldLogSheets({ plan }: EldLogSheetsProps) {
  const days = useMemo(() => buildDayLogs(plan), [plan])
  const [activeDay, setActiveDay] = useState(0)

  useEffect(() => {
    setActiveDay(0)
  }, [plan])

  if (!days.length) return null

  const selected = days[Math.min(activeDay, days.length - 1)] ?? days[0]
  const fromLabel = plan.locations.pickup.display_name.split(',')[0]
  const toLabel = plan.locations.dropoff.display_name.split(',')[0]

  return (
    <section className="animate-fade-up space-y-4" id="eld-log-sheets">
      <div className="overflow-hidden rounded-lg border border-slate-muted/15 bg-white shadow-[0_12px_40px_rgba(18,24,32,0.08)]">
        <div className="flex flex-col gap-3 border-b border-mist/70 bg-slate-panel px-4 py-3 text-fog sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 font-display text-xl font-semibold uppercase tracking-wide">
              <FileSpreadsheet className="h-5 w-5 shrink-0 text-signal" aria-hidden />
              Log sheets
              <span className="rounded-full bg-steel/90 px-2.5 py-0.5 text-[10px] font-semibold tracking-wider text-fog">
                {days.length} {days.length === 1 ? 'day' : 'days'}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-fog/65">
              FMCSA-style daily grid — select a day to view
            </p>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto border-b border-slate-muted/15 bg-fog/40 px-3 py-2.5">
          {days.map((day) => {
            const isActive = day.dayIndex === selected.dayIndex
            return (
              <button
                key={day.dayIndex}
                type="button"
                onClick={() => setActiveDay(day.dayIndex)}
                aria-pressed={isActive}
                className={`shrink-0 rounded-md px-3.5 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                  isActive
                    ? 'bg-slate-panel text-fog shadow-sm'
                    : 'bg-white text-ink/60 ring-1 ring-slate-muted/20 hover:text-ink'
                }`}
              >
                Day {day.dayIndex + 1}
                <span className="ml-1.5 font-normal normal-case tracking-normal text-ink/50">
                  · {formatLogSheetDateCompact(day.calendarDate)}
                </span>
              </button>
            )
          })}
        </div>

        <div className="bg-mist/30 p-3 sm:p-4">
          <EldLogSheet day={selected} fromLabel={fromLabel} toLabel={toLabel} />
        </div>
      </div>
    </section>
  )
}
