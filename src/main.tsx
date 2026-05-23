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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
