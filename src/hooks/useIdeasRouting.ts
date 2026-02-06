import { useState, useCallback, useMemo, useEffect } from 'react'
import { TabStateManager } from '../lib/tabStateManager'

// ============================================================================
// IDEAS TAB STATE MANAGEMENT
// Uses TabStateManager for persistence (tab-based navigation)
// Supports initial filters from tab data for deep-linking
// ============================================================================

// Valid param values with type safety
export type IdeasTypeFilter = 'all' | 'quick_thought' | 'trade_idea' | 'note' | 'thesis_update' | 'insight'
export type IdeasScope = 'mine' | 'team' | 'following' | 'all'
export type IdeasView = 'discovery' | 'feed'
export type IdeasTimeRange = 'today' | 'week' | 'month' | 'all'
export type IdeasSort = 'created' | 'revisit'

// Defaults
const DEFAULTS = {
  type: 'all' as IdeasTypeFilter,
  scope: 'mine' as IdeasScope,
  view: 'discovery' as IdeasView,
  time: 'all' as IdeasTimeRange,
  sort: 'created' as IdeasSort,
} as const

// Valid values for validation
const VALID_TYPES: IdeasTypeFilter[] = ['all', 'quick_thought', 'trade_idea', 'note', 'thesis_update', 'insight']
const VALID_SCOPES: IdeasScope[] = ['mine', 'team', 'following', 'all']
const VALID_VIEWS: IdeasView[] = ['discovery', 'feed']
const VALID_TIMES: IdeasTimeRange[] = ['today', 'week', 'month', 'all']
const VALID_SORTS: IdeasSort[] = ['created', 'revisit']

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TAB_STATE_KEY = 'idea-generator'

/**
 * Validate and coerce a param value to a valid enum value
 */
function validateParam<T extends string>(value: string | undefined | null, validValues: T[], defaultValue: T): T {
  if (!value) return defaultValue
  return validValues.includes(value as T) ? (value as T) : defaultValue
}

/**
 * Validate UUID param - returns null if invalid
 */
function validateUUID(value: string | undefined | null): string | null {
  if (!value) return null
  return UUID_REGEX.test(value) ? value : null
}

/**
 * Parsed and validated filter state
 */
export interface IdeasFilterState {
  typeFilter: IdeasTypeFilter
  scope: IdeasScope
  view: IdeasView
  timeRange: IdeasTimeRange
  sort: IdeasSort
  assetId: string | null
  portfolioId: string | null
  themeId: string | null
}

/**
 * Initial filters that can be passed to the Ideas tab
 */
export interface IdeasInitialFilters {
  type?: IdeasTypeFilter
  scope?: IdeasScope
  view?: IdeasView
  time?: IdeasTimeRange
  sort?: IdeasSort
  assetId?: string
  portfolioId?: string
  themeId?: string
}

/**
 * Hook for managing Ideas tab filter state
 *
 * Uses TabStateManager for persistence across tab switches.
 * Supports initial filters passed from tab data.
 *
 * @param initialFilters - Optional initial filters from tab data (e.g., from "View all" navigation)
 */
