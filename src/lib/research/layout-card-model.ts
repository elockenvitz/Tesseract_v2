/**
 * layout-card-model.ts
 *
 * Pure-function mapper that converts raw DB layout rows + usage metrics
 * into a display-ready card model for the Research Layout Templates grid.
 *
 * No React, no hooks, no side effects. Data in → data out.
 */

// ============================================================================
// TYPES
// ============================================================================

export type LayoutScope = 'system' | 'org' | 'team' | 'personal'

/** Per-layout usage counts from user_asset_layout_selections */
export interface LayoutUsageMetric {
  layout_id: string
  assets_using: number
  assets_with_overrides: number
}

/** Global summary across all layouts */
export interface LayoutUsageSummary {
  /** Name of the user's default template */
  defaultTemplateName: string
  /** Number of assets using a non-default template */
  assetsUsingCustomTemplates: number
  /** Number of assets with field/section overrides */
  assetsWithOverrides: number
  /** Number of distinct templates assigned to at least one asset */
  templatesInUseCount: number
  /** Total number of assets with any template assignment */
  totalAffectedAssets: number
}

/** Collaboration summary for scope derivation */
export interface LayoutCollaborationSummary {
  layout_id: string
  has_org_wide_share: boolean
  has_team_share: boolean
  has_user_share: boolean
}

/** Input layout from DB (matches SavedLayout + LayoutWithSharing shape) */
export interface LayoutInput {
  id: string
  user_id: string
  name: string
  description: string | null
  is_default: boolean
  field_config: Array<{
    field_id: string
    section_id: string
    is_visible: boolean
    display_order: number | null
    is_collapsed: boolean
  }>
  created_at: string
  updated_at: string
  is_shared_with_me?: boolean
  shared_by?: {
    id: string
    first_name?: string
    last_name?: string
    email?: string
  }
  my_permission?: 'view' | 'edit' | 'admin' | 'owner'
}

/** The display-ready card model */
export interface LayoutTemplateCardModel {
  id: string
  name: string
  description: string | null
  scope: LayoutScope
  isMyDefault: boolean
  isSystemDefault: boolean

  /** Number of visible fields in this template */
  fieldVisibleCount: number
  /** Total number of fields configured in this template */
  fieldTotalCount: number

  /** Number of assets currently using this template */
  usedByAssetsCount: number
  /** Number of assets using this template that also have overrides */
  assetsWithOverridesCount: number

  updatedAt: string | null
  createdAt: string | null
  updatedBy: string | null

  /** Display name of the template creator */
  createdByName: string | null

  /** Permission level (for shared layouts) */
  permission: 'owner' | 'admin' | 'edit' | 'view'
  /** Who shared this layout (for shared layouts) */
  sharedByName: string | null
  /** Whether the user can edit this layout */
  canEdit: boolean
  /** Whether the user can delete this layout */
  canDelete: boolean
  /** Whether the user can share this layout */
  canShare: boolean
}

// ============================================================================
// SCOPE DERIVATION
// ============================================================================

/**
 * Derive the scope of a layout based on its properties and collaboration info.
 *
 * Rules:
 *  - id === 'system-default'                   → 'system'
 *  - is_shared_with_me (viewer/editor)          → derive from how it was shared
 *  - has org-wide collaboration                 → 'org'
 *  - has team collaboration                     → 'team'
 *  - otherwise (personal, no collaborations)    → 'personal'
 */
export function deriveScope(
  layout: LayoutInput,
  collabSummary: LayoutCollaborationSummary | undefined
): LayoutScope {
  if (layout.id === 'system-default') return 'system'

  if (collabSummary) {
    if (collabSummary.has_org_wide_share) return 'org'
    if (collabSummary.has_team_share) return 'team'
    if (collabSummary.has_user_share) return 'personal' // shared with specific users, still personal scope
  }

  return 'personal'
}

// ============================================================================
// PERMISSION HELPERS
// ============================================================================

