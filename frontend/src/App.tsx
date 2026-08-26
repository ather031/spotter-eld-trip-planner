import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ClipboardList, Route } from 'lucide-react'
import { planTrip } from './api'
import { TripForm, type TripFormValues } from './components/TripForm'
import { RouteMap } from './components/RouteMap'
import { EldLogSheets } from './components/EldLogSheet'
import {
  SummaryStrip,
  TripInsightPanels,
  WarningsBanner,
} from './components/PlanPanels'
import type { TripPlanResponse } from './types'
import { ApiError } from './types'

export default function App() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<TripPlanResponse | null>(null)
  const [activeStopIndex, setActiveStopIndex] = useState<number | null>(null)
  const [hoveredStopIndex, setHoveredStopIndex] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  async function handleSubmit(values: TripFormValues) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const result = await planTrip(
        {
          current_location: values.current_location.trim(),
          pickup_location: values.pickup_location.trim(),
          dropoff_location: values.dropoff_location.trim(),
          cycle_used_hours: Number(values.cycle_used_hours),
          start_hour_of_day: Number(values.start_hour_of_day),
        },
        controller.signal,
      )
      setPlan(result)
      setActiveStopIndex(null)
      setHoveredStopIndex(null)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError(err instanceof Error ? err.message : 'Unexpected error')
      }
      setPlan(null)
      setActiveStopIndex(null)
      setHoveredStopIndex(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <header className="no-print animate-fade-up mb-8">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.28em] text-signal">
          HOS trip planner
        </p>
        <h1 className="mt-1 flex flex-wrap items-center gap-3 font-display text-5xl font-bold uppercase leading-none tracking-wide text-ink sm:text-6xl">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-slate-panel text-signal sm:h-14 sm:w-14">
            <Route className="h-7 w-7" aria-hidden />
          </span>
          RouteLog
        </h1>
        <p className="mt-3 text-base text-ink/65 sm:text-lg">
          Plan a property-carrying trip with FMCSA 70/8 HOS rules — route map, labeled
          stops, duty timeline, and paper-style daily ELD log sheets.
        </p>
      </header>

      <section className="no-print animate-fade-up rounded-xl border border-white/60 bg-white/55 p-5 shadow-[0_20px_50px_rgba(18,24,32,0.06)] backdrop-blur-sm sm:p-7">
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold uppercase tracking-wide text-ink">
          <ClipboardList className="h-6 w-6 text-steel" aria-hidden />
          Trip inputs
        </h2>
        <p className="mt-1 text-sm text-ink/55">
          Current → pickup → dropoff. Fields validate as you type.
        </p>
        <div className="mt-5">
          <TripForm loading={loading} onSubmit={handleSubmit} />
        </div>
        {error && (
          <p
            className="mt-4 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
      </section>

      {plan && (
        <div className="mt-8 space-y-8">
          <div className="no-print space-y-8">
            <WarningsBanner warnings={plan.warnings} />
            <SummaryStrip plan={plan} />
            <RouteMap
              plan={plan}
              activeStopIndex={activeStopIndex}
              hoveredStopIndex={hoveredStopIndex}
              onSelectStop={setActiveStopIndex}
              onHoverStop={setHoveredStopIndex}
            />
            <TripInsightPanels
              plan={plan}
              activeStopIndex={activeStopIndex}
              hoveredStopIndex={hoveredStopIndex}
              onHoverStop={setHoveredStopIndex}
              onSelectStop={setActiveStopIndex}
            />
          </div>
          <EldLogSheets plan={plan} />
          {typeof plan.meta?.routing_note === 'string' && (
            <p className="no-print text-center text-xs text-ink/45">{plan.meta.routing_note}</p>
          )}
        </div>
      )}
    </div>
  )
}