export function useIdeasRouting(initialFilters?: IdeasInitialFilters) {
  // Load saved state from TabStateManager
  const loadState = useCallback((): IdeasFilterState => {
    const saved = TabStateManager.loadTabState(TAB_STATE_KEY)

    // If initial filters provided (e.g., from "View all"), use those
    // Otherwise fall back to saved state, then defaults
    return {
      typeFilter: validateParam(initialFilters?.type || saved?.typeFilter, VALID_TYPES, DEFAULTS.type),
      scope: validateParam(initialFilters?.scope || saved?.scope, VALID_SCOPES, DEFAULTS.scope),
      view: validateParam(initialFilters?.view || saved?.view, VALID_VIEWS, DEFAULTS.view),
      timeRange: validateParam(initialFilters?.time || saved?.timeRange, VALID_TIMES, DEFAULTS.time),
      sort: validateParam(initialFilters?.sort || saved?.sort, VALID_SORTS, DEFAULTS.sort),
      assetId: validateUUID(initialFilters?.assetId || saved?.assetId),
      portfolioId: validateUUID(initialFilters?.portfolioId || saved?.portfolioId),
      themeId: validateUUID(initialFilters?.themeId || saved?.themeId),
    }
  }, [initialFilters])

  // State
  const [filterState, setFilterState] = useState<IdeasFilterState>(loadState)

  // Apply initial filters when they change (e.g., when navigating with "View all")
  useEffect(() => {
    if (initialFilters && Object.keys(initialFilters).length > 0) {
      const newState = loadState()
      setFilterState(newState)
    }
  }, [initialFilters, loadState])

  // Save state to TabStateManager whenever it changes
  useEffect(() => {
    TabStateManager.saveTabState(TAB_STATE_KEY, filterState)
  }, [filterState])

  // ============================================================================
  // SETTERS
  // ============================================================================

  const setTypeFilter = useCallback((value: IdeasTypeFilter) => {
    setFilterState(prev => ({ ...prev, typeFilter: value }))
  }, [])

  const setScope = useCallback((value: IdeasScope) => {
    setFilterState(prev => ({ ...prev, scope: value }))
  }, [])

  const setView = useCallback((value: IdeasView) => {
    setFilterState(prev => ({ ...prev, view: value }))
  }, [])

  const setTimeRange = useCallback((value: IdeasTimeRange) => {
    setFilterState(prev => ({ ...prev, timeRange: value }))
  }, [])

  const setSort = useCallback((value: IdeasSort) => {
    setFilterState(prev => ({ ...prev, sort: value }))
  }, [])

  const setContextParam = useCallback((
    contextType: 'asset' | 'portfolio' | 'theme',
    id: string | null
  ) => {
    setFilterState(prev => {
      const update: Partial<IdeasFilterState> = {}
      if (contextType === 'asset') update.assetId = id
      else if (contextType === 'portfolio') update.portfolioId = id
      else if (contextType === 'theme') update.themeId = id
      return { ...prev, ...update }
    })
  }, [])

  const clearContextFilters = useCallback(() => {
    setFilterState(prev => ({
      ...prev,
      assetId: null,
      portfolioId: null,
      themeId: null,
    }))
  }, [])

  const resetFilters = useCallback(() => {
    setFilterState({
      typeFilter: DEFAULTS.type,
      scope: DEFAULTS.scope,
      view: DEFAULTS.view,
      timeRange: DEFAULTS.time,
      sort: DEFAULTS.sort,
      assetId: null,
      portfolioId: null,
      themeId: null,
    })
  }, [])

  /**
   * Reset to Quick Thoughts view
   */
  const resetToQuickThoughts = useCallback((preserveContext = true) => {
    setFilterState(prev => ({
      typeFilter: 'quick_thought',
      scope: 'mine',
      view: 'discovery',
      timeRange: DEFAULTS.time,
      sort: DEFAULTS.sort,
      assetId: preserveContext ? prev.assetId : null,
      portfolioId: preserveContext ? prev.portfolioId : null,
      themeId: preserveContext ? prev.themeId : null,
    }))
  }, [])

  // ============================================================================
  // UTILITY
  // ============================================================================

  const hasActiveFilters = useMemo(() => {
    return (
      filterState.typeFilter !== DEFAULTS.type ||
      filterState.scope !== DEFAULTS.scope ||
      filterState.timeRange !== DEFAULTS.time ||
      filterState.sort !== DEFAULTS.sort ||
      filterState.assetId !== null ||
      filterState.portfolioId !== null ||
      filterState.themeId !== null
    )
  }, [filterState])

  const isQuickThoughtsView = filterState.typeFilter === 'quick_thought'

  return {
    // Derived state
    ...filterState,
    hasActiveFilters,
    isQuickThoughtsView,

    // Individual setters
    setTypeFilter,
    setScope,
    setView,
    setTimeRange,
    setSort,
    setContextParam,

    // Batch operations
    clearContextFilters,
    resetFilters,
    resetToQuickThoughts,
  }
}

// ============================================================================
// HELPER: Build initial filters for "View all" navigation
// ============================================================================

export interface IdeasContext {
  type?: 'asset' | 'portfolio' | 'theme'
  id?: string
}

/**
 * Build initial filters object for opening Ideas tab with Quick Thoughts filter
 */
export function buildQuickThoughtsFilters(context?: IdeasContext): IdeasInitialFilters {
  const filters: IdeasInitialFilters = {
    type: 'quick_thought',
    scope: 'mine',
    view: 'discovery',
  }

  if (context?.type && context?.id && UUID_REGEX.test(context.id)) {
    if (context.type === 'asset') filters.assetId = context.id
    else if (context.type === 'portfolio') filters.portfolioId = context.id
    else if (context.type === 'theme') filters.themeId = context.id
  }

  return filters
}

// ============================================================================
// MAPPING HELPERS
// Map filter values to existing FeedFilters format
// ============================================================================

/**
 * Map time range to FeedFilters timeRange
 */
export function mapTimeRangeToFeedFilter(time: IdeasTimeRange): 'day' | 'week' | 'month' | 'all' {
  switch (time) {
    case 'today': return 'day'
    case 'week': return 'week'
    case 'month': return 'month'
    case 'all': return 'all'
  }
}

/**
 * Map type filter to FeedFilters types array
 */
export function mapTypeToFeedFilter(type: IdeasTypeFilter): string[] | undefined {
  if (type === 'all') return undefined
  return [type]
}
