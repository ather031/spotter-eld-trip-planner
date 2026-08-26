import { useEffect, useMemo, useRef } from 'react'
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import { Map as MapIcon } from 'lucide-react'
import type { StopMarker, TripPlanResponse } from '../types'
import { STOP_COLORS, STOP_LABELS, formatHours, formatMiles } from '../lib/format'

function markerIcon(kind: StopMarker['kind'], label: string, mode: 'idle' | 'hover' | 'active') {
  const color = STOP_COLORS[kind]
  const size = mode === 'active' ? 46 : mode === 'hover' ? 40 : 34
  const short =
    kind === 'break_30'
      ? '30m'
      : kind === 'rest_10'
        ? '10h'
        : kind === 'restart_34'
          ? '34h'
          : STOP_LABELS[kind].slice(0, 3).toUpperCase()

  const ring =
    mode === 'active'
      ? 'box-shadow:0 0 0 5px rgba(232,163,23,0.65),0 4px 14px rgba(0,0,0,.35);'
      : mode === 'hover'
        ? 'box-shadow:0 0 0 3px rgba(61,90,128,0.45),0 2px 10px rgba(0,0,0,.3);'
        : 'box-shadow:0 2px 8px rgba(0,0,0,.3);'

  return L.divIcon({
    className: 'routelog-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:999px;
      background:${color};color:#fff;
      border:2px solid #fff;${ring}
      display:flex;align-items:center;justify-content:center;
      font:700 10px/1 'IBM Plex Sans',sans-serif;
      letter-spacing:.02em;
    " title="${label.replace(/"/g, '&quot;')}">${short}</div>`,
  })
}

function FitRouteOnce({
  geometry,
  stops,
  locked,
}: {
  geometry: [number, number][]
  stops: StopMarker[]
  locked: boolean
}) {
  const map = useMap()
  const fittedKey = useRef<string>('')

  useEffect(() => {
    if (locked) return
    const key = `${geometry.length}:${stops.length}:${stops[0]?.lat ?? 0}`
    if (fittedKey.current === key) return

    const pts: [number, number][] = [
      ...geometry,
      ...stops.map((s) => [s.lat, s.lon] as [number, number]),
    ].filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon))

    if (pts.length === 0) return
    fittedKey.current = key
    if (pts.length === 1) {
      map.setView(pts[0], 10)
      return
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 11 })
  }, [map, geometry, stops, locked])

  // Reset when route identity changes
  useEffect(() => {
    fittedKey.current = ''
  }, [geometry])

  return null
}

/** Fly + pulse ring only when a stop is pinned (click). Hover does not move the map. */
function PinFocus({
  stop,
  active,
}: {
  stop: StopMarker | null
  active: boolean
}) {
  const map = useMap()
  const lastPinned = useRef<string | null>(null)

  useEffect(() => {
    if (!active || !stop || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) {
      if (!active) lastPinned.current = null
      return
    }
    const key = `${stop.kind}:${stop.at_hours.toFixed(3)}:${stop.lat.toFixed(5)}`
    if (lastPinned.current === key) return
    lastPinned.current = key
    const targetZoom = Math.min(12, Math.max(map.getZoom(), 10))
    map.flyTo([stop.lat, stop.lon], targetZoom, { duration: 0.7 })
  }, [active, stop, map])

  if (!active || !stop) return null

  return (
    <CircleMarker
      center={[stop.lat, stop.lon]}
      radius={28}
      pathOptions={{
        color: '#e8a317',
        weight: 2.5,
        fillColor: '#e8a317',
        fillOpacity: 0.15,
      }}
    >
      <Popup>
        <div className="min-w-[170px] text-sm">
          <strong>{STOP_LABELS[stop.kind]}</strong>
          <div>{stop.label}</div>
          <div className="mt-1 text-xs opacity-80">
            t+{formatHours(stop.at_hours)} · {formatMiles(stop.miles_from_start)}
          </div>
        </div>
      </Popup>
    </CircleMarker>
  )
}

interface RouteMapProps {
  plan: TripPlanResponse
  activeStopIndex?: number | null
  hoveredStopIndex?: number | null
  onSelectStop?: (index: number | null) => void
  onHoverStop?: (index: number | null) => void
}

export function RouteMap({
  plan,
  activeStopIndex = null,
  hoveredStopIndex = null,
  onSelectStop,
  onHoverStop,
}: RouteMapProps) {
  const geometry = useMemo(
    () =>
      (plan.route.geometry ?? []).filter(
        (p): p is [number, number] =>
          Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
      ),
    [plan.route.geometry],
  )

  const stops = plan.stops ?? []
  const pinned =
    activeStopIndex !== null && activeStopIndex >= 0 && activeStopIndex < stops.length
      ? stops[activeStopIndex]
      : null

  const center: [number, number] = geometry[0] ?? [
    plan.locations.current.lat,
    plan.locations.current.lon,
  ]

  return (
    <div className="overflow-hidden rounded-lg border border-slate-muted/15 bg-white shadow-[0_12px_40px_rgba(18,24,32,0.08)]">
      <div className="flex flex-col gap-3 border-b border-mist/70 bg-slate-panel px-4 py-3 text-fog sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 shrink">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold uppercase tracking-wide">
            <MapIcon className="h-5 w-5 shrink-0 text-signal" aria-hidden />
            Route map
          </h2>
          <p className="mt-0.5 text-xs text-fog/65">
            {formatMiles(plan.route.distance_miles)} · OSRM · OSM tiles
            {pinned
              ? ` · pinned: ${STOP_LABELS[pinned.kind]}`
              : ' · hover previews · click pins'}
          </p>
        </div>
        <Legend />
      </div>
      <div className="h-[min(520px,70vh)] w-full">
        <MapContainer center={center} zoom={6} className="h-full w-full" scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {geometry.length > 1 && (
            <Polyline
              positions={geometry}
              pathOptions={{ color: '#3d5a80', weight: 5, opacity: 0.88 }}
            />
          )}
          {stops.map((stop, idx) => {
            const mode =
              idx === activeStopIndex ? 'active' : idx === hoveredStopIndex ? 'hover' : 'idle'
            return (
              <Marker
                key={`${stop.kind}-${idx}-${stop.at_hours}`}
                position={[stop.lat, stop.lon]}
                icon={markerIcon(stop.kind, stop.label, mode)}
                zIndexOffset={mode === 'active' ? 1200 : mode === 'hover' ? 800 : 0}
                eventHandlers={{
                  click: () => onSelectStop?.(activeStopIndex === idx ? null : idx),
                  mouseover: () => onHoverStop?.(idx),
                  mouseout: () => onHoverStop?.(null),
                }}
              >
                <Tooltip direction="top" offset={[0, -14]} opacity={0.95}>
                  <span className="font-semibold">{STOP_LABELS[stop.kind]}</span>
                  <span className="opacity-80"> — {stop.label}</span>
                </Tooltip>
                {idx === activeStopIndex ? (
                  <Popup>
                    <div className="min-w-[170px] text-sm">
                      <strong>{STOP_LABELS[stop.kind]}</strong>
                      <div>{stop.label}</div>
                      <div className="mt-1 text-xs opacity-80">
                        t+{formatHours(stop.at_hours)} · {formatMiles(stop.miles_from_start)}
                        {stop.duration_hours > 0 ? ` · ${formatHours(stop.duration_hours)}` : ''}
                      </div>
                    </div>
                  </Popup>
                ) : null}
              </Marker>
            )
          })}
          <PinFocus stop={pinned} active={activeStopIndex !== null} />
          <FitRouteOnce
            geometry={geometry}
            stops={stops}
            locked={activeStopIndex !== null}
          />
        </MapContainer>
      </div>
    </div>
  )
}

function Legend() {
  const items: StopMarker['kind'][] = [
    'start',
    'pickup',
    'fuel',
    'break_30',
    'rest_10',
    'restart_34',
    'dropoff',
  ]
  return (
    <div className="flex max-w-full flex-wrap gap-x-3 gap-y-1.5 text-[10px] uppercase tracking-wide text-fog/80 sm:max-w-[min(100%,28rem)] sm:justify-end lg:max-w-none">
      {items.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: STOP_COLORS[k] }}
          />
          {STOP_LABELS[k]}
        </span>
      ))}
    </div>
  )
}
