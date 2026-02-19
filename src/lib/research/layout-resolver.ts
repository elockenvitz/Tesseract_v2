/**
 * layout-resolver.ts
 *
 * Centralized, pure-function layout resolution for research templates.
 *
 * Resolution precedence (highest → lowest):
 *   1. Asset-level field/section overrides  (user_asset_layout_selections.field_overrides / section_overrides)
 *   2. Asset-level template selection        (user_asset_layout_selections.layout_id → layout.field_config)
 *   3. User's default template               (user_asset_page_layouts WHERE is_default = true)
 *   4. System default                        (is_universal fields, no template)
 *
 * When an asset has layout_id = null AND no overrides, we skip to level 3 (user default).
 * When an asset has layout_id = null WITH overrides, the overrides apply on top of user default.
 * When no user default exists, we fall back to the system default (level 4).
 */

// ============================================================================
// SYSTEM DEFAULT — curated fields visible to every new user
// ============================================================================

/**
 * Field slugs visible in the system default template.
 * When no user default or asset-level template is active, only these fields
 * are shown — grouped into the 4 system sections.
 *
 * Thesis & Risks:       business_model, thesis, where_different, risks_to_thesis
 * Forecasts & Estimates: rating, price_targets, estimates
 * Catalysts & Events:    key_catalysts
 * Supporting Documents:  documents
 */
export const SYSTEM_DEFAULT_FIELD_SLUGS = new Set([
  'business_model',
  'thesis',
  'where_different',
  'risks_to_thesis',
  'rating',
  'price_targets',
  'estimates',
  'key_catalysts',
  'documents',
])

// ============================================================================
// TYPES
// ============================================================================

export interface FieldConfigItem {
  field_id: string
  section_id: string
  is_visible: boolean
  display_order: number | null
  is_collapsed: boolean
}

export interface FieldOverride {
  field_id: string
  is_visible: boolean
  section_id?: string
  display_order?: number
}

export interface SectionOverride {
  section_id: string
  name_override?: string
  is_hidden?: boolean
  display_order?: number
  is_added?: boolean
}

export interface LayoutTemplate {
  id: string
  name: string
  field_config: FieldConfigItem[]
  is_default: boolean
}

export interface AssetLayoutSelection {
  layout_id: string | null
  layout: LayoutTemplate | null
  field_overrides: FieldOverride[] | null
  section_overrides: SectionOverride[] | null
}

export interface AvailableField {
  id: string
  name: string
  slug: string
  description: string | null
  field_type: string
  section_id: string
  is_universal: boolean
  is_system: boolean
  display_order: number
  created_by: string | null
  created_at: string | null
  research_sections: {
    id: string
    name: string
    slug: string
    display_order: number
  } | null
  creator?: { first_name: string; last_name: string } | null
  is_preset?: boolean
}

export interface SectionInfo {
  id: string
  name: string
  slug: string
  display_order: number
  is_system: boolean
}

/** The resolved state for a single field on an asset page */
export interface ResolvedField {
  field_id: string
  field_name: string
  field_slug: string
  field_description: string | null
  field_type: string
  section_id: string
  section_name: string
  section_slug: string
  default_section_id: string
  is_visible: boolean
  display_order: number | null
  default_display_order: number
  is_collapsed: boolean
  is_universal: boolean
  is_system: boolean
  is_custom: boolean
  has_custom_preference: boolean
  has_section_override: boolean
  created_by: string | null
  creator_name: string | null
  created_at: string | null
}

/** Resolution source — tells you exactly WHY a field is visible/hidden */
export type ResolutionSource =
  | 'asset-override'
  | 'template-config'
  | 'template-not-listed'
  | 'system-default'

export interface ResolutionDecision {
  field_id: string
  source: ResolutionSource
  is_visible: boolean
  template_id: string | null
  template_name: string | null
}

