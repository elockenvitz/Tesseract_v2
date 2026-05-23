import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'

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
      Sentry.replayIntegration(),
    ],
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
