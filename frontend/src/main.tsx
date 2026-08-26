import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/**
 * Soft-refresh blank screens on localhost:5173 are usually a stale Service Worker
 * from another Vite/Vue/PWA app (e.g. VDC) that cached wrong HTML (main.ts, PWA).
 * Clear it once on boot so this React app loads reliably.
 */
async function clearStaleWorkers() {
  if (!('serviceWorker' in navigator)) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister()))
  } catch {
    /* ignore */
  }
  if ('caches' in window) {
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    } catch {
      /* ignore */
    }
  }
}

void clearStaleWorkers().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
