import type { TripPlanRequest, TripPlanResponse } from './types'
import { ApiError } from './types'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

function formatDetail(payload: unknown): { message: string; code: string | null } {
  if (!payload || typeof payload !== 'object') {
    return { message: 'Something went wrong while planning the trip.', code: null }
  }
  const data = payload as Record<string, unknown>
  const code = typeof data.code === 'string' ? data.code : null

  if (typeof data.detail === 'string' && data.detail.trim()) {
    return { message: data.detail, code }
  }
  if (Array.isArray(data.detail)) {
    return { message: data.detail.map(String).join(' '), code }
  }

  // DRF field errors: { field: ["msg"] }
  const parts: string[] = []
  for (const [key, val] of Object.entries(data)) {
    if (key === 'detail' || key === 'code') continue
    if (Array.isArray(val)) parts.push(`${key}: ${val.join(', ')}`)
    else if (typeof val === 'string') parts.push(`${key}: ${val}`)
    else if (val && typeof val === 'object') parts.push(`${key}: ${JSON.stringify(val)}`)
  }
  return {
    message: parts.join(' · ') || 'Something went wrong while planning the trip.',
    code,
  }
}

export async function planTrip(
  body: TripPlanRequest,
  signal?: AbortSignal,
): Promise<TripPlanResponse> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/trips/plan/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(
      'Cannot reach the API. Check that Django is running (local :8000 or production /api).',
      0,
      'network_error',
    )
  }

  let payload: unknown = null
  try {
    payload = await res.json()
  } catch {
    payload = null
  }

  if (!res.ok) {
    const { message, code } = formatDetail(payload)
    throw new ApiError(message, res.status, code)
  }

  return payload as TripPlanResponse
}
