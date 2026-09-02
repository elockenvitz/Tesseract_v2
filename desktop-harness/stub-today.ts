/** Fixture-backed stand-ins for Today's three data hooks. Harness only. */
import { ENGINE_SLICE, ENRICHMENT } from './today-fixtures'

/* --- the decision engine ------------------------------------------------- */

export const useDecisionEngine = () => ({
  selectForDashboard: () => ENGINE_SLICE,
  isLoading: false,
  error: null,
})

export const flattenForFilter = () => []

/* --- enrichment ----------------------------------------------------------- */

export const useTodayEnrichment = () => ENRICHMENT

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
