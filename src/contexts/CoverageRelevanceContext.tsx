/**
 * The reader's coverage, shared down the tree — deliberately in two halves.
 *
 * The context and its reader live here and import NOTHING but React. The
 * provider that actually fetches lives in CoverageRelevanceProvider.tsx.
 *
 * That split is the whole point. `SignalCardSection` renders the coverage
 * explanation chip, and it is a presentational wrapper whose own header says
 * the card component never imports a chart — the same rule applies to a
 * database client. Reading coverage through a hook that transitively imports
 * `lib/supabase` put a live Supabase client in the import graph of every card
 * test, and `SignalCardSection.routing.test.tsx` went from passing to failing
 * on "Missing Supabase environment variables" for a component that renders a
 * label.
 *
 * So the card reads a plain React context, and one provider near the root does
 * the fetching. A tree with no provider — a test, a story, the visual harness —
 * gets `EMPTY_COVERAGE_INDEX`, which `coverageRelevanceFor` reads as `unknown`
 * and scores neutrally. Rendering without coverage must be silence, not a
 * crash and not a wrong answer.
 */

import { createContext, useContext } from 'react'
import {
  EMPTY_COVERAGE_INDEX,
  type CoverageIndex,
} from '../lib/signals/coverage-relevance'

export const CoverageRelevanceContext = createContext<CoverageIndex>(EMPTY_COVERAGE_INDEX)

/** The reader's coverage. Neutral, never absent — see the note above. */
export function useCoverageIndex(): CoverageIndex {
  return useContext(CoverageRelevanceContext)
}
