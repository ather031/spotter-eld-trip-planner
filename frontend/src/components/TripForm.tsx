import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Fuel,
  Gauge,
  Loader2,
  MapPin,
  Package,
  PackageCheck,
  Route,
  Sparkles,
  Timer,
  Truck,
} from 'lucide-react'
import { DEMO_TRIPS, type DemoTrip } from '../lib/format'
import { LocationAutocomplete } from './LocationAutocomplete'

export interface TripFormValues {
  current_location: string
  pickup_location: string
  dropoff_location: string
  cycle_used_hours: string
  start_hour_of_day: string
}

type FieldKey = keyof TripFormValues

const INITIAL: TripFormValues = {
  current_location: 'Chicago, IL',
  pickup_location: 'Indianapolis, IN',
  dropoff_location: 'Cincinnati, OH',
  cycle_used_hours: '12',
  start_hour_of_day: '6',
}

const DEMO_ICONS = {
  short: Route,
  multiday: Truck,
  cycle: Timer,
} as const

interface TripFormProps {
  loading: boolean
  onSubmit: (values: TripFormValues) => void
}

function validateField(key: FieldKey, values: TripFormValues): string | null {
  const current = values.current_location.trim()
  const pickup = values.pickup_location.trim()
  const dropoff = values.dropoff_location.trim()

  switch (key) {
    case 'current_location':
      if (!current) return 'Current location is required.'
      if (current.length < 2) return 'Enter a city, address, or lat,lon.'
      return null
    case 'pickup_location':
      if (!pickup) return 'Pickup location is required.'
      if (pickup.length < 2) return 'Enter a city, address, or lat,lon.'
      if (dropoff && pickup.toLowerCase() === dropoff.toLowerCase()) {
        return 'Pickup must differ from dropoff.'
      }
      return null
    case 'dropoff_location':
      if (!dropoff) return 'Dropoff location is required.'
      if (dropoff.length < 2) return 'Enter a city, address, or lat,lon.'
      if (pickup && pickup.toLowerCase() === dropoff.toLowerCase()) {
        return 'Dropoff must differ from pickup.'
      }
      return null
    case 'cycle_used_hours': {
      const raw = values.cycle_used_hours.trim()
      if (raw === '') return 'Cycle used is required.'
      const cycle = Number(raw)
      if (!Number.isFinite(cycle)) return 'Enter a valid number.'
      if (cycle < 0) return 'Cannot be negative.'
      if (cycle > 70) return 'Max is 70 hours (70/8 cycle).'
      return null
    }
    case 'start_hour_of_day': {
      const raw = values.start_hour_of_day.trim()
      if (raw === '') return 'Start hour is required.'
      const start = Number(raw)
      if (!Number.isFinite(start)) return 'Enter a valid number.'
      if (start < 0 || start >= 24) return 'Must be between 0 and 23.99.'
      return null
    }
    default:
      return null
  }
}

function validateAll(values: TripFormValues): Partial<Record<FieldKey, string>> {
  const keys: FieldKey[] = [
    'current_location',
    'pickup_location',
    'dropoff_location',
    'cycle_used_hours',
    'start_hour_of_day',
  ]
  const errors: Partial<Record<FieldKey, string>> = {}
  for (const key of keys) {
    const err = validateField(key, values)
    if (err) errors[key] = err
  }
  return errors
}

function fieldBorderClass(error: string | null | undefined, touched: boolean, showOk: boolean) {
  if (touched && error) return 'border-danger/60 focus:border-danger focus:ring-danger/20'
  if (touched && showOk && !error) return 'border-ok/50 focus:border-ok focus:ring-ok/20'
  return 'border-mist/80 focus:border-steel focus:ring-steel/25'
}

interface FieldShellProps {
  id: string
  label: string
  icon: ReactNode
  error?: string | null
  touched: boolean
  hint?: string
  okHint?: string
  children: ReactNode
  className?: string
}

