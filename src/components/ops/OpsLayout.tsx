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

export function OpsLayout() {
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <OpsHeader />
      <div className="flex-1 flex overflow-hidden">
        <OpsSidebar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<OpsDashboardPage />} />
            <Route path="clients" element={<OpsClientsPage />} />
            <Route path="clients/:orgId" element={<OpsClientDetailPage />} />
            <Route path="holdings" element={<OpsHoldingsPage />} />
            <Route path="metrics" element={<OpsMetricsPage />} />
            <Route path="support" element={<OpsSupportPage />} />
            <Route path="settings" element={<OpsSettingsPage />} />
            <Route path="*" element={<Navigate to="/ops" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
