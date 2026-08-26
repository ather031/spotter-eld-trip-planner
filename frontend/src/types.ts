export type DutyStatus = 'off_duty' | 'sleeper' | 'driving' | 'on_duty'

export type StopKind =
  | 'start'
  | 'pickup'
  | 'dropoff'
  | 'fuel'
  | 'break_30'
  | 'rest_10'
  | 'restart_34'
  | 'end'

export interface GeoLocation {
  lat: number
  lon: number
  display_name: string
  source: string
}

export interface RouteLeg {
  distance_miles: number
  duration_hours: number
  from_label: string
  to_label: string
}

export interface RouteInfo {
  geometry: [number, number][]
  distance_miles: number
  duration_hours: number
  legs: RouteLeg[]
  provider: string
}

export interface StopMarker {
  kind: StopKind
  label: string
  at_hours: number
  miles_from_start: number
  duration_hours: number
  day_index: number
  lat: number
  lon: number
}

export interface HosEvent {
  status: DutyStatus
  start_hours: number
  end_hours: number
  duration_hours: number
  label: string
  miles: number
  stop_kind: StopKind | null
  day_index: number
}

export interface DayLogSegment {
  day_index: number
  status: DutyStatus
  start_hour_of_day: number
  end_hour_of_day: number
  duration_hours: number
  label: string
  miles: number
}

export interface PlanSummary {
  total_miles: number
  total_driving_hours: number
  total_on_duty_hours: number
  total_off_duty_hours: number
  trip_duration_hours: number
  days_required: number
  fuel_stops: number
  breaks_30: number
  rests_10: number
  restarts_34: number
  cycle_used_at_start: number
  cycle_used_at_end: number
  cycle_remaining_at_end: number
}

export interface TripPlanResponse {
  locations: {
    current: GeoLocation
    pickup: GeoLocation
    dropoff: GeoLocation
  }
  route: RouteInfo
  stops: StopMarker[]
  events: HosEvent[]
  day_segments: DayLogSegment[]
  summary: PlanSummary | null
  warnings: string[]
  meta: Record<string, unknown>
}

export interface TripPlanRequest {
  current_location: string
  pickup_location: string
  dropoff_location: string
  cycle_used_hours: number
  start_hour_of_day?: number
}

export class ApiError extends Error {
  status: number
  code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}
