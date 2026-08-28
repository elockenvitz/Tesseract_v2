/**
 * The one place coverage is fetched for ranking and explanation.
 *
 * Mounted once inside `OrganizationProvider`, because the query is scoped to
 * the current organization and there is no correct answer above it.
 *
 * Separate file from the context so that consumers — card components, mostly —
 * can read coverage without pulling `lib/supabase` into their import graph.
 * See CoverageRelevanceContext.tsx.
 */

import type { ReactNode } from 'react'
import { CoverageRelevanceContext } from './CoverageRelevanceContext'
import { useCoverageRelevance } from '../hooks/useCoverageRelevance'

export function CoverageRelevanceProvider({ children }: { children: ReactNode }) {
  const index = useCoverageRelevance()
  return (
    <CoverageRelevanceContext.Provider value={index}>
      {children}
    </CoverageRelevanceContext.Provider>
  )
}