/** Full resolution result with diagnostics */
export interface LayoutResolutionResult {
  /** Which template is active (null = system default) */
  activeTemplate: LayoutTemplate | null
  /** Why this template was chosen */
  templateSource: 'asset-selection' | 'user-default' | 'system-default'
  /** Whether this asset has any customizations */
  hasAssetCustomization: boolean
  /** The field overrides applied for this asset */
  assetFieldOverrides: FieldOverride[]
  /** The section overrides applied for this asset */
  assetSectionOverrides: SectionOverride[]
  /** Per-field resolution decisions (for diagnostics) */
  decisions: ResolutionDecision[]
  /** The final resolved fields */
  resolvedFields: ResolvedField[]
}

// ============================================================================
// PRESET FIELD MATCHING
// ============================================================================

/**
 * Normalize a preset field ID by stripping the timestamp suffix.
 * "preset-competitive_landscape-1768168549905" → "preset-competitive_landscape"
 * "preset-competitive_landscape" → "preset-competitive_landscape" (no change)
 * "regular-uuid" → "regular-uuid" (no change)
 */
export function normalizePresetFieldId(fieldId: string): string {
  if (!fieldId.startsWith('preset-')) return fieldId

  const parts = fieldId.split('-')
  if (parts.length < 3) return fieldId

  const lastPart = parts[parts.length - 1]
  if (/^\d+$/.test(lastPart)) {
    return parts.slice(0, -1).join('-')
  }
  return fieldId
}

/**
 * Alias for normalizePresetFieldId — use at generation/persistence sites
 * to ensure preset IDs are canonical before saving to DB.
 */
export const toCanonicalPresetId = normalizePresetFieldId

/**
 * Extract slug from a preset field ID.
 * "preset-competitive_landscape-1768168549905" → "competitive_landscape"
 * "preset-competitive_landscape" → "competitive_landscape"
 */
export function extractPresetSlug(fieldId: string): string | null {
  if (!fieldId.startsWith('preset-')) return null

  const parts = fieldId.split('-')
  if (parts.length < 2) return null

  const lastPart = parts[parts.length - 1]
  const isTimestamp = /^\d+$/.test(lastPart)
  return isTimestamp ? parts.slice(1, -1).join('-') : parts.slice(1).join('-')
}

/**
 * Check if a field config entry matches a given field (by ID or slug).
 * Single canonical implementation — no more duplicated matching logic.
 */
export function fieldConfigMatchesField(
  config: { field_id: string },
  field: { id: string; slug: string }
): boolean {
  // Direct ID match
  if (config.field_id === field.id) return true

  // Normalized ID match (strips timestamps from preset IDs)
  if (normalizePresetFieldId(config.field_id) === normalizePresetFieldId(field.id)) return true

  // Slug-based match for preset fields
  if (config.field_id.startsWith('preset-') && field.slug) {
    const configSlug = extractPresetSlug(config.field_id)
    if (configSlug === field.slug) return true
  }

  return false
}

// ============================================================================
// CORE RESOLUTION
// ============================================================================

export interface ResolveLayoutInput {
  /** All available research fields */
  availableFields: AvailableField[]
  /** All research sections */
  allSections: SectionInfo[]
  /** The user's default layout template (if any) */
  userDefaultLayout: LayoutTemplate | null
  /** The asset-specific layout selection (if any, for a specific asset) */
  assetSelection: AssetLayoutSelection | null
}

/**
 * resolveLayout — Pure function that computes the final layout for a given asset.
 *
 * No side effects. No database calls. No React state. Just data in → data out.
 */