function FieldShell({
  id,
  label,
  icon,
  error,
  touched,
  hint,
  okHint,
  children,
  className = '',
}: FieldShellProps) {
  const showError = touched && !!error
  const showOk = touched && !error

  return (
    <div className={className}>
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink/60">
        <span className="text-steel">{icon}</span>
        {label}
      </label>
      <div className="relative mt-1.5">{children}</div>
      {showError ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-danger" role="alert">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : showOk && okHint ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ok">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {okHint}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-ink/45">{hint}</p>
      ) : null}
    </div>
  )
}

export function TripForm({ loading, onSubmit }: TripFormProps) {
  const formId = useId()
  const [values, setValues] = useState<TripFormValues>(INITIAL)
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)

  const errors = useMemo(() => validateAll(values), [values])
  const isValid = Object.keys(errors).length === 0

  const cycleNum = Number(values.cycle_used_hours)
  const remaining =
    Number.isFinite(cycleNum) && cycleNum >= 0 && cycleNum <= 70
      ? Math.round((70 - cycleNum) * 100) / 100
      : null

  function markTouched(key: FieldKey) {
    setTouched((prev) => ({ ...prev, [key]: true }))
  }

  function setField(key: FieldKey, value: string) {
    setValues((prev) => {
      const next = { ...prev, [key]: value }
      return next
    })
    // Live validation: mark touched so errors appear while typing
    setTouched((prev) => ({ ...prev, [key]: true }))
    // Cross-field: pickup/dropoff should re-check each other
    if (key === 'pickup_location' || key === 'dropoff_location') {
      setTouched((prev) => ({
        ...prev,
        pickup_location: true,
        dropoff_location: true,
      }))
    }
  }

  function applyDemo(demo: DemoTrip) {
    setValues({
      current_location: demo.current_location,
      pickup_location: demo.pickup_location,
      dropoff_location: demo.dropoff_location,
      cycle_used_hours: String(demo.cycle_used_hours),
      start_hour_of_day: String(demo.start_hour_of_day),
    })
    setTouched({
      current_location: true,
      pickup_location: true,
      dropoff_location: true,
      cycle_used_hours: true,
      start_hour_of_day: true,
    })
    setSubmitted(false)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    setTouched({
      current_location: true,
      pickup_location: true,
      dropoff_location: true,
      cycle_used_hours: true,
      start_hour_of_day: true,
    })
    if (!isValid) return
    onSubmit(values)
  }

  function showFieldError(key: FieldKey) {
    return touched[key] || submitted ? errors[key] ?? null : null
  }

  const inputBase =
    'w-full rounded-md border bg-white/90 py-2.5 pl-10 pr-3 text-sm text-ink shadow-sm outline-none transition focus:ring-2 disabled:opacity-60'

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div>
        <p className="flex items-center gap-1.5 font-display text-xs font-semibold uppercase tracking-[0.18em] text-steel">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Demo presets
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {DEMO_TRIPS.map((demo) => {
            const Icon = DEMO_ICONS[demo.id as keyof typeof DEMO_ICONS] ?? Route
            return (
              <button
                key={demo.id}
                type="button"
                onClick={() => applyDemo(demo)}
                disabled={loading}
                className="flex w-full min-w-0 items-start gap-2.5 rounded-md border border-slate-muted/20 bg-white/70 px-3.5 py-3 text-left text-xs font-medium text-ink transition hover:border-signal/50 hover:bg-white disabled:opacity-50"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-snug">{demo.title}</span>
                  <span className="mt-0.5 block break-words text-ink/55 leading-snug">
                    {demo.blurb}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldShell
          id={`${formId}-current`}
          className="sm:col-span-2"
          label="Current location"
          icon={<MapPin className="h-3.5 w-3.5" aria-hidden />}
          error={showFieldError('current_location')}
          touched={!!(touched.current_location || submitted)}
          hint="Search and pick a place, or type City, ST / lat,lon"
          okHint="Looks good"
        >
          <LocationAutocomplete
            id={`${formId}-current`}
            value={values.current_location}
            onChange={(v) => setField('current_location', v)}
            onBlur={() => markTouched('current_location')}
            placeholder="Search Chicago, IL…"
            disabled={loading}
            invalid={!!showFieldError('current_location')}
            borderClassName={fieldBorderClass(
              showFieldError('current_location'),
              !!(touched.current_location || submitted),
              true,
            )}
          />
        </FieldShell>

        <FieldShell
          id={`${formId}-pickup`}
          label="Pickup"
          icon={<Package className="h-3.5 w-3.5" aria-hidden />}
          error={showFieldError('pickup_location')}
          touched={!!(touched.pickup_location || submitted)}
          okHint="Looks good"
        >
          <LocationAutocomplete
            id={`${formId}-pickup`}
            value={values.pickup_location}
            onChange={(v) => setField('pickup_location', v)}
            onBlur={() => markTouched('pickup_location')}
            placeholder="Search pickup…"
            disabled={loading}
            invalid={!!showFieldError('pickup_location')}
            borderClassName={fieldBorderClass(
              showFieldError('pickup_location'),
              !!(touched.pickup_location || submitted),
              true,
            )}
          />
        </FieldShell>

        <FieldShell
          id={`${formId}-dropoff`}
          label="Dropoff"
          icon={<PackageCheck className="h-3.5 w-3.5" aria-hidden />}
          error={showFieldError('dropoff_location')}
          touched={!!(touched.dropoff_location || submitted)}
          okHint="Looks good"
        >
          <LocationAutocomplete
            id={`${formId}-dropoff`}
            value={values.dropoff_location}
            onChange={(v) => setField('dropoff_location', v)}
            onBlur={() => markTouched('dropoff_location')}
            placeholder="Search dropoff…"
            disabled={loading}
            invalid={!!showFieldError('dropoff_location')}
            borderClassName={fieldBorderClass(
              showFieldError('dropoff_location'),
              !!(touched.dropoff_location || submitted),
              true,
            )}
          />
        </FieldShell>

        <FieldShell
          id={`${formId}-cycle`}
          label="Current cycle used (hrs)"
          icon={<Gauge className="h-3.5 w-3.5" aria-hidden />}
          error={showFieldError('cycle_used_hours')}
          touched={!!(touched.cycle_used_hours || submitted)}
          hint="70 hrs / 8 days — remaining = 70 − this value"
          okHint={remaining !== null ? `${remaining}h remaining in cycle` : 'Looks good'}
        >
          <Gauge className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/35" aria-hidden />
          <input
            id={`${formId}-cycle`}
            className={`${inputBase} ${fieldBorderClass(showFieldError('cycle_used_hours'), !!(touched.cycle_used_hours || submitted), true)}`}
            type="number"
            min={0}
            max={70}
            step={0.25}
            value={values.cycle_used_hours}
            onChange={(e) => setField('cycle_used_hours', e.target.value)}
            onBlur={() => markTouched('cycle_used_hours')}
            disabled={loading}
            aria-invalid={!!showFieldError('cycle_used_hours')}
          />
        </FieldShell>

        <FieldShell
          id={`${formId}-start`}
          label="Start hour of day"
          icon={<Clock3 className="h-3.5 w-3.5" aria-hidden />}
          error={showFieldError('start_hour_of_day')}
          touched={!!(touched.start_hour_of_day || submitted)}
          hint="0–23.99 (used for daily log midnight boundaries)"
          okHint="Looks good"
        >
          <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/35" aria-hidden />
          <input
            id={`${formId}-start`}
            className={`${inputBase} ${fieldBorderClass(showFieldError('start_hour_of_day'), !!(touched.start_hour_of_day || submitted), true)}`}
            type="number"
            min={0}
            max={23.99}
            step={0.25}
            value={values.start_hour_of_day}
            onChange={(e) => setField('start_hour_of_day', e.target.value)}
            onBlur={() => markTouched('start_hour_of_day')}
            disabled={loading}
            aria-invalid={!!showFieldError('start_hour_of_day')}
          />
        </FieldShell>
      </div>

      {!isValid && submitted && (
        <p className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          Fix the highlighted fields before planning.
        </p>
      )}

      <button
        type="submit"
        disabled={loading || !isValid}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-panel px-4 py-3 font-display text-lg font-semibold uppercase tracking-wider text-fog transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-[240px]"
      >
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-signal" aria-hidden />
            Planning route…
          </>
        ) : (
          <>
            <Fuel className="h-5 w-5 text-signal" aria-hidden />
            Plan HOS trip
          </>
        )}
      </button>
    </form>
  )
}
