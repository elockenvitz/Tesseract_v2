/**
 * OpsLayout — Shell layout for the Tesseract Operations Portal.
 * Provides its own header, sidebar, and content area — completely
 * separate from the product's tab-based Layout.
 */

import { Routes, Route, Navigate } from 'react-router-dom'
import { OpsHeader } from './OpsHeader'
import { OpsSidebar } from './OpsSidebar'
import { OpsDashboardPage } from '../../pages/ops/OpsDashboardPage'
import { OpsClientsPage } from '../../pages/ops/OpsClientsPage'
import { OpsClientDetailPage } from '../../pages/ops/OpsClientDetailPage'
import { OpsHoldingsPage } from '../../pages/ops/OpsHoldingsPage'
import { OpsSupportPage } from '../../pages/ops/OpsSupportPage'
import { OpsSettingsPage } from '../../pages/ops/OpsSettingsPage'
import { OpsMetricsPage } from '../../pages/ops/OpsMetricsPage'
import { OpsAIUsagePage } from '../../pages/ops/OpsAIUsagePage'

/*
 * Phone: the sidebar becomes a scrolling strip under the header and the page
 * scrolls in `main` alone. Desktop (md and up) is the same side-by-side shell.
 * `h-viewport` rather than `h-screen`: on a phone 100vh is taller than the
 * visible area, so the bottom of every page sat below the URL bar.
 */
export function OpsLayout() {
  return (
    <div className="h-viewport flex flex-col bg-gray-50 dark:bg-gray-900">
      <OpsHeader />
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        <OpsSidebar />
        <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain">
          <Routes>
            <Route path="/" element={<OpsDashboardPage />} />
            <Route path="clients" element={<OpsClientsPage />} />
            <Route path="clients/:orgId" element={<OpsClientDetailPage />} />
            <Route path="holdings" element={<OpsHoldingsPage />} />
            <Route path="metrics" element={<OpsMetricsPage />} />
            <Route path="ai-usage" element={<OpsAIUsagePage />} />
            <Route path="support" element={<OpsSupportPage />} />
            <Route path="settings" element={<OpsSettingsPage />} />
            <Route path="*" element={<Navigate to="/ops" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
