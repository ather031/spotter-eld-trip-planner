import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { ChevronDown, Loader2, MapPin, Search } from 'lucide-react'

export interface PlaceSuggestion {
  display_name: string
  lat: number
  lon: number
  source: string
}

interface LocationAutocompleteProps {
  id: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  borderClassName?: string
  icon?: 'map' | 'package' | 'check'
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

async function fetchPlaces(q: string, signal: AbortSignal): Promise<PlaceSuggestion[]> {
  const url = `${API_BASE}/api/places/search/?q=${encodeURIComponent(q)}&limit=8`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) return []
  const data = (await res.json()) as { results?: PlaceSuggestion[] }
  return Array.isArray(data.results) ? data.results : []
}

export function LocationAutocomplete({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  invalid,
  borderClassName = '',
}: LocationAutocompleteProps) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const focusedRef = useRef(false)
  const skipSearchRef = useRef(false)
  const blurTimerRef = useRef<number | null>(null)

  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<PlaceSuggestion[]>([])
  const [active, setActive] = useState(-1)
  const [queryError, setQueryError] = useState<string | null>(null)

  function closeList() {
    setOpen(false)
    setActive(-1)
  }

  // Close when the field is disabled (e.g. trip planning in flight)
  useEffect(() => {
    if (disabled) {
      focusedRef.current = false
      setFocused(false)
      closeList()
      setLoading(false)
    }
  }, [disabled])

  useEffect(() => {
    const q = value.trim()

    // Programmatic fills (demo presets / pick) should not reopen the menu
    if (skipSearchRef.current) {
      skipSearchRef.current = false
      setItems([])
      setLoading(false)
      setQueryError(null)
      closeList()
      return
    }

    if (q.length < 2 || disabled) {
      setItems([])
      setLoading(false)
      setQueryError(null)
      if (!focusedRef.current) closeList()
      return
    }

    // Only fetch while this field is focused — avoids sibling fields reopening
    if (!focusedRef.current) {
      setItems([])
      setLoading(false)
      closeList()
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setQueryError(null)

    const timer = window.setTimeout(async () => {
      try {
        const results = await fetchPlaces(q, controller.signal)
        if (controller.signal.aborted) return
        setItems(results)
        // Re-check focus: user may have moved to another field mid-request
        if (focusedRef.current) {
          setOpen(true)
          setActive(results.length ? 0 : -1)
          if (!results.length) {
            setQueryError('No matches — keep typing or use City, ST / lat,lon')
          }
        } else {
          closeList()
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setItems([])
        if (focusedRef.current) {
          setQueryError('Lookup unavailable — you can still type a place name')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 320)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [value, disabled])

  useEffect(() => {
    function onDocPointer(e: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        focusedRef.current = false
        setFocused(false)
        closeList()
      }
    }
    document.addEventListener('mousedown', onDocPointer)
    document.addEventListener('touchstart', onDocPointer)
    return () => {
      document.removeEventListener('mousedown', onDocPointer)
      document.removeEventListener('touchstart', onDocPointer)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (blurTimerRef.current != null) window.clearTimeout(blurTimerRef.current)
    }
  }, [])

  function pick(item: PlaceSuggestion) {
    skipSearchRef.current = true
    focusedRef.current = false
    setFocused(false)
    onChange(item.display_name)
    setItems([])
    setQueryError(null)
    closeList()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || !items.length) {
      if (e.key === 'ArrowDown' && items.length) setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0 && items[active]) {
      e.preventDefault()
      pick(items[active])
    } else if (e.key === 'Escape') {
      closeList()
    }
  }

  const showList = open && focused && (items.length > 0 || loading || !!queryError)

  return (
    <div ref={rootRef} className="relative">
      <MapPin
        className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-ink/35"
        aria-hidden
      />
      <input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
        aria-invalid={invalid}
        className={`w-full rounded-md border bg-white/90 py-2.5 pl-10 pr-10 text-sm text-ink shadow-sm outline-none transition focus:ring-2 disabled:opacity-60 ${borderClassName}`}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          if (focusedRef.current) setOpen(true)
        }}
        onFocus={() => {
          if (blurTimerRef.current != null) {
            window.clearTimeout(blurTimerRef.current)
            blurTimerRef.current = null
          }
          focusedRef.current = true
          setFocused(true)
          if (items.length || value.trim().length >= 2) setOpen(true)
        }}
        onBlur={() => {
          // Delay so list item mousedown can pick before we close
          blurTimerRef.current = window.setTimeout(() => {
            focusedRef.current = false
            setFocused(false)
            closeList()
            onBlur?.()
          }, 150)
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink/35">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4" aria-hidden />
        )}
      </span>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-mist bg-white py-1 shadow-lg"
        >
          {loading && !items.length && (
            <li className="flex items-center gap-2 px-3 py-2 text-xs text-ink/50">
              <Search className="h-3.5 w-3.5" aria-hidden />
              Searching places…
            </li>
          )}
          {!loading && queryError && !items.length && (
            <li className="px-3 py-2 text-xs text-ink/55">{queryError}</li>
          )}
          {items.map((item, idx) => (
            <li
              key={`${item.lat}-${item.lon}-${idx}`}
              id={`${listId}-opt-${idx}`}
              role="option"
              aria-selected={idx === active}
              className={`cursor-pointer px-3 py-2 text-sm ${
                idx === active ? 'bg-steel/10 text-ink' : 'text-ink/80 hover:bg-fog'
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                if (blurTimerRef.current != null) {
                  window.clearTimeout(blurTimerRef.current)
                  blurTimerRef.current = null
                }
                pick(item)
              }}
              onMouseEnter={() => setActive(idx)}
            >
              <span className="block leading-snug">{item.display_name}</span>
              <span className="text-[10px] uppercase tracking-wide text-ink/40">
                {item.source} · {item.lat.toFixed(4)}, {item.lon.toFixed(4)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
