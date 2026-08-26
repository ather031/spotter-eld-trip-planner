import type { DutyStatus, StopKind } from '../types'

export function formatHours(h: number): string {
  if (!Number.isFinite(h)) return '—'
  const sign = h < 0 ? '-' : ''
  const abs = Math.abs(h)
  const hours = Math.floor(abs)
  const minutes = Math.round((abs - hours) * 60)
  if (minutes === 60) return `${sign}${hours + 1}h 00m`
  return `${sign}${hours}h ${String(minutes).padStart(2, '0')}m`
}

export function formatClock(hourOfDay: number): string {
  const totalMin = Math.round(((hourOfDay % 24) + 24) % 24 * 60)
  const hh = Math.floor(totalMin / 60) % 24
  const mm = totalMin % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function formatMiles(m: number): string {
  if (!Number.isFinite(m)) return '—'
  return `${m.toLocaleString(undefined, { maximumFractionDigits: 1 })} mi`
}

export const STOP_LABELS: Record<StopKind, string> = {
  start: 'Start',
  pickup: 'Pickup',
  dropoff: 'Dropoff',
  fuel: 'Fuel',
  break_30: '30-min break',
  rest_10: '10-hr rest',
  restart_34: '34-hr restart',
  end: 'End',
}

export const STOP_COLORS: Record<StopKind, string> = {
  start: '#1a2332',
  pickup: '#2f9e6b',
  dropoff: '#c44b4b',
  fuel: '#e8a317',
  break_30: '#3d5a80',
  rest_10: '#64748b',
  restart_34: '#9f1239',
  end: '#1a2332',
}

export const DUTY_LABELS: Record<DutyStatus, string> = {
  off_duty: 'Off duty',
  sleeper: 'Sleeper',
  driving: 'Driving',
  on_duty: 'On duty (not driving)',
}

export const DUTY_COLORS: Record<DutyStatus, string> = {
  off_duty: '#64748b',
  sleeper: '#5b4b8a',
  driving: '#2b6cb0',
  on_duty: '#b7791f',
}

export interface DemoTrip {
  id: string
  title: string
  blurb: string
  current_location: string
  pickup_location: string
  dropoff_location: string
  cycle_used_hours: number
  start_hour_of_day: number
}

export const DEMO_TRIPS: DemoTrip[] = [
  {
    id: 'short',
    title: 'Short same-day',
    blurb: 'Chicago → Indy → Cincinnati',
    current_location: 'Chicago, IL',
    pickup_location: 'Indianapolis, IN',
    dropoff_location: 'Cincinnati, OH',
    cycle_used_hours: 12,
    start_hour_of_day: 6,
  },
  {
    id: 'multiday',
    title: 'Multi-day haul',
    blurb: 'Chicago → Denver → Los Angeles',
    current_location: 'Chicago, IL',
    pickup_location: 'Denver, CO',
    dropoff_location: 'Los Angeles, CA',
    cycle_used_hours: 5,
    start_hour_of_day: 5,
  },
  {
    id: 'cycle',
    title: 'High cycle used',
    blurb: 'Needs a 34-hour restart',
    current_location: 'Chicago, IL',
    pickup_location: 'Indianapolis, IN',
    dropoff_location: 'Cincinnati, OH',
    cycle_used_hours: 68,
    start_hour_of_day: 7,
  },
]
