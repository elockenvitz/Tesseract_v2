import { describe, it, expect } from 'vitest'
import {
  deriveScope,
  mapLayoutCards,
  buildUsageSummary,
  filterCards,
  sortCards,
  groupCardsByScope,
  getPermissionLabel,
  getDefaultIndicator,
  getDisabledReason,
  getScopeTooltip,
  isReadOnlyTemplate,
  getSpecCtaLabel,
  getSpecContextLine,
  DEFAULT_FILTER_STATE,
  type LayoutInput,
  type LayoutUsageMetric,
  type LayoutCollaborationSummary,
  type LayoutTemplateCardModel,
  type MapLayoutCardsInput,
} from './layout-card-model'

// ============================================================================
// HELPERS
// ============================================================================

const USER_ID = 'user-1'
const USER_NAME = 'John Doe'

function makeLayout(overrides: Partial<LayoutInput> = {}): LayoutInput {
  return {
    id: 'layout-1',
    user_id: USER_ID,
    name: 'My Layout',
    description: null,
    is_default: false,
    field_config: [
      { field_id: 'f1', section_id: 's1', is_visible: true, display_order: 0, is_collapsed: false },
      { field_id: 'f2', section_id: 's1', is_visible: false, display_order: 1, is_collapsed: false },
      { field_id: 'f3', section_id: 's1', is_visible: true, display_order: 2, is_collapsed: false },
    ],
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-06-15T10:30:00Z',
    ...overrides,
  }
}

function makeSystemDefault(): LayoutInput {
  return makeLayout({
    id: 'system-default',
    user_id: '',
    name: 'Default',
    description: 'System default - shows all standard fields',
    is_default: true,
  })
}

function makeInput(overrides: Partial<MapLayoutCardsInput> = {}): MapLayoutCardsInput {
  return {
    layouts: [makeLayout()],
    currentUserId: USER_ID,
    currentUserName: USER_NAME,
    usageMetrics: [],
    collabSummaries: [],
    ...overrides,
  }
}

// ============================================================================
// deriveScope
// ============================================================================

describe('deriveScope', () => {
  it('returns system for system-default layout', () => {
    expect(deriveScope(makeSystemDefault(), undefined)).toBe('system')
  })

  it('returns personal when no collaboration summary', () => {
    expect(deriveScope(makeLayout(), undefined)).toBe('personal')
  })

  it('returns org when has org-wide share', () => {
    const collab: LayoutCollaborationSummary = {
      layout_id: 'layout-1',
      has_org_wide_share: true,
      has_team_share: false,
      has_user_share: false,
    }
    expect(deriveScope(makeLayout(), collab)).toBe('org')
  })

  it('returns team when has team share', () => {
    const collab: LayoutCollaborationSummary = {
      layout_id: 'layout-1',
      has_org_wide_share: false,
      has_team_share: true,
      has_user_share: false,
    }
    expect(deriveScope(makeLayout(), collab)).toBe('team')
  })

  it('returns personal when only has user-level shares', () => {
    const collab: LayoutCollaborationSummary = {
      layout_id: 'layout-1',
      has_org_wide_share: false,
      has_team_share: false,
      has_user_share: true,
    }
    expect(deriveScope(makeLayout(), collab)).toBe('personal')
  })

  it('org takes precedence over team', () => {
    const collab: LayoutCollaborationSummary = {
      layout_id: 'layout-1',
      has_org_wide_share: true,
      has_team_share: true,
      has_user_share: true,
    }
    expect(deriveScope(makeLayout(), collab)).toBe('org')
  })
})

// ============================================================================
// mapLayoutCards
// ============================================================================

