import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CoverageQuickStart } from '../src/components/coverage/CoverageQuickStart'
import '../src/index.css'

/**
 * Visual harness for the first-session coverage prompt.
 *
 * Renders the REAL component — not a mock of it — with Supabase and the
 * coverage hook aliased to fixtures, at both the desktop and phone densities.
 * The component only ever appears behind login for a user with no coverage, so
 * this is the only way to look at it without a seeded account.
 *
 * Deliberately a separate Vite entry from the gallery: CoverageQuickStart
 * imports Supabase, and `guard:gallery` exists to prove nothing the gallery can
 * reach ever does.
 */

function Frame({ title, width, children }: { title: string; width: number; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <p style={{ font: '600 12px/1.4 system-ui', color: '#6b7280', marginBottom: 8 }}>{title}</p>
      <div style={{ width, border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#f9fafb' }}>
        {children}
      </div>
    </div>
  )
}

function Harness() {
  const [saved, setSaved] = useState(0)
  return (
    <div style={{ padding: 24, background: '#fff', minHeight: '100vh' }}>
      <Frame title="DESKTOP — dashboard card (variant='card', 520px)" width={520}>
        <div data-harness="desktop">
          <CoverageQuickStart variant="card" onGoToIdeas={() => {}} onDismiss={() => {}} />
        </div>
      </Frame>

      <Frame title="MOBILE — Ideas feed (variant='sheet', 390px viewport width minus feed padding)" width={366}>
        <div data-harness="mobile">
          <CoverageQuickStart variant="sheet" onDismiss={() => {}} />
        </div>
      </Frame>

      <Frame title="CONFIRMATION — after save (desktop density)" width={520}>
        <div data-harness="confirm" key={saved}>
          <ConfirmPreview />
        </div>
      </Frame>
    </div>
  )
}

/** The post-save state, reached by driving the real component. */
function ConfirmPreview() {
  return <CoverageQuickStart variant="card" onGoToIdeas={() => {}} />
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={qc}><Harness /></QueryClientProvider>,
)