/**
 * Human-readable permission label for display on cards.
 *
 * System templates: null (inherently read-only, communicated via scope badge).
 * Owner: null (no label needed — you own it).
 * Non-owner with edit/admin: 'Editable'.
 * Non-owner with view-only: 'Read-only'.
 */
export function getPermissionLabel(card: LayoutTemplateCardModel): 'Editable' | 'Read-only' | null {
  if (card.isSystemDefault) return null
  if (card.permission === 'owner') return null
  if (card.permission === 'edit' || card.permission === 'admin') return 'Editable'
  return 'Read-only'
}

/**
 * Indicator label for "my default" on cards.
 *
 * Returns a differentiated label depending on whether the card is system-owned
 * or user-owned, so the system template doesn't look like something the user
 * "owns" when it's merely their selected default.
 *
 *  - System default selected as default → "Default for me"  (subtle)
 *  - User-owned template set as default → "My default"      (primary)
 *  - Not the user's default             → null
 */
export function getDefaultIndicator(card: LayoutTemplateCardModel): 'My default' | 'Default for me' | null {
  if (!card.isMyDefault) return null
  if (card.isSystemDefault) return 'Default for me'
  return 'My default'
}

/** Tooltip text explaining why an action is unavailable */
export function getDisabledReason(
  action: 'edit' | 'delete' | 'share' | 'setDefault',
  card: LayoutTemplateCardModel
): string | null {
  if (card.isSystemDefault) {
    if (action === 'edit') return 'System template cannot be edited. Duplicate to customize.'
    if (action === 'delete') return 'System template cannot be deleted.'
    if (action === 'share') return 'System template is available to everyone.'
    if (action === 'setDefault') return null
  }

  if (action === 'edit' && !card.canEdit) {
    return 'You have read-only access. Duplicate to customize.'
  }
  if (action === 'delete' && !card.canDelete) {
    if (card.permission !== 'owner') return 'Only the owner can delete this template.'
    if (card.isMyDefault) return 'Unset as default before deleting.'
    return null
  }
  if (action === 'share' && !card.canShare) {
    if (card.permission !== 'owner') return 'Only the owner can share this template.'
    return null
  }
  return null
}

/** Tooltip for the scope badge */
export function getScopeTooltip(card: LayoutTemplateCardModel): string {
  switch (card.scope) {
    case 'system': return 'System-wide fallback baseline'
    case 'org': return 'Shared org-wide'
    case 'team': return 'Shared with team'
    case 'personal': return 'Private to you'
  }
}

// ============================================================================
// SPEC VIEW HELPERS (read-only template preview)
// ============================================================================

/**
 * Whether a template should open in read-only Spec View instead of the editor.
 * Currently: system templates. Future: published org templates.
 */
export function isReadOnlyTemplate(scope: LayoutScope): boolean {
  return scope === 'system'
}

/** Primary CTA label for the spec view footer */
export function getSpecCtaLabel(scope: LayoutScope): string {
  if (scope === 'system') return 'Create Editable Copy'
  return 'Duplicate'
}

/** Context line shown under the template name in spec view */
export function getSpecContextLine(scope: LayoutScope, isMyDefault: boolean): string | null {
  if (scope === 'system') {
    return isMyDefault
      ? 'Fallback baseline when no template is selected. Currently your default.'
      : 'Fallback baseline when no template is selected.'
  }
  return null
}

// Legacy aliases (kept for existing callers during migration)
/** @deprecated Use isReadOnlyTemplate */
export const shouldShowReadOnlyBanner = isReadOnlyTemplate
/** @deprecated Use getSpecCtaLabel */
export const getPreviewCtaLabel = getSpecCtaLabel
/** @deprecated Use getSpecContextLine */
export const getPreviewContextLine = getSpecContextLine

// ============================================================================
// MAPPER
// ============================================================================

export interface MapLayoutCardsInput {
  layouts: LayoutInput[]
  currentUserId: string
  currentUserName: string | null
  usageMetrics: LayoutUsageMetric[]
  collabSummaries: LayoutCollaborationSummary[]
}

