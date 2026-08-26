import { useEffect, useRef, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  CalendarDays,
  CirclePause,
  Clock,
  Fuel,
  Gauge,
  MapPinned,
  Moon,
  RefreshCcw,
  Route,
  Timer,
  Truck,
} from 'lucide-react'
import type { HosEvent, StopKind, TripPlanResponse } from '../types'
import {
  DUTY_COLORS,
  DUTY_LABELS,
  STOP_COLORS,
  STOP_LABELS,
  formatHours,
  formatMiles,
} from '../lib/format'

interface Props {
  plan: TripPlanResponse
}

export interface MapFocusProps {
  activeStopIndex: number | null
  hoveredStopIndex: number | null
  onHoverStop: (index: number | null) => void
  onSelectStop: (index: number | null) => void
}

const SUMMARY_ICONS: Record<string, LucideIcon> = {
  Miles: Route,
  Driving: Truck,
  'On duty': Gauge,
  'Trip clock': Timer,
  Days: CalendarDays,
  'Cycle left': Clock,
  Fuel: Fuel,
  Breaks: CirclePause,
  '10h rests': Moon,
  '34h restarts': RefreshCcw,
}

const STOP_ICONS: Record<StopKind, LucideIcon> = {
  start: MapPinned,
  pickup: Truck,
  dropoff: MapPinned,
  fuel: Fuel,
  break_30: CirclePause,
  rest_10: Moon,
  restart_34: RefreshCcw,
  end: MapPinned,
}