export function resolveLayout(input: ResolveLayoutInput): LayoutResolutionResult {
  const { availableFields, allSections, userDefaultLayout, assetSelection } = input

  // --- Step 1: Determine the active template ---
  let activeTemplate: LayoutTemplate | null = null
  let templateSource: 'asset-selection' | 'user-default' | 'system-default' = 'system-default'

  if (assetSelection) {
    if (assetSelection.layout_id !== null && assetSelection.layout) {
      // Asset explicitly selected a template
      activeTemplate = assetSelection.layout
      templateSource = 'asset-selection'
    } else if (assetSelection.layout_id === null) {
      // Asset explicitly set to "system default" — do NOT fall through to user default
      // But if there are only overrides (no explicit layout_id choice), use user default
      const hasExplicitLayoutChoice = assetSelection.layout_id === null
      if (hasExplicitLayoutChoice) {
        activeTemplate = null
        templateSource = 'system-default'
      }
    }
  }

  // If no asset-level template chosen and no explicit "system default" override, use user default
  if (!assetSelection || (assetSelection.layout_id === undefined)) {
    if (userDefaultLayout) {
      activeTemplate = userDefaultLayout
      templateSource = 'user-default'
    }
  }

  // Special case: assetSelection exists but layout_id is null and layout is null
  // This means the user hasn't explicitly chosen a layout for this asset yet.
  // Check if they only have overrides (no layout choice at all).
  if (assetSelection && assetSelection.layout_id === null && !assetSelection.layout) {
    // Check if this row was created just for overrides (layout_id is null)
    // In this case, fall through to user default
    const hasOnlyOverrides = (assetSelection.field_overrides?.length ?? 0) > 0 ||
                              (assetSelection.section_overrides?.length ?? 0) > 0
    if (hasOnlyOverrides && userDefaultLayout) {
      activeTemplate = userDefaultLayout
      templateSource = 'user-default'
    }
    // If no overrides and no layout_id, this is an orphan row — use system default
  }

  // --- Step 2: Gather overrides ---
  const assetFieldOverrides = assetSelection?.field_overrides || []
  const assetSectionOverrides = assetSelection?.section_overrides || []
  const hasAssetCustomization = !!(
    assetSelection?.layout_id ||
    assetFieldOverrides.length > 0 ||
    assetSectionOverrides.length > 0
  )

  // --- Step 3: Build override lookup maps ---
  const fieldOverrideMap = new Map<string, FieldOverride>()
  for (const fo of assetFieldOverrides) {
    fieldOverrideMap.set(fo.field_id, fo)
  }

  const sectionOverrideMap = new Map<string, SectionOverride>()
  for (const so of assetSectionOverrides) {
    sectionOverrideMap.set(so.section_id, so)
  }

  // Section lookup
  const sectionMap = new Map<string, SectionInfo>()
  for (const s of allSections) {
    sectionMap.set(s.id, s)
  }

  // Template field config lookup
  const isUsingCustomTemplate = activeTemplate &&
    activeTemplate.field_config &&
    activeTemplate.field_config.length > 0

  // --- Step 4: Resolve each field ---
  const decisions: ResolutionDecision[] = []
  const resolvedFields: ResolvedField[] = []

  for (const field of availableFields) {
    const defaultSection = field.research_sections
    if (!defaultSection) continue

    // Find matching override
    const assetOverride = fieldOverrideMap.get(field.id)

    // Find matching template config
    const layoutConfig = isUsingCustomTemplate
      ? activeTemplate!.field_config.find(fc => fieldConfigMatchesField(fc, field))
      : null

    // Determine section
    const overrideSectionId = assetOverride?.section_id || layoutConfig?.section_id
    let section = defaultSection
    if (overrideSectionId) {
      const overrideSection = sectionMap.get(overrideSectionId)
      if (overrideSection) {
        section = { id: overrideSection.id, name: overrideSection.name, slug: overrideSection.slug, display_order: overrideSection.display_order }
      }
    }

    // Apply section name override
    const sectionOverride = sectionOverrideMap.get(section.id)
    const sectionName = sectionOverride?.name_override || section.name

    // Determine visibility — strict precedence
    let isVisible: boolean
    let source: ResolutionSource

    if (assetOverride?.is_visible !== undefined) {
      isVisible = assetOverride.is_visible
      source = 'asset-override'
    } else if (layoutConfig) {
      isVisible = layoutConfig.is_visible
      source = 'template-config'
    } else if (isUsingCustomTemplate) {
      isVisible = false
      source = 'template-not-listed'
    } else {
      isVisible = SYSTEM_DEFAULT_FIELD_SLUGS.has(field.slug)
      source = 'system-default'
    }

    const displayOrder = assetOverride?.display_order ?? layoutConfig?.display_order ?? null
    const isCollapsed = layoutConfig?.is_collapsed ?? false

    const isCustomField = !!field.created_by
    const creator = field.creator
    const creatorName = creator ? `${creator.first_name} ${creator.last_name}`.trim() : null

    decisions.push({
      field_id: field.id,
      source,
      is_visible: isVisible,
      template_id: activeTemplate?.id || null,
      template_name: activeTemplate?.name || null
    })

    resolvedFields.push({
      field_id: field.id,
      field_name: field.name,
      field_slug: field.slug,
      field_description: field.description || null,
      field_type: field.field_type,
      section_id: section.id,
      section_name: sectionName,
      section_slug: section.slug,
      default_section_id: defaultSection.id,
      is_visible: isVisible,
      display_order: displayOrder,
      default_display_order: field.display_order ?? 0,
      is_collapsed: isCollapsed,
      is_universal: field.is_universal,
      is_system: field.is_system ?? false,
      is_custom: isCustomField,
      has_custom_preference: !!assetOverride || !!layoutConfig,
      has_section_override: !!overrideSectionId,
      created_by: field.created_by || null,
      creator_name: creatorName,
      created_at: field.created_at || null
    })
  }

  return {
    activeTemplate,
    templateSource,
    hasAssetCustomization,
    assetFieldOverrides,
    assetSectionOverrides,
    decisions,
    resolvedFields
  }
}