/**
 * Map raw layout rows + metrics → display-ready card models.
 *
 * Pure function, fully deterministic.
 */
export function mapLayoutCards(input: MapLayoutCardsInput): LayoutTemplateCardModel[] {
  const { layouts, currentUserId, currentUserName, usageMetrics, collabSummaries } = input

  const usageMap = new Map(usageMetrics.map(m => [m.layout_id, m]))
  const collabMap = new Map(collabSummaries.map(c => [c.layout_id, c]))

  return layouts.map(layout => {
    const usage = usageMap.get(layout.id)
    const collab = collabMap.get(layout.id)
    const scope = deriveScope(layout, collab)
    const isSystemDefault = layout.id === 'system-default'
    const isOwner = layout.user_id === currentUserId || layout.my_permission === 'owner'
    const isShared = layout.is_shared_with_me === true
    const permission = (layout.my_permission || (isOwner ? 'owner' : 'view')) as LayoutTemplateCardModel['permission']

    const canEdit = isSystemDefault
      ? false // system default is read-only; duplicate to customize
      : permission === 'owner' || permission === 'edit' || permission === 'admin'

    const canDelete = !isSystemDefault && isOwner && !layout.is_default
    const canShare = !isSystemDefault && isOwner

    const sharedByName = layout.shared_by
      ? layout.shared_by.first_name && layout.shared_by.last_name
        ? `${layout.shared_by.first_name} ${layout.shared_by.last_name}`.trim()
        : layout.shared_by.email || null
      : null

    // Created by: for owned layouts use current user name, for shared use shared_by
    let createdByName: string | null = null
    if (isSystemDefault) {
      createdByName = null
    } else if (isOwner) {
      createdByName = currentUserName || 'You'
    } else if (sharedByName) {
      createdByName = sharedByName
    }

    return {
      id: layout.id,
      name: layout.name,
      description: layout.description,
      scope,
      isMyDefault: layout.is_default && !isShared,
      isSystemDefault,
      fieldVisibleCount: layout.field_config?.filter(f => f.is_visible).length ?? 0,
      fieldTotalCount: layout.field_config?.length ?? 0,
      usedByAssetsCount: usage?.assets_using ?? 0,
      assetsWithOverridesCount: usage?.assets_with_overrides ?? 0,
      updatedAt: layout.updated_at || null,
      createdAt: layout.created_at || null,
      updatedBy: isShared ? sharedByName : null,
      createdByName,
      permission,
      sharedByName,
      canEdit,
      canDelete,
      canShare,
    }
  })
}

// ============================================================================
// SUMMARY BUILDER
// ============================================================================

/**
 * Build the global usage summary for the status strip.
 */
export function buildUsageSummary(
  cards: LayoutTemplateCardModel[],
  globalOverrideCount: number
): LayoutUsageSummary {
  const myDefault = cards.find(c => c.isMyDefault)
  const systemDefault = cards.find(c => c.isSystemDefault)

  const defaultName = myDefault?.name ?? systemDefault?.name ?? 'System Default'

  // Assets using non-default = sum of usedByAssetsCount for non-default templates
  const assetsUsingCustom = cards
    .filter(c => !c.isMyDefault && !c.isSystemDefault)
    .reduce((sum, c) => sum + c.usedByAssetsCount, 0)

  const templatesInUse = cards.filter(c => c.usedByAssetsCount > 0)
  const totalAffectedAssets = cards.reduce((sum, c) => sum + c.usedByAssetsCount, 0)

  return {
    defaultTemplateName: defaultName,
    assetsUsingCustomTemplates: assetsUsingCustom,
    assetsWithOverrides: globalOverrideCount,
    templatesInUseCount: templatesInUse.length,
    totalAffectedAssets,
  }
}

// ============================================================================
// FILTER + SEARCH
// ============================================================================

export type ScopeFilter = 'all' | LayoutScope

export interface CardFilterState {
  search: string
  scopeFilter: ScopeFilter
  usedByAssetsOnly: boolean
}