/** Best matching stop index for a timeline event (for map highlight). */
export function stopIndexForEvent(plan: TripPlanResponse, event: HosEvent): number | null {
  const stops = plan.stops
  if (!stops.length) return null

  if (event.stop_kind) {
    let best = -1
    let bestDist = Infinity
    stops.forEach((s, i) => {
      if (s.kind !== event.stop_kind) return
      const d = Math.abs(s.at_hours - event.start_hours)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    return best >= 0 ? best : null
  }

  const mid = (event.start_hours + event.end_hours) / 2
  let best = 0
  let bestDist = Infinity
  stops.forEach((s, i) => {
    const d = Math.abs(s.at_hours - mid)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  return best
}

export function SummaryStrip({ plan }: Props) {
  const s = plan.summary
  if (!s) return null

  const items = [
    { label: 'Miles', value: formatMiles(s.total_miles) },
    { label: 'Driving', value: formatHours(s.total_driving_hours) },
    { label: 'On duty', value: formatHours(s.total_on_duty_hours) },
    { label: 'Trip clock', value: formatHours(s.trip_duration_hours) },
    { label: 'Days', value: String(s.days_required) },
    { label: 'Cycle left', value: formatHours(s.cycle_remaining_at_end) },
    { label: 'Fuel', value: String(s.fuel_stops) },
    { label: 'Breaks', value: String(s.breaks_30) },
    { label: '10h rests', value: String(s.rests_10) },
    { label: '34h restarts', value: String(s.restarts_34) },
  ]

  return (
    <div className="animate-fade-up grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => {
        const Icon = SUMMARY_ICONS[item.label] ?? Gauge
        return (
          <div
            key={item.label}
            className="rounded-md border border-white/10 bg-slate-panel px-3 py-2.5 text-fog"
          >
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-fog/50">
              <Icon className="h-3 w-3 text-signal" aria-hidden />
              {item.label}
            </div>
            <div className="font-display text-2xl font-semibold tracking-wide text-signal">
              {item.value}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PanelShell({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="shrink-0">
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold uppercase tracking-wide text-ink">
          {icon}
          {title}
        </h2>
        <p className="mt-1 min-h-10 text-sm leading-5 text-ink/55">{subtitle}</p>
      </header>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
        {children}
      </div>
    </section>
  )
}

function DutyStrip({
  plan,
  activeStopIndex,
  onHoverStop,
  onSelectStop,
}: Props & Pick<MapFocusProps, 'activeStopIndex' | 'onHoverStop' | 'onSelectStop'>) {
  const events = plan.events
  if (!events.length) return null
  const total = Math.max(events[events.length - 1]?.end_hours ?? 1, 1)

  return (
    <div className="animate-fade-up overflow-hidden rounded-xl border border-white/60 bg-white/55 p-4 backdrop-blur-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
          Duty overview
        </p>
        <div className="flex flex-wrap gap-3 text-[11px] text-ink/60">
          {(Object.keys(DUTY_LABELS) as (keyof typeof DUTY_LABELS)[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: DUTY_COLORS[k] }}
              />
              {DUTY_LABELS[k]}
            </span>
          ))}
        </div>
      </div>
      <div className="flex h-9 w-full overflow-hidden rounded-md border border-mist">
        {events.map((ev, i) => {
          const width = Math.max((ev.duration_hours / total) * 100, 0.12)
          const stopIdx = stopIndexForEvent(plan, ev)
          return (
            <button
              key={`${ev.start_hours}-${i}`}
              type="button"
              title={`${DUTY_LABELS[ev.status]}: ${ev.label}`}
              style={{ width: `${width}%`, background: DUTY_COLORS[ev.status] }}
              className="h-full border-r border-white/25 transition last:border-0 hover:brightness-110"
              onMouseEnter={() => onHoverStop(stopIdx)}
              onMouseLeave={() => onHoverStop(null)}
              onClick={() => {
                if (stopIdx === null) return
                onSelectStop(activeStopIndex === stopIdx ? null : stopIdx)
              }}
            />
          )
        })}
      </div>
      <p className="mt-2 text-xs text-ink/45">
        Click a segment to pin that stop on the map. Hover only previews the marker.
      </p>
    </div>
  )
}

function StopRow({
  plan,
  index,
  active,
  hovered,
  onHoverStop,
  onSelectStop,
}: {
  plan: TripPlanResponse
  index: number
  active: boolean
  hovered: boolean
  onHoverStop: (index: number | null) => void
  onSelectStop: (index: number | null) => void
}) {
  const stop = plan.stops[index]
  const Icon = STOP_ICONS[stop.kind] ?? MapPinned
  const rowRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (active && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [active])

  return (
    <button
      ref={rowRef}
      type="button"
      data-stop-index={index}
      onMouseEnter={() => onHoverStop(index)}
      onMouseLeave={() => onHoverStop(null)}
      onClick={() => onSelectStop(active ? null : index)}
      className={`flex w-full items-start gap-3 rounded-md border px-2.5 py-2.5 text-left transition ${
        active
          ? 'border-signal bg-signal/15 shadow-sm'
          : hovered
            ? 'border-steel/40 bg-steel/8'
            : 'border-transparent hover:border-mist hover:bg-white/80'
      }`}
    >
      <span
        className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white ${
          active ? 'ring-2 ring-signal ring-offset-2' : ''
        }`}
        style={{ background: STOP_COLORS[stop.kind] }}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-ink">{stop.label}</div>
        <div className="text-xs text-ink/50">
          {STOP_LABELS[stop.kind]} · Day {stop.day_index + 1} · t+
          {formatHours(stop.at_hours)} · {formatMiles(stop.miles_from_start)}
          {stop.duration_hours > 0 ? ` · dwell ${formatHours(stop.duration_hours)}` : ''}
        </div>
      </div>
    </button>
  )
}

function EventRow({
  plan,
  event,
  index,
  activeStopIndex,
  hoveredStopIndex,
  onHoverStop,
  onSelectStop,
}: {
  plan: TripPlanResponse
  event: HosEvent
  index: number
  activeStopIndex: number | null
  hoveredStopIndex: number | null
  onHoverStop: (index: number | null) => void
  onSelectStop: (index: number | null) => void
}) {
  const stopIdx = stopIndexForEvent(plan, event)
  const active = stopIdx !== null && activeStopIndex === stopIdx
  const hovered = stopIdx !== null && hoveredStopIndex === stopIdx
  const rowRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (active && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [active])

  return (
    <button
      ref={rowRef}
      type="button"
      data-event-index={index}
      onMouseEnter={() => onHoverStop(stopIdx)}
      onMouseLeave={() => onHoverStop(null)}
      onClick={() => {
        if (stopIdx === null) return
        onSelectStop(active ? null : stopIdx)
      }}
      className={`flex w-full gap-3 rounded-md border px-2.5 py-2.5 text-left transition ${
        active
          ? 'border-signal bg-signal/15 shadow-sm'
          : hovered
            ? 'border-steel/40 bg-steel/8'
            : 'border-transparent hover:border-mist hover:bg-white/80'
      }`}
    >
      <span
        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ background: DUTY_COLORS[event.status] }}
      />
      <div className="min-w-0">
        <div className="font-medium text-ink">{event.label}</div>
        <div className="text-xs text-ink/50">
          {DUTY_LABELS[event.status]} · {formatHours(event.start_hours)} →{' '}
          {formatHours(event.end_hours)} ({formatHours(event.duration_hours)})
          {event.miles > 0 ? ` · ${formatMiles(event.miles)}` : ''}
        </div>
      </div>
    </button>
  )
}

/** Aligned stops + timeline lists with shared duty strip above. */
export function TripInsightPanels({
  plan,
  activeStopIndex,
  hoveredStopIndex,
  onHoverStop,
  onSelectStop,
}: Props & MapFocusProps) {
  return (
    <div className="animate-fade-up space-y-4">
      <DutyStrip
        plan={plan}
        activeStopIndex={activeStopIndex}
        onHoverStop={onHoverStop}
        onSelectStop={onSelectStop}
      />

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2 lg:gap-6">
        <div className="flex h-[28rem] flex-col rounded-xl border border-white/60 bg-white/55 p-5 backdrop-blur-sm sm:p-6">
          <PanelShell
            icon={<MapPinned className="h-6 w-6 text-steel" aria-hidden />}
            title="Stops & rests"
            subtitle="Hover to preview on the map. Click to pin and zoom."
          >
            <div className="space-y-1">
              {plan.stops.map((stop, i) => (
                <StopRow
                  key={`${stop.kind}-${i}-${stop.at_hours}`}
                  plan={plan}
                  index={i}
                  active={activeStopIndex === i}
                  hovered={hoveredStopIndex === i}
                  onHoverStop={onHoverStop}
                  onSelectStop={onSelectStop}
                />
              ))}
            </div>
          </PanelShell>
        </div>

        <div className="flex h-[28rem] flex-col rounded-xl border border-white/60 bg-white/55 p-5 backdrop-blur-sm sm:p-6">
          <PanelShell
            icon={<Timer className="h-6 w-6 text-steel" aria-hidden />}
            title="HOS timeline"
            subtitle="Same height list — click an event to pin its map stop."
          >
            <div className="space-y-1">
              {plan.events.map((ev, i) => (
                <EventRow
                  key={`${ev.label}-${i}-${ev.start_hours}`}
                  plan={plan}
                  event={ev}
                  index={i}
                  activeStopIndex={activeStopIndex}
                  hoveredStopIndex={hoveredStopIndex}
                  onHoverStop={onHoverStop}
                  onSelectStop={onSelectStop}
                />
              ))}
            </div>
          </PanelShell>
        </div>
      </div>
    </div>
  )
}

export function WarningsBanner({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null
  return (
    <div
      className="animate-fade-up rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink"
      role="status"
    >
      <p className="flex items-center gap-2 font-semibold text-warn">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        Plan notes
      </p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  )
}
