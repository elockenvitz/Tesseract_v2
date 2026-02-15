/**
 * useDashboardScope — Scope state for the dashboard.
 *
 * Reads initial state from URL search params and syncs changes
 * back via history.replaceState (no page reload).
 */

import { useState, useCallback } from 'react'

export type CoverageMode = 'mine' | 'assigned' | 'visible'

export interface DashboardScope {
  portfolioId: string | null
  coverageMode: CoverageMode
  urgentOnly: boolean
}

function readFromURL(): DashboardScope {
  const params = new URLSearchParams(window.location.search)
  return {
    portfolioId: params.get('portfolio') || null,
    coverageMode: (params.get('coverage') as CoverageMode) || 'mine',
    urgentOnly: params.get('urgent') === '1',
  }
}

function writeToURL(scope: DashboardScope): void {
  const params = new URLSearchParams(window.location.search)

  if (scope.portfolioId) {
    params.set('portfolio', scope.portfolioId)
  } else {
    params.delete('portfolio')
  }

  if (scope.coverageMode !== 'mine') {
    params.set('coverage', scope.coverageMode)
  } else {
    params.delete('coverage')
  }

  if (scope.urgentOnly) {
    params.set('urgent', '1')
  } else {
    params.delete('urgent')
  }

  const qs = params.toString()
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  history.replaceState(null, '', url)
}

export function useDashboardScope(): [DashboardScope, (scope: DashboardScope) => void] {
  const [scope, setScopeState] = useState<DashboardScope>(readFromURL)

  const setScope = useCallback((next: DashboardScope) => {
    setScopeState(next)
    writeToURL(next)
  }, [])

  return [scope, setScope]
}