// ============================================================================
// DEV DIAGNOSTICS
// ============================================================================

/**
 * Log layout resolution details in development mode.
 *
 * Uses console.debug (hidden by default in Chrome DevTools — enable "Verbose" level).
 * For programmatic inspection, use window.__LAYOUT_DEBUG__ (set by useUserAssetPagePreferences).
 */
export function logResolutionDiagnostics(
  result: LayoutResolutionResult,
  context: { assetId?: string; userId?: string }
): void {
  if (process.env.NODE_ENV !== 'development') return

  const visible = result.resolvedFields.filter(f => f.is_visible)

  const sourceCounts = result.decisions.reduce((acc, d) => {
    acc[d.source] = (acc[d.source] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const fo = result.assetFieldOverrides.length
  const so = result.assetSectionOverrides.length
  const overrideSummary = (fo || so) ? ` [${fo}F/${so}S overrides]` : ''

  const templateLabel = result.activeTemplate?.name || 'System Default'
  const assetLabel = context.assetId ? context.assetId.slice(0, 8) : 'Global'

  // Single compact debug line — doesn't pollute default console
  console.debug(
    `[LayoutResolver] ${assetLabel} → ${templateLabel} (${visible.length}/${result.resolvedFields.length} visible)${overrideSummary}`,
    {
      source: result.templateSource,
      templateId: result.activeTemplate?.id || null,
      customized: result.hasAssetCustomization,
      sources: sourceCounts,
      fieldOverrides: fo > 0 ? result.assetFieldOverrides.map(o =>
        `${o.field_id.slice(0, 12)}… ${o.is_visible ? 'show' : 'hide'}${o.section_id ? ` →${o.section_id.slice(0, 8)}` : ''}`
      ) : undefined,
      sectionOverrides: so > 0 ? result.assetSectionOverrides.map(o =>
        `${o.section_id.slice(0, 8)}…${o.name_override ? ` "${o.name_override}"` : ''}${o.is_hidden ? ' (hidden)' : ''}${o.is_added ? ' (added)' : ''}`
      ) : undefined,
      visibleFields: visible.map(f => f.field_name)
    }
  )
}

/**
 * Warn about data integrity issues in development mode.
 */
export function warnDataIntegrityIssues(
  layouts: LayoutTemplate[],
  context: { userId?: string }
): void {
  if (process.env.NODE_ENV !== 'development') return

  // Check for multiple defaults
  const defaults = layouts.filter(l => l.is_default)
  if (defaults.length > 1) {
    console.warn(
      `[LayoutResolver] WARNING: User ${context.userId?.slice(0, 8)} has ${defaults.length} default layouts!`,
      defaults.map(l => ({ id: l.id, name: l.name }))
    )
  }
}