export const DEFAULT_FILTER_STATE: CardFilterState = {
  search: '',
  scopeFilter: 'all',
  usedByAssetsOnly: false,
}

/**
 * Filter + search cards. Pure function.
 */
export function filterCards(
  cards: LayoutTemplateCardModel[],
  filters: CardFilterState
): LayoutTemplateCardModel[] {
  let result = cards

  // Search (also matches creator name)
  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase()
    result = result.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.description?.toLowerCase().includes(q) ?? false) ||
      (c.createdByName?.toLowerCase().includes(q) ?? false)
    )
  }

  // Scope filter
  if (filters.scopeFilter !== 'all') {
    result = result.filter(c => c.scope === filters.scopeFilter)
  }

  // Used by assets toggle
  if (filters.usedByAssetsOnly) {
    result = result.filter(c => c.usedByAssetsCount > 0)
  }

  return result
}

// ============================================================================
// SORT (within groups)
// ============================================================================

export type CardSortKey = 'name' | 'recently_updated' | 'most_used'

/**
 * Sort cards within a group.
 *
 * Pinning rules always apply first: system default → my default → owned before shared.
 * Within the same tier, the sortKey determines order:
 *   - 'name':             A-Z (default)
 *   - 'recently_updated': newest first
 *   - 'most_used':        highest usedByAssetsCount first
 */
export function sortCards(
  cards: LayoutTemplateCardModel[],
  sortKey: CardSortKey = 'name'
): LayoutTemplateCardModel[] {
  return [...cards].sort((a, b) => {
    // System default always first
    if (a.isSystemDefault && !b.isSystemDefault) return -1
    if (!a.isSystemDefault && b.isSystemDefault) return 1

    // My default second
    if (a.isMyDefault && !b.isMyDefault) return -1
    if (!a.isMyDefault && b.isMyDefault) return 1

    // Owned before shared
    const aOwned = a.permission === 'owner'
    const bOwned = b.permission === 'owner'
    if (aOwned && !bOwned) return -1
    if (!aOwned && bOwned) return 1

    // Secondary sort by key
    if (sortKey === 'recently_updated') {
      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
    }
    if (sortKey === 'most_used') {
      return b.usedByAssetsCount - a.usedByAssetsCount
    }
    return a.name.localeCompare(b.name)
  })
}

// ============================================================================
// SCOPE GROUPING
// ============================================================================

/** Display order for scope groups */
const SCOPE_ORDER: LayoutScope[] = ['system', 'org', 'team', 'personal']

export interface ScopeGroup {
  scope: LayoutScope
  label: string
  sublabel: string | null
  cards: LayoutTemplateCardModel[]
}

const SCOPE_GROUP_META: Record<LayoutScope, { label: string; sublabel: string | null }> = {
  system:   { label: 'System Templates',       sublabel: 'Fallback baseline available to everyone' },
  org:      { label: 'Organization Templates', sublabel: 'Shared org-wide. May be read-only — duplicate to customize.' },
  team:     { label: 'Team Templates',         sublabel: 'Shared with your team. May be read-only — duplicate to customize.' },
  personal: { label: 'Personal Templates',     sublabel: null },
}

/**
 * Group filtered+sorted cards by scope, in hierarchy order.
 * Empty groups are omitted.
 */
export function groupCardsByScope(cards: LayoutTemplateCardModel[], sortKey: CardSortKey = 'name'): ScopeGroup[] {
  const byScope = new Map<LayoutScope, LayoutTemplateCardModel[]>()

  for (const card of cards) {
    const list = byScope.get(card.scope) || []
    list.push(card)
    byScope.set(card.scope, list)
  }

  const groups: ScopeGroup[] = []
  for (const scope of SCOPE_ORDER) {
    const scopeCards = byScope.get(scope)
    if (!scopeCards || scopeCards.length === 0) continue
    const meta = SCOPE_GROUP_META[scope]
    groups.push({
      scope,
      label: meta.label,
      sublabel: meta.sublabel,
      cards: sortCards(scopeCards, sortKey),
    })
  }

  return groups
}
