/** Fixture-backed stand-ins for Today's three data hooks. Harness only. */
import { ENGINE_SLICE, ENRICHMENT } from './today-fixtures'

/* --- the decision engine ------------------------------------------------- */

/**
 * `?case=` picks which engine output the harness serves.
 *
 * `bare` exists to render the state the composition most needed proving: a
 * lead tile with nothing honest to draw. It is the same finding type as the
 * default lead -- only the enrichment is missing -- which is exactly the
 * property under test: geometry follows the data, not the evaluator.
 */
const CASE = () =>
  (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('case') : null) ?? 'default'

export const useDecisionEngine = () => ({
  selectForDashboard: () => ENGINE_SLICE,
  isLoading: false,
  error: null,
})

export const flattenForFilter = () => []

/* --- enrichment ----------------------------------------------------------- */

export const useTodayEnrichment = () => (CASE() === 'bare' ? {} : ENRICHMENT)

/* --- personal attention state --------------------------------------------- */

/**
 * Nothing suppressed. The harness is about composition, and a snoozed item
 * would silently change which objects reach the first viewport.
 */
export const useAttentionState = () => ({
  isLoading: false,
  suppressedKeys: new Set<string>(),
  isSuppressed: () => false,
  suppressionFor: () => null,
  snoozeForMe: () => {},
  unsnoozeForMe: () => {},
  dismissForMe: () => {},
  undismissForMe: () => {},
})
