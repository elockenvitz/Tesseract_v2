import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'
import { syncFlagsFromUrl } from './lib/flags'
import { animateBootLoader } from './lib/boot-loader'

// Consume ?flag= before anything routes. The root route redirects with
// <Navigate to="/dashboard" replace />, which drops the query string, so any
// flag read from inside a screen runs after the parameter is gone.
syncFlagsFromUrl()

/**
 * Start the boot mark turning, before React mounts.
 *
 * The element was painted by `index.html` as a static frame — it has to be,
 * since the projection is computed in JavaScript and this paints before any
 * runs. This is the first moment it can move, and it stays the visible figure
 * for the whole cold boot, so it is the one that matters.
 */
animateBootLoader()

// Sentry — must initialize before render so it can catch React errors.
// We only init when a DSN is present, so local dev never reports out.
// VITE_SENTRY_DSN + VITE_SENTRY_ENVIRONMENT are set per-context in
// Netlify (production vs branch-deploy/staging).
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment:
      import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      // Masking is passed explicitly rather than left to the SDK default.
      // These are Sentry's defaults today, but a replay of this app records
      // client holdings, theses and portfolio names — that must not become
      // readable in a third-party tool because a library changed a default
      // in a minor release. Pinned here so the guarantee is ours, not theirs.
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    ],
    // Never attach request headers, cookies or user IP to events.
    sendDefaultPii: false,
    // Performance tracing — 10% in prod, 100% elsewhere (cheap on pilots).
    tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,
    // Session Replay — never record happy sessions (would burn quota fast);
    // always record sessions that hit an error, so bug reports are
    // accompanied by a recording of what the user actually did.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  })
}

// Stale-chunk recovery. When we ship a new deploy, dynamically-imported
// chunks get new content hashes (`SimulationPage-abc.js` → `SimulationPage-xyz.js`).
// Any tab that was open before the deploy still references the old
// hashed paths and crashes when it tries to navigate into a route
// whose chunk has been replaced — Daniel hit this on Trade Lab open.
// Vite emits `vite:preloadError` for exactly this case; the standard
// fix is to reload the page, which fetches fresh HTML referencing the
// current chunk hashes. The `sessionStorage` flag guards against an
// infinite reload loop if the failure is something other than staleness.
window.addEventListener('vite:preloadError', (event) => {
  const reloadFlag = 'tesseract:preload-error-reloaded'
  if (sessionStorage.getItem(reloadFlag)) {
    // We already reloaded once this session and still hit it — let
    // the error bubble so Sentry / the user notices something real.
    return
  }
  sessionStorage.setItem(reloadFlag, '1')
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