describe('mapLayoutCards', () => {
  it('maps basic owned layout with createdByName', () => {
    const input = makeInput({
      usageMetrics: [{ layout_id: 'layout-1', assets_using: 5, assets_with_overrides: 2 }],
    })

    const [card] = mapLayoutCards(input)
    expect(card.id).toBe('layout-1')
    expect(card.scope).toBe('personal')
    expect(card.isMyDefault).toBe(false)
    expect(card.isSystemDefault).toBe(false)
    expect(card.fieldVisibleCount).toBe(2)
    expect(card.fieldTotalCount).toBe(3)
    expect(card.usedByAssetsCount).toBe(5)
    expect(card.assetsWithOverridesCount).toBe(2)
    expect(card.permission).toBe('owner')
    expect(card.canEdit).toBe(true)
    expect(card.canDelete).toBe(true)
    expect(card.canShare).toBe(true)
    expect(card.createdByName).toBe('John Doe')
  })

  it('maps system-default layout correctly', () => {
    const [card] = mapLayoutCards(makeInput({ layouts: [makeSystemDefault()] }))
    expect(card.scope).toBe('system')
    expect(card.isSystemDefault).toBe(true)
    expect(card.canDelete).toBe(false)
    expect(card.canShare).toBe(false)
    expect(card.canEdit).toBe(false) // read-only; duplicate to customize
    expect(card.createdByName).toBeNull()
  })

  it('maps user default layout', () => {
    const [card] = mapLayoutCards(makeInput({ layouts: [makeLayout({ is_default: true })] }))
    expect(card.isMyDefault).toBe(true)
    expect(card.canDelete).toBe(false) // default can't be deleted
  })

  it('maps shared layout with correct permissions', () => {
    const [card] = mapLayoutCards(makeInput({
      layouts: [makeLayout({
        id: 'shared-1',
        user_id: 'other-user',
        is_shared_with_me: true,
        shared_by: { id: 'other-user', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' },
        my_permission: 'view',
      })],
    }))
    expect(card.permission).toBe('view')
    expect(card.canEdit).toBe(false)
    expect(card.canDelete).toBe(false)
    expect(card.canShare).toBe(false)
    expect(card.sharedByName).toBe('Jane Doe')
    expect(card.createdByName).toBe('Jane Doe')
  })

  it('maps shared layout with edit permission', () => {
    const [card] = mapLayoutCards(makeInput({
      layouts: [makeLayout({
        id: 'shared-1',
        user_id: 'other-user',
        is_shared_with_me: true,
        my_permission: 'edit',
      })],
    }))
    expect(card.canEdit).toBe(true)
  })

  it('defaults usage to zero when no metrics provided', () => {
    const [card] = mapLayoutCards(makeInput())
    expect(card.usedByAssetsCount).toBe(0)
    expect(card.assetsWithOverridesCount).toBe(0)
  })

  it('handles layout with null field_config', () => {
    const [card] = mapLayoutCards(makeInput({ layouts: [makeLayout({ field_config: null as any })] }))
    expect(card.fieldVisibleCount).toBe(0)
    expect(card.fieldTotalCount).toBe(0)
  })

  it('applies org scope from collab summary', () => {
    const [card] = mapLayoutCards(makeInput({
      collabSummaries: [{ layout_id: 'layout-1', has_org_wide_share: true, has_team_share: false, has_user_share: false }],
    }))
    expect(card.scope).toBe('org')
  })

  it('uses "You" when currentUserName is null', () => {
    const [card] = mapLayoutCards(makeInput({ currentUserName: null }))
    expect(card.createdByName).toBe('You')
  })
})

// ============================================================================
// getPermissionLabel
// ============================================================================

describe('getPermissionLabel', () => {
  it('returns null for system default (inherently read-only, no pill needed)', () => {
    const card = mapLayoutCards(makeInput({ layouts: [makeSystemDefault()] }))[0]
    expect(getPermissionLabel(card)).toBeNull()
  })

  it('returns null for owner', () => {
    const card = mapLayoutCards(makeInput())[0]
    expect(getPermissionLabel(card)).toBeNull()
  })

  it('returns Read-only for view permission', () => {
    const card = mapLayoutCards(makeInput({
      layouts: [makeLayout({ user_id: 'other', is_shared_with_me: true, my_permission: 'view' })],
    }))[0]
    expect(getPermissionLabel(card)).toBe('Read-only')
  })

  it('returns Editable for edit permission', () => {
    const card = mapLayoutCards(makeInput({
      layouts: [makeLayout({ user_id: 'other', is_shared_with_me: true, my_permission: 'edit' })],
    }))[0]
    expect(getPermissionLabel(card)).toBe('Editable')
  })
})

// ============================================================================
// getDefaultIndicator
// ============================================================================

describe('getDefaultIndicator', () => {
  it('returns null when card is not default', () => {
    const card = mapLayoutCards(makeInput())[0]
    expect(getDefaultIndicator(card)).toBeNull()
  })

  it('returns "My default" for user-owned default template', () => {
    const card = mapLayoutCards(makeInput({ layouts: [makeLayout({ is_default: true })] }))[0]
    expect(getDefaultIndicator(card)).toBe('My default')
  })

  it('returns "Default for me" for system template selected as default', () => {
    const card = mapLayoutCards(makeInput({ layouts: [makeSystemDefault()] }))[0]
    // System default has is_default: true → isMyDefault: true + isSystemDefault: true
    expect(getDefaultIndicator(card)).toBe('Default for me')
  })

  it('returns null for system template not selected as default', () => {
    const card = mapLayoutCards(makeInput({ layouts: [makeLayout({
      id: 'system-default',
      user_id: '',
      name: 'Default',
      is_default: false,
    })] }))[0]
    expect(getDefaultIndicator(card)).toBeNull()
  })
})

// ============================================================================
// getDisabledReason
// ============================================================================

describe('getDisabledReason', () => {
  it('returns reason for editing system template', () => {
    const card = mapLayoutCards(makeInput({ layouts: [makeSystemDefault()] }))[0]
    expect(getDisabledReason('edit', card)).toContain('System template')
  })

  it('returns reason for deleting system template', () => {
    const card = mapLayoutCards(makeInput({ layouts: [makeSystemDefault()] }))[0]
    expect(getDisabledReason('delete', card)).toContain('cannot be deleted')
  })

  it('returns null for valid owner actions', () => {
    const card = mapLayoutCards(makeInput())[0]
    expect(getDisabledReason('edit', card)).toBeNull()
    expect(getDisabledReason('share', card)).toBeNull()
  })

  it('returns reason for non-owner delete', () => {
    const card = mapLayoutCards(makeInput({
      layouts: [makeLayout({ user_id: 'other', is_shared_with_me: true, my_permission: 'view' })],
    }))[0]
    expect(getDisabledReason('delete', card)).toContain('Only the owner')
  })
})

// ============================================================================
// getScopeTooltip
// ============================================================================

describe('getScopeTooltip', () => {
  it('returns appropriate text per scope', () => {
    const card = mapLayoutCards(makeInput())[0]
    expect(getScopeTooltip({ ...card, scope: 'system' })).toContain('System')
    expect(getScopeTooltip({ ...card, scope: 'org' })).toContain('org-wide')
    expect(getScopeTooltip({ ...card, scope: 'team' })).toContain('team')
    expect(getScopeTooltip({ ...card, scope: 'personal' })).toContain('Private')
  })
})

// ============================================================================
// buildUsageSummary
// ============================================================================

describe('buildUsageSummary', () => {
  it('builds summary with user default', () => {
    const cards = [
      mapLayoutCards(makeInput({ layouts: [makeLayout({ is_default: true, name: 'My Default' })] }))[0],
      mapLayoutCards(makeInput({
        layouts: [makeLayout({ id: 'l2', name: 'Other', updated_at: '2025-06-20T00:00:00Z' })],
        usageMetrics: [{ layout_id: 'l2', assets_using: 3, assets_with_overrides: 0 }],
      }))[0],
    ]

    const summary = buildUsageSummary(cards, 7)
    expect(summary.defaultTemplateName).toBe('My Default')
    expect(summary.assetsUsingCustomTemplates).toBe(3)
    expect(summary.assetsWithOverrides).toBe(7)
    expect(summary.templatesInUseCount).toBe(1) // only l2 has assets_using > 0
    expect(summary.totalAffectedAssets).toBe(3)
  })

  it('falls back to System Default when no user default', () => {
    const cards = [mapLayoutCards(makeInput({ layouts: [makeSystemDefault()] }))[0]]
    const summary = buildUsageSummary(cards, 0)
    expect(summary.defaultTemplateName).toBe('Default')
  })

  it('handles empty cards array', () => {
    const summary = buildUsageSummary([], 0)
    expect(summary.defaultTemplateName).toBe('System Default')
    expect(summary.assetsUsingCustomTemplates).toBe(0)
    expect(summary.templatesInUseCount).toBe(0)
    expect(summary.totalAffectedAssets).toBe(0)
  })

  it('counts templates in use and total affected assets', () => {
    const cards = mapLayoutCards(makeInput({
      layouts: [
        makeLayout({ id: 'l1', name: 'Active 1' }),
        makeLayout({ id: 'l2', name: 'Active 2' }),
        makeLayout({ id: 'l3', name: 'Unused' }),
      ],
      usageMetrics: [
        { layout_id: 'l1', assets_using: 5, assets_with_overrides: 1 },
        { layout_id: 'l2', assets_using: 3, assets_with_overrides: 0 },
        // l3 has no usage metrics → usedByAssetsCount = 0
      ],
    }))

    const summary = buildUsageSummary(cards, 2)
    expect(summary.templatesInUseCount).toBe(2) // l1 and l2 have assets
    expect(summary.totalAffectedAssets).toBe(8) // 5 + 3
    expect(summary.assetsUsingCustomTemplates).toBe(8) // none are default
  })
})

// ============================================================================
// filterCards
// ============================================================================

describe('filterCards', () => {
  const cards = mapLayoutCards(makeInput({
    layouts: [
      makeLayout({ id: 'l1', name: 'Equity Deep Dive' }),
      makeLayout({ id: 'l2', name: 'Quick Screen', description: 'For rapid equity screening' }),
      makeLayout({ id: 'l3', name: 'Macro Research' }),
    ],
    usageMetrics: [
      { layout_id: 'l1', assets_using: 5, assets_with_overrides: 0 },
      { layout_id: 'l2', assets_using: 0, assets_with_overrides: 0 },
      { layout_id: 'l3', assets_using: 2, assets_with_overrides: 1 },
    ],
  }))

  it('returns all cards with default filters', () => {
    expect(filterCards(cards, DEFAULT_FILTER_STATE)).toHaveLength(3)
  })

  it('filters by search (name)', () => {
    const result = filterCards(cards, { ...DEFAULT_FILTER_STATE, search: 'deep dive' })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Equity Deep Dive')
  })

  it('filters by search (description)', () => {
    const result = filterCards(cards, { ...DEFAULT_FILTER_STATE, search: 'screening' })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Quick Screen')
  })

  it('filters by search (createdByName)', () => {
    const result = filterCards(cards, { ...DEFAULT_FILTER_STATE, search: 'john' })
    expect(result).toHaveLength(3) // all owned by John Doe
  })

  it('filters by usedByAssetsOnly', () => {
    const result = filterCards(cards, { ...DEFAULT_FILTER_STATE, usedByAssetsOnly: true })
    expect(result).toHaveLength(2)
    expect(result.map(c => c.name)).toEqual(['Equity Deep Dive', 'Macro Research'])
  })

  it('combines search + usedByAssets filter', () => {
    const result = filterCards(cards, { ...DEFAULT_FILTER_STATE, search: 'deep dive', usedByAssetsOnly: true })
    expect(result).toHaveLength(1)
  })
})

// ============================================================================
// sortCards
// ============================================================================

describe('sortCards', () => {
  it('puts system default first, then my default, then alphabetical', () => {
    const cards: LayoutTemplateCardModel[] = [
      { id: 'l2', name: 'Zebra', isMyDefault: false, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
      { id: 'l3', name: 'Alpha', isMyDefault: true, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
      { id: 'system-default', name: 'Default', isMyDefault: false, isSystemDefault: true, permission: 'owner' } as LayoutTemplateCardModel,
      { id: 'l4', name: 'Beta', isMyDefault: false, isSystemDefault: false, permission: 'view' } as LayoutTemplateCardModel,
    ]

    const sorted = sortCards(cards)
    expect(sorted.map(c => c.id)).toEqual(['system-default', 'l3', 'l2', 'l4'])
  })

  it('puts owned before shared within same category', () => {
    const cards: LayoutTemplateCardModel[] = [
      { id: 'shared', name: 'Alpha', isMyDefault: false, isSystemDefault: false, permission: 'view' } as LayoutTemplateCardModel,
      { id: 'owned', name: 'Beta', isMyDefault: false, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
    ]

    const sorted = sortCards(cards)
    expect(sorted[0].id).toBe('owned')
    expect(sorted[1].id).toBe('shared')
  })

  it('sorts by recently_updated when sortKey is recently_updated', () => {
    const cards: LayoutTemplateCardModel[] = [
      { id: 'old', name: 'Alpha', updatedAt: '2025-01-01T00:00:00Z', isMyDefault: false, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
      { id: 'new', name: 'Beta', updatedAt: '2025-06-15T00:00:00Z', isMyDefault: false, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
    ]

    const sorted = sortCards(cards, 'recently_updated')
    expect(sorted[0].id).toBe('new')
    expect(sorted[1].id).toBe('old')
  })

  it('sorts by most_used when sortKey is most_used', () => {
    const cards: LayoutTemplateCardModel[] = [
      { id: 'low', name: 'Alpha', usedByAssetsCount: 2, isMyDefault: false, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
      { id: 'high', name: 'Beta', usedByAssetsCount: 10, isMyDefault: false, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
    ]

    const sorted = sortCards(cards, 'most_used')
    expect(sorted[0].id).toBe('high')
    expect(sorted[1].id).toBe('low')
  })

  it('pinning rules override sortKey', () => {
    const cards: LayoutTemplateCardModel[] = [
      { id: 'high', name: 'Beta', usedByAssetsCount: 10, isMyDefault: false, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
      { id: 'default', name: 'Default', usedByAssetsCount: 0, isMyDefault: true, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
    ]

    const sorted = sortCards(cards, 'most_used')
    expect(sorted[0].id).toBe('default') // pinned first despite lower usage
    expect(sorted[1].id).toBe('high')
  })
})

// ============================================================================
// groupCardsByScope
// ============================================================================

describe('groupCardsByScope', () => {
  it('groups cards by scope in hierarchy order', () => {
    const cards: LayoutTemplateCardModel[] = [
      { id: 'p1', name: 'My Template', scope: 'personal', isMyDefault: false, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
      { id: 's1', name: 'Default', scope: 'system', isMyDefault: false, isSystemDefault: true, permission: 'owner' } as LayoutTemplateCardModel,
      { id: 'o1', name: 'Org Standard', scope: 'org', isMyDefault: false, isSystemDefault: false, permission: 'view' } as LayoutTemplateCardModel,
    ]

    const groups = groupCardsByScope(cards)
    expect(groups).toHaveLength(3)
    expect(groups[0].scope).toBe('system')
    expect(groups[1].scope).toBe('org')
    expect(groups[2].scope).toBe('personal')
  })

  it('omits empty groups', () => {
    const cards: LayoutTemplateCardModel[] = [
      { id: 'p1', name: 'My Template', scope: 'personal', isMyDefault: false, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
    ]

    const groups = groupCardsByScope(cards)
    expect(groups).toHaveLength(1)
    expect(groups[0].scope).toBe('personal')
  })

  it('returns empty array for no cards', () => {
    expect(groupCardsByScope([])).toHaveLength(0)
  })

  it('sorts cards within each group', () => {
    const cards: LayoutTemplateCardModel[] = [
      { id: 'p2', name: 'Zebra', scope: 'personal', isMyDefault: false, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
      { id: 'p1', name: 'Alpha', scope: 'personal', isMyDefault: true, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
      { id: 'p3', name: 'Beta', scope: 'personal', isMyDefault: false, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
    ]

    const groups = groupCardsByScope(cards)
    expect(groups[0].cards.map(c => c.name)).toEqual(['Alpha', 'Beta', 'Zebra'])
  })

  it('includes sublabels for system, org, and team groups', () => {
    const cards: LayoutTemplateCardModel[] = [
      { id: 's1', scope: 'system', isMyDefault: false, isSystemDefault: true } as LayoutTemplateCardModel,
      { id: 'o1', scope: 'org', isMyDefault: false, isSystemDefault: false } as LayoutTemplateCardModel,
      { id: 't1', scope: 'team', isMyDefault: false, isSystemDefault: false } as LayoutTemplateCardModel,
      { id: 'p1', scope: 'personal', isMyDefault: false, isSystemDefault: false } as LayoutTemplateCardModel,
    ]

    const groups = groupCardsByScope(cards)
    expect(groups[0].sublabel).toContain('Fallback')
    expect(groups[1].sublabel).toContain('org-wide')
    expect(groups[2].sublabel).toContain('team')
    expect(groups[3].sublabel).toBeNull()
  })

  it('passes sortKey through to card sorting', () => {
    const cards: LayoutTemplateCardModel[] = [
      { id: 'p1', name: 'Zebra', scope: 'personal', usedByAssetsCount: 10, isMyDefault: false, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
      { id: 'p2', name: 'Alpha', scope: 'personal', usedByAssetsCount: 2, isMyDefault: false, isSystemDefault: false, permission: 'owner' } as LayoutTemplateCardModel,
    ]

    const byName = groupCardsByScope(cards, 'name')
    expect(byName[0].cards.map(c => c.name)).toEqual(['Alpha', 'Zebra'])

    const byUsage = groupCardsByScope(cards, 'most_used')
    expect(byUsage[0].cards.map(c => c.name)).toEqual(['Zebra', 'Alpha'])
  })

  it('uses "Templates" in group labels', () => {
    const cards: LayoutTemplateCardModel[] = [
      { id: 's1', scope: 'system', isMyDefault: false, isSystemDefault: true } as LayoutTemplateCardModel,
      { id: 'o1', scope: 'org', isMyDefault: false, isSystemDefault: false } as LayoutTemplateCardModel,
      { id: 't1', scope: 'team', isMyDefault: false, isSystemDefault: false } as LayoutTemplateCardModel,
      { id: 'p1', scope: 'personal', isMyDefault: false, isSystemDefault: false } as LayoutTemplateCardModel,
    ]

    const groups = groupCardsByScope(cards)
    expect(groups[0].label).toBe('System Templates')
    expect(groups[1].label).toBe('Organization Templates')
    expect(groups[2].label).toBe('Team Templates')
    expect(groups[3].label).toBe('Personal Templates')
  })
})

// ============================================================================
// SPEC VIEW HELPERS
// ============================================================================

describe('isReadOnlyTemplate', () => {
  it('returns true for system scope', () => {
    expect(isReadOnlyTemplate('system')).toBe(true)
  })

  it('returns false for org scope', () => {
    expect(isReadOnlyTemplate('org')).toBe(false)
  })

  it('returns false for team scope', () => {
    expect(isReadOnlyTemplate('team')).toBe(false)
  })

  it('returns false for personal scope', () => {
    expect(isReadOnlyTemplate('personal')).toBe(false)
  })
})

describe('getSpecCtaLabel', () => {
  it('returns "Create Editable Copy" for system scope', () => {
    expect(getSpecCtaLabel('system')).toBe('Create Editable Copy')
  })

  it('returns "Duplicate" for non-system scopes', () => {
    expect(getSpecCtaLabel('org')).toBe('Duplicate')
    expect(getSpecCtaLabel('team')).toBe('Duplicate')
    expect(getSpecCtaLabel('personal')).toBe('Duplicate')
  })
})

describe('getSpecContextLine', () => {
  it('returns fallback explanation for system scope', () => {
    expect(getSpecContextLine('system', false)).toBe(
      'Fallback baseline when no template is selected.'
    )
  })

  it('appends default note when system is user default', () => {
    expect(getSpecContextLine('system', true)).toBe(
      'Fallback baseline when no template is selected. Currently your default.'
    )
  })

  it('returns null for non-system scopes', () => {
    expect(getSpecContextLine('org', false)).toBeNull()
    expect(getSpecContextLine('team', true)).toBeNull()
    expect(getSpecContextLine('personal', false)).toBeNull()
  })
})
