/**
 * The research layout stack, for whatever a research page is a page OF.
 *
 * Manages one user's research field layout for one subject: show/hide a
 * field, reorder it, set its width, move it between sections, and save all of
 * that as a named template.
 *
 * ── Why this takes a subject ──────────────────────────────────────────────
 *
 * It was written against assets, spelled out in string literals:
 * `from('user_asset_layout_selections')`, `.eq(S.subjectColumn, assetId)`,
 * `['user-asset-layout-selection', ...]`. The Theme page needs the same
 * stack against its own tables, and the alternative was a second copy of
 * ~2500 lines kept in sync by hand.
 *
 * So the differences are named once, in `src/lib/research/subject.ts`, and
 * passed in. Every type involved -- `SavedLayout`, `FieldConfigItem`,
 * `FieldOverride`, `SectionOverride`, `FieldWithPreference` -- already
 * mentions no subject, and `layout-resolver.ts` is already pure, so the only
 * thing that differed was which rows the queries read.
 *
 * `useUserAssetPagePreferences(assetId)` and `useUserAssetPageLayouts()`
 * remain, as thin wrappers passing the asset subject, so no asset call site
 * changed.
 *
 * ── The query-key rule, which is load bearing ─────────────────────────────
 *
 * Every key goes through `subjectQueryKey`, so every key starts with its
 * subject's prefix. An asset id and a theme id are both uuids: an unprefixed
 * `['layout-selection', id]` would let one subject's cached row answer the
 * other's query. The keys are built ONCE below, in `K`, because this file
 * does 61 cache operations against 10 of them and `setQueryData` needs an
 * exact match -- an inline key written by hand at site 54 is how an
 * optimistic update ends up writing to a cache entry nothing reads.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import {
  resolveLayout,
  logResolutionDiagnostics,
  warnDataIntegrityIssues,
  fieldConfigMatchesField,
  overrideDiffersFromBaseline,
  sectionOverrideSaysSomething,
  reorderedSectionOverrides,
  catalogFieldOrder,
  /* `SYSTEM_DEFAULT_FIELD_SLUGS` is gone from here: default-template
     membership is `S.isInSystemDefault`, which the asset descriptor
     answers with that same set and the theme descriptor does not. */
  type ResolveLayoutInput,
  type LayoutResolutionResult,
  type FieldWidth,
  type FieldSpan
} from '../lib/research/layout-resolver'
import {
  assetSubject,
  subjectQueryKey,
  type ResearchSubject,
} from '../lib/research/subject'

// Types
export interface SavedLayout {
  id: string
  user_id: string
  name: string
  description: string | null
  is_default: boolean
  field_config: FieldConfigItem[]
  /**
   * The template's sections: renames, order, hidden flags, added sections.
   * Null on every layout saved before the column existed, which reads the
   * same as "this template says nothing about sections".
   */
  section_config?: SectionOverride[] | null
  created_at: string
  updated_at: string
}

export interface FieldConfigItem {
  field_id: string
  section_id: string
  is_visible: boolean
  display_order: number | null
  is_collapsed: boolean
  /**
   * Twelfths of a row. Absent on layouts saved before spans existed, and
   * typed `number` rather than `FieldSpan` on purpose: this is jsonb
   * written by several versions of this app, so what arrives is whatever
   * was stored. `asSpan` in the resolver is what narrows it.
   */
  span?: number
  /**
   * Superseded by `span` and never written again. Still declared because
   * `field_config` is jsonb that older versions of this app wrote, and
   * the resolver reads this as a fallback so those layouts draw unchanged.
   */
  width?: FieldWidth
}

export interface FieldOverride {
  field_id: string
  is_visible: boolean
  section_id?: string // Override the field's default section
  display_order?: number // Override the field's display order within its section
  /** Twelfths of a row this field is drawn at on this asset. `number`
   *  for the same reason as FieldConfigItem.span — it round trips jsonb. */
  span?: number
  /** Superseded by `span`; read, never written. See FieldConfigItem. */
  width?: FieldWidth
}

export interface SectionOverride {
  section_id: string
  name_override?: string
  is_hidden?: boolean
  display_order?: number
  is_added?: boolean // true if section was added as an override for this asset
}

export interface FieldWithPreference {
  field_id: string
  field_name: string
  field_slug: string
  field_description: string | null
  field_type: string
  section_id: string
  section_name: string
  section_slug: string
  default_section_id: string // Original section before any overrides
  is_visible: boolean
  display_order: number | null  // User's custom display order (from layout)
  default_display_order: number // Default display order (from research_fields table)
  is_collapsed: boolean
  /**
   * How wide the field is drawn, in twelfths of a row: 12 is its own row,
   * 6 is half, 4 a third. Comes straight from the resolver, which reads it
   * out of the saved layout's `field_config` jsonb, falls back to a legacy
   * `width` of 'half'/'full', and defaults to a full row.
   */
  span: FieldSpan
  is_universal: boolean
  is_system: boolean  // true if this is a system field (included in default template)
  is_custom: boolean  // true if created by a user, false if standard field
  has_custom_preference: boolean
  has_section_override: boolean // true if field was moved to a different section
  created_by: string | null
  creator_name: string | null
  created_at: string | null
}

/**
 * Every React Query key this stack uses, for one subject.
 *
 * Built in one place for two reasons. The obvious one is that nothing can
 * then be written without its subject prefix. The less obvious one is
 * `setQueryData`, which matches a key EXACTLY where `invalidateQueries`
 * matches by prefix: this file does 61 cache operations, and an inline key
 * that differs from the query's by one element reads as an optimistic update
 * and behaves as a write to a cache entry nothing reads.
 *
 * `sectionsScoped` and `sections` are deliberately two entries, not one.
 * `sectionsScoped` is what the sections query is keyed by (it carries the
 * org, so switching organisation refetches). `sections` is the prefix the
 * invalidations use, which matches it. They are kept separate here rather
 * than collapsed, because collapsing them would silently CHANGE behaviour
 * at the three `setQueryData` sites that use the short form -- see the note
 * on those.
 */
export function researchLayoutKeys(
  subject: ResearchSubject,
  userId: string | undefined,
  orgId: string | null | undefined,
) {
  /*
   * Two shapes, and the difference matters.
   *
   * `subjectQueryKey` puts the subject's ID in the key, which is right for
   * the ONE row that is per-subject: the layout selection. Everything else
   * here is library-level or user-level -- the section catalogue, the field
   * catalogue, the user's templates, their default template -- and pinning a
   * subject id onto those would give every asset its own cache entry for the
   * same row, so opening ten assets would fetch the same template list ten
   * times.
   *
   * So the library keys carry the subject's PREFIX and not its id. They are
   * still per-subject in the sense that matters, because an asset's section
   * catalogue and a theme's are different tables.
   */
  const lib = (name: string, ...rest: readonly unknown[]) =>
    [subject.descriptor.queryKeyPrefix, name, userId, ...rest] as const

  return {
    selection: subjectQueryKey(subject, 'layout-selection', userId),
    defaultLayout: lib('default-layout'),
    sectionsScoped: lib('sections', orgId),
    sections: lib('sections'),
    fieldsVersioned: lib('fields', 'v6'),
    fields: lib('fields'),
    layouts: lib('layouts'),
    usageMetrics: lib('layout-usage-metrics'),
    collabSummaries: lib('layout-collab-summaries'),
  } as const
}

/**
 * The same keys, truncated to the part a prefix match needs.
 *
 * `invalidateQueries` matches by prefix, so a caller outside this file that
 * only wants to say "the field catalogue changed" does not need the user id,
 * and must not guess at it. `researchLayoutKeys` would put `undefined` in
 * that slot, and `[p, 'fields', undefined]` is not a prefix of
 * `[p, 'fields', 'abc']` -- it is a sibling that matches nothing.
 *
 * This exists because the keys used to be bare literals that outside callers
 * wrote by hand. Those calls kept working by accident while the key names
 * happened to agree, and stopped matching silently the moment the prefix was
 * added. Never for `setQueryData`, which needs an exact key.
 */
export function researchLayoutKeyPrefixes(subject: ResearchSubject) {
  const p = subject.descriptor.queryKeyPrefix
  return {
    selection: [p, 'layout-selection'],
    defaultLayout: [p, 'default-layout'],
    sections: [p, 'sections'],
    fields: [p, 'fields'],
    layouts: [p, 'layouts'],
  } as const
}

/**
 * The asset-shaped entry point, unchanged for every existing caller.
 *
 * `assetId` is still the whole signature; the subject is supplied here so no
 * asset call site had to learn about subjects.
 */
export function useUserAssetPagePreferences(assetId?: string) {
  return useResearchPagePreferences(assetSubject(assetId))
}

export function useResearchPagePreferences(subject: ResearchSubject) {
  const S = subject.descriptor
  /*
   * ── What the type system is and is not doing here ───────────────────────
   *
   * Passing `S.tables.selections` to `.from()` gives it a UNION of two table
   * names, which supabase-js would normally resolve to the intersection of
   * two row types, i.e. `never`. That is not what happens in this repo,
   * because `src/types/database.ts` contains NEITHER table: these rows were
   * already untyped before this change, and the ~40 "does not exist on type
   * 'never'" errors this file reports are the same ~40 it reported at HEAD.
   * So the union costs nothing here, and a cast to one literal would buy
   * nothing either -- that was tried and reverted.
   *
   * It also means TypeScript is not checking the claim the two descriptors
   * make, that these table pairs are column-compatible for everything this
   * file touches. The claim was verified against `information_schema` when
   * `subject.ts` was written, and `subject-table-parity.test.ts` re-checks
   * the names. Nothing checks the COLUMNS. Treat that as the live risk in
   * this file.
   *
   * TWO differences that are real and are handled:
   *   - `user_theme_layout_selections.field_overrides` and
   *     `section_overrides` are NOT NULL DEFAULT '[]' where the asset
   *     columns are nullable. Nothing here writes NULL to them; the RPC
   *     writes '[]'.
   *   - the theme table carries
   *     CHECK (layout_id IS NOT NULL OR field_overrides <> '[]' OR
   *            section_overrides <> '[]')
   *     and the asset table has no such constraint, so a direct write that
   *     empties a theme selection raises 23514 where the asset one would
   *     store an empty row. The RPC deletes in that case instead. The direct
   *     writes below always set at least one override, so they do not reach
   *     it -- but a new direct write that can empty a selection must go
   *     through `saveCustomization`, not the table.
   */
  /*
   * `assetId` keeps its name through the body of this function.
   *
   * It is the subject's id, whatever the subject is, and renaming it at ~90
   * sites would have made the diff unreadable without changing a single
   * thing about what the code does. The queries below name the column
   * through `S.subjectColumn`, which is the part that actually differs.
   */
  const assetId = subject.id

  const { user } = useAuth()
  /*
   * The org comes from the app's current-org context, not from a membership
   * lookup.
   *
   * Three queries in this file resolved it by selecting the user's active
   * `organization_memberships` row with `.single()`. `.single()` is a promise
   * that exactly one row exists, and a user may belong to more than one
   * organisation — this account belongs to two. PostgREST answered 406
   * `PGRST116: The result contains 2 rows`, the destructured `orgMembership`
   * came back undefined, and `if (!orgMembership) return []` handed the
   * research surface an empty section list.
   *
   * So a multi-org user saw an asset page with no research sections at all,
   * and the only trace was a 406 in the network panel. Observed on the
   * running app: four of them per asset open.
   *
   * `currentOrgId` is the answer the rest of the product already uses, and it
   * is the right answer rather than merely a working one — the user's org is
   * whichever one they have switched to, which a membership query cannot know.
   */
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  /* Every key this file reads or writes, built once. See the header note. */
  const K = researchLayoutKeys(subject, user?.id, currentOrgId)

  // Fetch user's default layout
  const { data: defaultLayout, isLoading: layoutLoading } = useQuery({
    queryKey: K.defaultLayout,
    queryFn: async () => {
      if (!user?.id) return null

      const { data, error } = await supabase
        .from(S.tables.layouts)
        .select('*')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .maybeSingle()

      if (error) throw error
      return data as SavedLayout | null
    },
    enabled: !!user?.id
  })

  // Fetch asset-specific layout selection (if any)
  const { data: assetLayoutSelection, isLoading: assetLayoutLoading } = useQuery({
    queryKey: K.selection,
    queryFn: async () => {
      if (!user?.id || !assetId) return null

      // Use explicit foreign key reference for the join
      const { data, error } = await supabase
        .from(S.tables.selections)
        .select(`*, ${S.embeds.selectionLayout}`)
        .eq('user_id', user.id)
        .eq(S.subjectColumn, assetId)
        .maybeSingle()

      if (error) {
        console.error('Error fetching asset layout selection:', error)
        throw error
      }

      // Defensive: if layout_id is set but the join returned no layout,
      // the referenced template was deleted (FK cascade set it to NULL in DB,
      // but our cached row might still have it). Treat as no template.
      if (data && data.layout_id && !data.layout) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            `[LayoutResolver] Asset ${assetId} references layout ${data.layout_id} which no longer exists. Falling back to default.`
          )
        }
        data.layout_id = null
      }

      return data as {
        layout_id: string | null
        layout: SavedLayout | null
        field_overrides: FieldOverride[] | null
        section_overrides: SectionOverride[] | null
        version: number
      } | null
    },
    enabled: !!user?.id && !!assetId,
    staleTime: 0, // Always refetch to ensure fresh data
    refetchOnMount: 'always'
  })

  // NOTE: Legacy table `user_asset_page_preferences` has 0 rows and is no longer queried.
  // The table still exists in the database for Phase C drop.
  if (process.env.NODE_ENV === 'development') {
    // One-time dev warning on first render (closure captures this)
  }

  // Fetch all sections (including empty ones)
  const { data: allSections, isLoading: sectionsLoading } = useQuery({
    // Keyed on the org, so switching organisation refetches rather than
    // showing the previous org's sections.
    queryKey: K.sectionsScoped,
    queryFn: async () => {
      if (!user?.id || !currentOrgId) return []

      const { data: sections, error } = await supabase
        .from(S.tables.sections)
        .select('id, name, slug, display_order, is_system')
        .eq('organization_id', currentOrgId)
        /*
         * `created_at` is the tiebreak, not a second opinion on order.
         *
         * `display_order` is not unique here: this org has "Blue Ska Doo" and
         * "Thesis & Risks" both at 0, so ordering by display_order alone left
         * Postgres to pick, and section order could change between runs.
         * Creation order is the right tiebreak — a section added later sorts
         * after the seeded ones, which is what a reader expects. Sorting by
         * name instead would float a newly named section above the standards.
         */
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true })

      if (error) throw error
      return sections || []
    },
    enabled: !!user?.id && !!currentOrgId,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always'
  })

  // Fetch all available fields with their sections
  const { data: availableFields, isLoading: fieldsLoading } = useQuery({
    queryKey: K.fieldsVersioned, // v6 - include preset fields
    queryFn: async () => {
      if (!user?.id) return []

      // Get all fields the user has access to
      const { data: fields, error } = await supabase
        .from(S.tables.fields)
        .select(`
          id,
          name,
          slug,
          description,
          field_type,
          section_id,
          is_universal,
          is_system,
          display_order,
          created_by,
          created_at,
          ${S.embeds.fieldSection} (
            id,
            name,
            slug,
            display_order
          )
        `)
        .eq('is_archived', false)
        .order('display_order', { ascending: true })

      if (error) throw error

      /*
       * There is no preset-field library, so this no longer asks for one.
       *
       * A query here selected from `research_field_presets` and logged any
       * error to the console. The table has never existed: no migration in
       * the repository creates it, and the running app answers
       * `404 / 42P01 relation "public.research_field_presets" does not
       * exist` — three times per asset open, because this query is
       * `gcTime: 0, refetchOnMount: 'always'`.
       *
       * The error was caught and `presets || []` fell through, so nothing
       * broke; the cost was a failing request on every open and a feature
       * that silently contributed zero fields. Removed rather than created:
       * inventing the table would be adding speculative schema for a library
       * nobody has authored, and the field catalogue it was meant to
       * supplement (`research_fields` above) already works.
       */

      /*
       * The all-sections read went with the presets.
       *
       * Its only purpose was mapping a preset's `suggested_section` slug to a
       * real section. `research_fields` above already embeds its own
       * `research_sections!inner`, so a field arrives with its section
       * attached and this second, unfiltered read of every section in the
       * database answered a question nobody now asks.
       */

      // Fetch creator names for custom fields
      const creatorIds = [...new Set(fields?.filter(f => f.created_by).map(f => f.created_by))]
      let creatorsMap: Record<string, { first_name: string; last_name: string }> = {}

      if (creatorIds.length > 0) {
        const { data: creators } = await supabase
          .from('users')
          .select('id, first_name, last_name')
          .in('id', creatorIds)

        if (creators) {
          creatorsMap = creators.reduce((acc, c) => {
            acc[c.id] = { first_name: c.first_name || '', last_name: c.last_name || '' }
            return acc
          }, {} as Record<string, { first_name: string; last_name: string }>)
        }
      }

      // The field list is `research_fields`, which is the only catalogue
      // that exists. See the note above where the preset query was removed.

      /*
       * Section-major order, made deterministic.
       *
       * The `.order('display_order')` above sorts on the FIELD's own
       * display_order, which is only meaningful WITHIN a section. Across
       * sections it interleaves them — and it TIES: in this database the
       * first field of Thesis & Risks (business_model), Catalysts & Events
       * (key_catalysts) and Forecasts & Estimates (rating) all carry
       * display_order 0, and Postgres returns tied rows in whatever order it
       * likes, which can differ between runs.
       *
       * Arrival order is not cosmetic downstream. `buildSystemDefaultLayout`
       * stamps `display_order: idx` straight off this list, and the template
       * editor then groups sections by first appearance. So a tie decided one
       * way made the Default template list Forecasts & Estimates above
       * Thesis & Risks, while the asset page — which sorts by the SECTION's
       * display_order — listed them the other way round. Same data, two
       * orders, neither chosen by anyone.
       *
       * `catalogFieldOrder` is that sort, kept in layout-resolver so it can be
       * tested on its own rather than only through a Supabase read.
       */
      const sectionOrderOf = (f: unknown): number => {
        const embed = (f as { research_sections?: unknown }).research_sections
        const section = Array.isArray(embed) ? embed[0] : embed
        const order = (section as { display_order?: unknown } | undefined)?.display_order
        return typeof order === 'number' ? order : 0
      }

      return (fields || [])
        .map(field => ({
          ...field,
          creator: field.created_by ? creatorsMap[field.created_by] || null : null
        }))
        .sort((a, b) =>
          catalogFieldOrder(
            { section_display_order: sectionOrderOf(a), display_order: a.display_order, name: a.name },
            { section_display_order: sectionOrderOf(b), display_order: b.display_order, name: b.name },
          )
        )
    },
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0, // Don't cache - always fetch fresh data
    refetchOnMount: 'always'
  })

  // ========================================================================
  // CENTRALIZED LAYOUT RESOLUTION (via layout-resolver.ts)
  // ========================================================================
  // Precedence:
  //   1. Asset-level field/section overrides
  //   2. Asset-level template selection
  //   3. User's default template
  //   4. System default (is_universal fields)

  // Build the resolver input from query data
  const resolverInput: ResolveLayoutInput | null =
    availableFields && allSections
      ? {
          /* The subject decides what is on the page by default. Without
             this the resolver falls back to the curated ASSET slugs, and a
             theme loses every field whose slug the asset list spells
             differently -- which hid "Risks to Thesis" (`risks` against
             `risks_to_thesis`) on every theme page. */
          isInSystemDefault: S.isInSystemDefault,
          availableFields: (availableFields || []).map(field => ({
            id: field.id,
            name: field.name,
            slug: field.slug,
            description: (field as any).description || null,
            field_type: field.field_type,
            section_id: field.section_id,
            is_universal: field.is_universal,
            is_system: (field as any).is_system ?? false,
            display_order: (field as any).display_order ?? 0,
            created_by: (field as any).created_by || null,
            created_at: (field as any).created_at || null,
            research_sections: field.research_sections as any,
            creator: (field as any).creator || null,
            is_preset: (field as any).is_preset
          })),
          allSections: (allSections || []).map(s => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
            display_order: s.display_order,
            is_system: s.is_system
          })),
          /* section_config travels with every template here. Omitting it
             at any one of these mapping sites would make a template's
             section names appear on some code paths and not others. */
          userDefaultLayout: defaultLayout
            ? { id: defaultLayout.id, name: defaultLayout.name, field_config: defaultLayout.field_config, section_config: defaultLayout.section_config ?? null, updated_at: defaultLayout.updated_at, is_default: defaultLayout.is_default }
            : null,
          assetSelection: assetLayoutSelection
            ? {
                layout_id: assetLayoutSelection.layout_id,
                layout: assetLayoutSelection.layout
                  ? { id: assetLayoutSelection.layout.id, name: assetLayoutSelection.layout.name, field_config: assetLayoutSelection.layout.field_config, section_config: assetLayoutSelection.layout.section_config ?? null, updated_at: assetLayoutSelection.layout.updated_at, is_default: assetLayoutSelection.layout.is_default }
                  : null,
                field_overrides: assetLayoutSelection.field_overrides || null,
                section_overrides: assetLayoutSelection.section_overrides || null
              }
            : null
        }
      : null

  // Run the pure resolver
  const resolution: LayoutResolutionResult | null = resolverInput ? resolveLayout(resolverInput) : null

  /**
   * The same page WITHOUT this asset's own overrides — what the template
   * alone would draw.
   *
   * Produced by running the real resolver a second time with the override
   * arrays emptied, rather than by re-deriving "what the template says"
   * by hand. A hand-written copy would be a second implementation of the
   * four-source span fallback and the visibility defaults, and the moment
   * the two disagreed this would start pruning real settings away as if
   * they were no-ops — deleting a reader's layout instead of tidying it.
   *
   * `layout_id` is deliberately KEPT. Following a non-default template is
   * a separate choice from overriding one, and stripping it would make
   * every stock on a chosen template look permanently "customized".
   */
  const baselineResolution: LayoutResolutionResult | null = resolverInput
    ? resolveLayout({
        ...resolverInput,
        assetSelection: resolverInput.assetSelection
          ? { ...resolverInput.assetSelection, field_overrides: null, section_overrides: null }
          : null,
      })
    : null

  /** field_id → what the template alone would give it. */
  const templateBaselineFields = new Map(
    (baselineResolution?.resolvedFields ?? []).map(f => [
      f.field_id,
      { span: f.span, is_visible: f.is_visible, section_id: f.section_id, display_order: f.display_order },
    ]),
  )

  // Dev diagnostics — expose on window for programmatic inspection + compact console.debug
  const prevResolutionRef = useRef<string | null>(null)
  useEffect(() => {
    if (!resolution) return
    const key = `${resolution.templateSource}:${resolution.activeTemplate?.id}:${resolution.hasAssetCustomization}:${resolution.resolvedFields.filter(f => f.is_visible).length}`
    if (key !== prevResolutionRef.current) {
      prevResolutionRef.current = key
      logResolutionDiagnostics(resolution, { assetId, userId: user?.id })
      // G4: Expose resolution on window for dev tools / React DevTools inspection
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
        ;(window as any).__LAYOUT_DEBUG__ = {
          assetId,
          resolution,
          version: assetLayoutSelection?.version ?? null,
          timestamp: new Date().toISOString()
        }
      }
    }
  }, [resolution, assetId, user?.id, assetLayoutSelection?.version])

  // Extract results from resolution
  const activeLayout = resolution?.activeTemplate
    /* `updated_at` is NOT stubbed out. It used to be `''`, which made the
       optimistic-concurrency check on template writes skip itself: the
       guard read a falsy token and quietly did not apply. The save then
       overwrote a template another tab had changed, with no error — the
       exact failure the guard exists to prevent. */
    ? { ...resolution.activeTemplate, user_id: '', description: null, created_at: '', updated_at: resolution.activeTemplate.updated_at ?? '' } as SavedLayout
    : defaultLayout

  const assetFieldOverrides = resolution?.assetFieldOverrides || []
  /**
   * What this ASSET stores, unmerged — the array a save must hand back,
   * because the RPC replaces whatever it is given.
   */
  const assetSectionOverrides: SectionOverride[] = resolution?.assetSectionOverrides || []
  /**
   * What each section RESOLVES to: the template's `section_config` with
   * this asset's overrides merged over it, per key. Everything that
   * renders a section name, order or hidden flag reads this one — reading
   * the asset's own array showed a section's original name whenever the
   * rename lived on the template rather than on the asset.
   */
  const resolvedSectionOverrides: SectionOverride[] = resolution?.resolvedSectionOverrides || []
  const hasAssetCustomization = resolution?.hasAssetCustomization || false

  /**
   * Does this stock's page actually DIFFER from the template it follows?
   *
   * `hasAssetCustomization` answers a narrower question — "is there an
   * override row with anything in it" — and that is the right question
   * for a save, which has to write the row either way. It is the wrong
   * question for a label. Stocks arranged before no-op overrides were
   * pruned still carry rows that repeat what the template already says,
   * and calling those "Custom layout" would put a warning and a Reset
   * button on a page that is drawing its template exactly.
   *
   * Following a chosen template is NOT a difference, which is why
   * `layout_id` is absent here while being present in the baseline: a
   * stock on a named template is following it, not overriding it.
   */
  const overridesTemplate =
    assetSectionOverrides.length > 0 ||
    assetFieldOverrides.some(o =>
      overrideDiffersFromBaseline(o, templateBaselineFields.get(o.field_id)),
    )

  /** Does the TEMPLATE hide this section? Needed to tell an override that
   *  un-hides it (a real instruction) from one that repeats the template. */
  const templateHidesSection = (sectionId: string): boolean =>
    !!(activeLayout?.section_config ?? []).find(o => o.section_id === sectionId)?.is_hidden

  /**
   * Where a section would sit with no per-asset override: the template's
   * position for it, else the section's own `display_order`.
   *
   * Used to recognise an order that is already the baseline, so putting a
   * section back where it started clears the override instead of pinning
   * every section's position for this stock forever.
   */
  const sectionBaselineOrder = (sectionId: string): number | null => {
    const fromTemplate = (activeLayout?.section_config ?? [])
      .find(o => o.section_id === sectionId)?.display_order
    if (typeof fromTemplate === 'number') return fromTemplate
    const catalog = (allSections ?? []) as unknown as Array<{ id: string; display_order: number }>
    const s = catalog.find(x => x.id === sectionId)
    return typeof s?.display_order === 'number' ? s.display_order : null
  }

  // Map resolved fields to FieldWithPreference (preserving existing interface)
  const fieldsWithPreferences: FieldWithPreference[] = resolution?.resolvedFields || []

  // Group fields by section, including section display order for sorting
  const fieldsBySectionMap = fieldsWithPreferences.reduce((acc, field) => {
    const section = (availableFields || []).find(f => f.id === field.field_id)?.research_sections as any
    const sectionDisplayOrder = section?.display_order ?? 999

    // What this section resolves to: template section_config, then this asset's
    const sectionOverride = resolvedSectionOverrides.find(o => o.section_id === field.section_id)

    if (!acc[field.section_id]) {
      acc[field.section_id] = {
        section_id: field.section_id,
        section_name: sectionOverride?.name_override || field.section_name,
        section_slug: field.section_slug,
        section_display_order: sectionOverride?.display_order ?? sectionDisplayOrder,
        section_is_hidden: sectionOverride?.is_hidden ?? false,
        section_is_added: sectionOverride?.is_added ?? false,
        section_original_name: field.section_name,
        section_has_override: !!sectionOverride,
        fields: []
      }
    }
    acc[field.section_id].fields.push(field)
    return acc
  }, {} as Record<string, {
    section_id: string
    section_name: string
    section_slug: string
    section_display_order: number
    section_is_hidden: boolean
    section_is_added: boolean
    section_original_name: string
    section_has_override: boolean
    fields: FieldWithPreference[]
  }>)

  // Add empty sections from allSections that aren't already in fieldsBySectionMap
  // Only add if: is a custom section (not system) OR has is_added override for this asset
  if (allSections) {
    for (const section of allSections) {
      if (!fieldsBySectionMap[section.id]) {
        const sectionOverride = resolvedSectionOverrides.find(o => o.section_id === section.id)
        const isCustomSection = section.is_system === false
        const isAddedForAsset = sectionOverride?.is_added === true

        // Only add if custom section or added as override for this asset
        if (isCustomSection || isAddedForAsset) {
          fieldsBySectionMap[section.id] = {
            section_id: section.id,
            section_name: sectionOverride?.name_override || section.name,
            section_slug: section.slug,
            section_display_order: sectionOverride?.display_order ?? section.display_order,
            section_is_hidden: sectionOverride?.is_hidden ?? false,
            section_is_added: sectionOverride?.is_added ?? false,
            section_original_name: section.name,
            section_has_override: !!sectionOverride,
            fields: []
          }
        }
      }
    }
  }

  // Sort sections by display_order and fields within each section by their display_order
  // Field sorting: use override display_order if available, otherwise fall back to default_display_order
  const fieldsBySection = Object.values(fieldsBySectionMap)
    .sort((a, b) => a.section_display_order - b.section_display_order)
    .map(section => ({
      ...section,
      fields: section.fields.sort((a, b) => {
        const aOrder = a.display_order ?? a.default_display_order
        const bOrder = b.display_order ?? b.default_display_order
        return aOrder - bOrder
      })
    }))

  // Compute displayed sections - filtered to only show sections relevant to the current template/overrides
  // This is what should be used for rendering on the asset page
  const isUsingCustomTemplate = activeLayout && activeLayout.field_config && activeLayout.field_config.length > 0
  const templateFieldConfig = activeLayout?.field_config || []
  const overrideAddedFieldIds = new Set(
    assetFieldOverrides.filter(o => o.is_visible).map(o => o.field_id)
  )

  // Helper to check if a field is in the template (uses centralized matching)
  const isFieldInTemplate = (fieldId: string, fieldSlug: string): boolean => {
    return templateFieldConfig.some(fc =>
      fieldConfigMatchesField(fc, { id: fieldId, slug: fieldSlug })
    )
  }

  const displayedFieldsBySection = fieldsBySection
    .map(section => ({
      ...section,
      fields: section.fields
        .map(field => {
          const inTemplate = isFieldInTemplate(field.field_id, field.field_slug)
          return {
            ...field,
            isFromTemplate: inTemplate,
            isAddedViaOverride: overrideAddedFieldIds.has(field.field_id) && !inTemplate
          }
        })
        // Filter fields based on whether we're using a custom template
        // - Custom template: only show fields from template or added via override
        // - Default template: show all fields (visibility controlled by is_visible)
        .filter(field => {
          if (isUsingCustomTemplate) {
            return field.isFromTemplate || field.isAddedViaOverride
          }
          // Default template - show all fields, visibility handled by is_visible filter in renderer
          return true
        })
        .sort((a, b) => {
          // Sort by display_order if available, otherwise by default_display_order
          const aOrder = a.display_order ?? a.default_display_order
          const bOrder = b.display_order ?? b.default_display_order
          return aOrder - bOrder
        })
    }))
    .filter(section => {
      // Show section if:
      // 1. Using default template and section has visible fields
      // 2. Using custom template and has template fields or override fields
      // 3. It was explicitly added as a section override
      if (!isUsingCustomTemplate) {
        return section.fields.some(f => f.is_visible)
      }
      const hasTemplateFields = section.fields.some(f => f.isFromTemplate && f.is_visible)
      const hasOverrideFields = section.fields.some(f => f.isAddedViaOverride && f.is_visible)
      return hasTemplateFields || hasOverrideFields || section.section_is_added
    })

  /**
   * The same sections, plus the ones nothing is currently in.
   *
   * The list above drops a section once it has no visible fields, which is
   * right for reading: an empty heading is noise. It is wrong for
   * ARRANGING, because a section you cannot see is a section you cannot
   * drag a field into — so moving the last field out of one made the move
   * permanent, with nowhere to put it back.
   *
   * Kept as a second list rather than by loosening the filter above, so
   * the page a reader reads is unchanged.
   */
  const sectionsForArranging = (() => {
    const present = new Set(displayedFieldsBySection.map(s => s.section_id))
    /*
     * `allSections` infers as `never[]` here — the generated Supabase
     * types do not reach this query, a pre-existing condition shared by
     * most of this file. Naming the shape locally keeps that problem from
     * spreading into new code rather than adding to the repo's error
     * count; the fields read below are the ones the select asks for.
     */
    const catalog = (allSections ?? []) as unknown as Array<{
      id: string
      name: string
      slug: string
      display_order: number
      is_system: boolean
    }>
    /*
     * Which sections may come BACK, and which were never here.
     *
     * The rule used to be "every section in the catalog that is not
     * already on the page", which re-admitted everything the layout had
     * deliberately left out. On the system default — eight visible
     * fields across three sections — arranging showed five: Key
     * References, whose fields the default does not place, and an empty
     * custom section nobody had added to this stock. The reader saw the
     * layout editor disagree with both the page and the template.
     *
     * A section earns a place here only if:
     *
     *  - this stock explicitly ADDED it, or
     *  - the active layout, or this stock's own overrides, say something
     *    about one of its fields.
     *
     * The second clause is what keeps the bug this list was built for
     * fixed. Hiding the last field in a section writes a `field_override`
     * for that field, so the section still qualifies and can be dragged
     * back into — while a section the layout has simply never mentioned
     * stays out, which is what the page and the template already say.
     */
    const layoutAddressesField = (f: FieldWithPreference) =>
      isFieldInTemplate(f.field_id, f.field_slug) ||
      assetFieldOverrides.some(o => o.field_id === f.field_id)

    const empties = catalog
      .filter(s => !present.has(s.id))
      .filter(s => {
        if (resolvedSectionOverrides.find(ov => ov.section_id === s.id)?.is_added) return true
        return fieldsWithPreferences.some(f => f.section_id === s.id && layoutAddressesField(f))
      })
      .map(s => {
        const o = resolvedSectionOverrides.find(ov => ov.section_id === s.id)
        return {
          section_id: s.id,
          section_name: o?.name_override || s.name,
          section_slug: s.slug,
          section_display_order: o?.display_order ?? s.display_order,
          section_is_hidden: o?.is_hidden ?? false,
          section_is_added: o?.is_added ?? false,
          section_original_name: s.name,
          section_has_override: !!o,
          fields: [] as typeof displayedFieldsBySection[number]['fields'],
        }
      })
    return [...displayedFieldsBySection, ...empties]
      .sort((a, b) => a.section_display_order - b.section_display_order)
  })()

  /*
   * Toggle field visibility for one subject (creates a per-subject override).
   *
   * The parameter is `subjectId`, not `assetId`: this writes
   * `S.tables.selections` keyed on `S.subjectColumn`, so on a theme page the
   * value is a theme id. It was `assetId` while the hook was asset-only, and
   * a parameter naming the wrong kind of thing is how a caller comes to
   * believe it is passing an asset.
   */
  const toggleAssetFieldVisibility = useMutation({
    mutationFn: async ({ subjectId: targetAssetId, fieldId }: { subjectId: string; fieldId: string }) => {
      if (!user?.id) throw new Error('Not authenticated')

      const field = fieldsWithPreferences.find(f => f.field_id === fieldId)
      if (!field) throw new Error('Field not found')

      const newVisibility = !field.is_visible

      // Determine what the template default visibility would be for this field
      const isUsingCustomTemplate = activeLayout && activeLayout.field_config && activeLayout.field_config.length > 0
      const layoutConfig = activeLayout?.field_config?.find(fc => fc.field_id === fieldId)
      let templateDefaultVisibility: boolean
      if (layoutConfig) {
        templateDefaultVisibility = layoutConfig.is_visible
      } else if (isUsingCustomTemplate) {
        templateDefaultVisibility = false // Not in custom template = hidden
      } else {
        /* Same per-subject answer the resolver uses. Reading the asset set
           here would make this disagree with the page it is comparing
           against, and the comparison decides whether an override is
           WRITTEN or dropped as a no-op. */
        templateDefaultVisibility = S.isInSystemDefault({
          slug: field.field_slug,
          is_system: field.is_system,
        })
      }

      // Check if the new visibility matches the template default
      const matchesTemplateDefault = newVisibility === templateDefaultVisibility

      // Get existing selection
      const { data: existing } = await supabase
        .from(S.tables.selections)
        .select('*')
        .eq('user_id', user.id)
        .eq(S.subjectColumn, targetAssetId)
        .maybeSingle()

      if (existing) {
        const currentOverrides: FieldOverride[] = existing.field_overrides || []
        const existingOverrideIndex = currentOverrides.findIndex(o => o.field_id === fieldId)

        let newOverrides: FieldOverride[]
        if (matchesTemplateDefault) {
          // Remove the override since it matches the template default
          newOverrides = currentOverrides.filter(o => o.field_id !== fieldId)
        } else if (existingOverrideIndex >= 0) {
          // Update existing override
          newOverrides = [...currentOverrides]
          newOverrides[existingOverrideIndex] = { field_id: fieldId, is_visible: newVisibility }
        } else {
          // Add new override
          newOverrides = [...currentOverrides, { field_id: fieldId, is_visible: newVisibility }]
        }

        const { error } = await supabase
          .from(S.tables.selections)
          .update({ field_overrides: newOverrides })
          .eq('id', existing.id)

        if (error) throw error
      } else if (!matchesTemplateDefault) {
        // Only create new selection if the visibility differs from template default
        const { error } = await supabase
          .from(S.tables.selections)
          .insert({
            user_id: user.id,
            [S.subjectColumn]: targetAssetId,
            layout_id: null, // No template override, just field overrides
            field_overrides: [{ field_id: fieldId, is_visible: newVisibility }]
          })

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: K.selection })
    }
  })

  // Add a field to a specific section (with visibility)
  const addFieldToSection = useMutation({
    mutationFn: async ({ fieldId, sectionId }: { fieldId: string; sectionId: string }) => {
      if (!user?.id || !assetId) throw new Error('Not authenticated or no asset')

      // Get existing selection
      const { data: existing } = await supabase
        .from(S.tables.selections)
        .select('*')
        .eq('user_id', user.id)
        .eq(S.subjectColumn, assetId)
        .maybeSingle()

      const newOverride: FieldOverride = { field_id: fieldId, is_visible: true, section_id: sectionId }

      if (existing) {
        const currentOverrides: FieldOverride[] = existing.field_overrides || []
        // Remove any existing override for this field, then add new one
        const filteredOverrides = currentOverrides.filter(o => o.field_id !== fieldId)
        const newOverrides = [...filteredOverrides, newOverride]

        const { error } = await supabase
          .from(S.tables.selections)
          .update({ field_overrides: newOverrides })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from(S.tables.selections)
          .insert({
            user_id: user.id,
            [S.subjectColumn]: assetId,
            layout_id: null,
            field_overrides: [newOverride],
            section_overrides: []
          })

        if (error) throw error
      }
    },
    onMutate: async ({ fieldId, sectionId }) => {
      await queryClient.cancelQueries({ queryKey: K.selection })
      const previousSelection = queryClient.getQueryData(K.selection)

      // Optimistically add field override
      queryClient.setQueryData(K.selection, (old: any) => {
        const currentOverrides: FieldOverride[] = old?.field_overrides || []
        const filteredOverrides = currentOverrides.filter(o => o.field_id !== fieldId)
        return {
          ...old,
          layout_id: old?.layout_id || null,
          layout: old?.layout || null,
          field_overrides: [...filteredOverrides, { field_id: fieldId, is_visible: true, section_id: sectionId }],
          section_overrides: old?.section_overrides || []
        }
      })

      return { previousSelection }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousSelection) {
        queryClient.setQueryData(K.selection, context.previousSelection)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: K.selection })
    }
  })

  // Remove a field from a section (hide it)
  const removeFieldFromSection = useMutation({
    mutationFn: async ({ fieldId }: { fieldId: string }) => {
      if (!user?.id || !assetId) throw new Error('Not authenticated or no asset')

      // Get existing selection
      const { data: existing } = await supabase
        .from(S.tables.selections)
        .select('*')
        .eq('user_id', user.id)
        .eq(S.subjectColumn, assetId)
        .maybeSingle()

      if (existing) {
        const currentOverrides: FieldOverride[] = existing.field_overrides || []
        // Update to set is_visible: false (or remove if it matches template default)
        const existingOverride = currentOverrides.find(o => o.field_id === fieldId)
        let newOverrides: FieldOverride[]

        if (existingOverride) {
          // Update existing to hide
          newOverrides = currentOverrides.map(o =>
            o.field_id === fieldId ? { ...o, is_visible: false } : o
          )
        } else {
          // Add new override to hide
          newOverrides = [...currentOverrides, { field_id: fieldId, is_visible: false }]
        }

        const { error } = await supabase
          .from(S.tables.selections)
          .update({ field_overrides: newOverrides })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from(S.tables.selections)
          .insert({
            user_id: user.id,
            [S.subjectColumn]: assetId,
            layout_id: null,
            field_overrides: [{ field_id: fieldId, is_visible: false }],
            section_overrides: []
          })

        if (error) throw error
      }
    },
    onMutate: async ({ fieldId }) => {
      await queryClient.cancelQueries({ queryKey: K.selection })
      const previousSelection = queryClient.getQueryData(K.selection)

      // Optimistically hide field
      queryClient.setQueryData(K.selection, (old: any) => {
        const currentOverrides: FieldOverride[] = old?.field_overrides || []
        const existingIdx = currentOverrides.findIndex(o => o.field_id === fieldId)
        let newOverrides: FieldOverride[]
        if (existingIdx >= 0) {
          newOverrides = currentOverrides.map(o =>
            o.field_id === fieldId ? { ...o, is_visible: false } : o
          )
        } else {
          newOverrides = [...currentOverrides, { field_id: fieldId, is_visible: false }]
        }
        return {
          ...old,
          field_overrides: newOverrides
        }
      })

      return { previousSelection }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousSelection) {
        queryClient.setQueryData(K.selection, context.previousSelection)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: K.selection })
    }
  })

  // Select a layout for one subject. `subjectId` for the reason above.
  const selectLayoutForAsset = useMutation({
    mutationFn: async ({ subjectId: targetAssetId, layoutId }: { subjectId: string; layoutId: string | null }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Get existing selection to preserve field_overrides and section_overrides
      const { data: existing, error: fetchError } = await supabase
        .from(S.tables.selections)
        .select('*')
        .eq('user_id', user.id)
        .eq(S.subjectColumn, targetAssetId)
        .maybeSingle()

      if (fetchError) {
        console.error('Error fetching existing selection:', fetchError)
        throw fetchError
      }

      const existingFieldOverrides = existing?.field_overrides || []
      const existingSectionOverrides = existing?.section_overrides || []
      const hasOverrides = existingFieldOverrides.length > 0 || existingSectionOverrides.length > 0

      if (layoutId === null && !hasOverrides) {
        // No layout and no overrides - remove the selection entirely
        if (existing) {
          const { error } = await supabase
            .from(S.tables.selections)
            .delete()
            .eq('id', existing.id)

          if (error) {
            throw error
          }
        }
      } else if (existing) {
        // Update existing row
        const { error } = await supabase
          .from(S.tables.selections)
          .update({
            layout_id: layoutId,
            field_overrides: existingFieldOverrides,
            section_overrides: existingSectionOverrides,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)

        if (error) {
          throw error
        }
      } else {
        // Insert new row
        const { error } = await supabase
          .from(S.tables.selections)
          .insert({
            user_id: user.id,
            [S.subjectColumn]: targetAssetId,
            layout_id: layoutId,
            field_overrides: existingFieldOverrides,
            section_overrides: existingSectionOverrides
          })

        if (error) {
          throw error
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: K.selection })
    }
  })

  // Clear all field overrides for a specific asset (reset to template defaults)
  const clearAssetOverrides = useMutation({
    mutationFn: async (targetAssetId: string) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Get existing selection
      const { data: existing } = await supabase
        .from(S.tables.selections)
        .select('*')
        .eq('user_id', user.id)
        .eq(S.subjectColumn, targetAssetId)
        .maybeSingle()

      if (!existing) return // Nothing to clear

      if (existing.layout_id) {
        // Has layout selection, just clear overrides
        const { error } = await supabase
          .from(S.tables.selections)
          .update({ field_overrides: [], section_overrides: [] })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        // No layout, only had overrides - delete the whole row
        const { error } = await supabase
          .from(S.tables.selections)
          .delete()
          .eq('id', existing.id)

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: K.selection })
    }
  })

  // Update section override (rename, hide, reorder)
  const updateSectionOverride = useMutation({
    mutationFn: async ({
      subjectId: targetAssetId,
      sectionId,
      nameOverride,
      isHidden,
      displayOrder
    }: {
      subjectId: string
      sectionId: string
      nameOverride?: string | null
      isHidden?: boolean
      displayOrder?: number
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Get existing selection
      const { data: existing } = await supabase
        .from(S.tables.selections)
        .select('*')
        .eq('user_id', user.id)
        .eq(S.subjectColumn, targetAssetId)
        .maybeSingle()

      const currentOverrides: SectionOverride[] = existing?.section_overrides || []
      const existingIndex = currentOverrides.findIndex(o => o.section_id === sectionId)
      const existingOverride = existingIndex >= 0 ? currentOverrides[existingIndex] : undefined

      /*
       * Only the keys the caller actually named.
       *
       * This used to build a whole override from those keys and REPLACE
       * whatever the section already said, so hiding a section that had
       * been renamed and reordered threw the rename and the order away.
       * Nothing reported it: the name reverted to the template's on the
       * next load and looked like it had never been changed.
       *
       * `is_hidden: false` is kept as a real statement rather than
       * dropped, because a template can hide a section and the asset
       * needs a way to say otherwise. Whether it is a no-op is decided
       * below, where the template is in view.
       */
      const patch: Partial<SectionOverride> = {}
      if (nameOverride !== undefined) patch.name_override = nameOverride || undefined
      if (isHidden !== undefined) patch.is_hidden = isHidden
      if (displayOrder !== undefined) patch.display_order = displayOrder

      const merged: SectionOverride = { ...existingOverride, ...patch, section_id: sectionId }

      /*
       * Does the merged override still say anything?
       *
       * `is_hidden: false` counts only when the TEMPLATE hides this
       * section — otherwise it repeats what the template already does
       * and would pin the stock to an override with nothing in it, the
       * same trap no-op field overrides used to set.
       */
      const hasValues = sectionOverrideSaysSomething(merged, {
        templateHidesIt: templateHidesSection(sectionId),
      })

      if (existing) {
        let newOverrides: SectionOverride[]
        if (existingIndex >= 0) {
          if (hasValues) {
            // Update existing override
            newOverrides = [...currentOverrides]
            newOverrides[existingIndex] = merged
          } else {
            // Remove override if no values
            newOverrides = currentOverrides.filter(o => o.section_id !== sectionId)
          }
        } else if (hasValues) {
          // Add new override
          newOverrides = [...currentOverrides, merged]
        } else {
          return // Nothing to do
        }

        const { error } = await supabase
          .from(S.tables.selections)
          .update({ section_overrides: newOverrides })
          .eq('id', existing.id)

        if (error) throw error
      } else if (hasValues) {
        // Create new selection with the section override
        const { error } = await supabase
          .from(S.tables.selections)
          .insert({
            user_id: user.id,
            [S.subjectColumn]: targetAssetId,
            layout_id: null,
            field_overrides: [],
            section_overrides: [merged]
          })

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: K.selection })
    }
  })

  // Create a new section (and optionally add it as an asset-specific override)
  const createSection = useMutation({
    mutationFn: async ({ name, addAsOverride = true }: { name: string; addAsOverride?: boolean }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // The org the user is currently in. See the note at the top of the
      // hook: a membership `.single()` returns nothing for a multi-org user.
      if (!currentOrgId) throw new Error('Could not find organization')

      // Generate base slug from name
      const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

      // Check for existing sections with similar slugs to generate a unique one
      const { data: existingSections } = await supabase
        .from(S.tables.sections)
        .select('slug')
        .eq('organization_id', currentOrgId)
        .like('slug', `${baseSlug}%`)

      // Find a unique slug
      let slug = baseSlug
      if (existingSections && existingSections.length > 0) {
        const existingSlugs = new Set(existingSections.map(s => s.slug))
        if (existingSlugs.has(baseSlug)) {
          let counter = 2
          while (existingSlugs.has(`${baseSlug}_${counter}`)) {
            counter++
          }
          slug = `${baseSlug}_${counter}`
        }
      }

      // Get max display order
      const { data: sections } = await supabase
        .from(S.tables.sections)
        .select('display_order')
        .eq('organization_id', currentOrgId)
        .order('display_order', { ascending: false })
        .limit(1)

      const maxOrder = sections?.[0]?.display_order ?? 0

      const { data: newSection, error } = await supabase
        .from(S.tables.sections)
        .insert({
          organization_id: currentOrgId,
          name,
          slug,
          display_order: maxOrder + 1,
          is_system: false
        })
        .select()
        .single()

      if (error) throw error

      // If assetId is provided and addAsOverride is true, add section override
      if (assetId && addAsOverride) {
        // Get existing selection or create new one
        const { data: existing } = await supabase
          .from(S.tables.selections)
          .select('*')
          .eq('user_id', user.id)
          .eq(S.subjectColumn, assetId)
          .maybeSingle()

        const sectionOverride: SectionOverride = {
          section_id: newSection.id,
          is_added: true
        }

        if (existing) {
          const currentOverrides: SectionOverride[] = existing.section_overrides || []
          const { error: updateError } = await supabase
            .from(S.tables.selections)
            .update({
              section_overrides: [...currentOverrides, sectionOverride]
            })
            .eq('id', existing.id)

          if (updateError) throw updateError
        } else {
          const { error: insertError } = await supabase
            .from(S.tables.selections)
            .insert({
              user_id: user.id,
              [S.subjectColumn]: assetId,
              layout_id: null,
              field_overrides: [],
              section_overrides: [sectionOverride]
            })

          if (insertError) throw insertError
        }
      }

      return newSection
    },
    onMutate: async ({ name }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: K.sections })
      await queryClient.cancelQueries({ queryKey: K.selection })

      // Snapshot previous values
      const previousSections = queryClient.getQueryData(K.sections)
      const previousSelection = queryClient.getQueryData(K.selection)

      // Generate optimistic section with temp ID
      const tempId = `temp-${Date.now()}`
      const tempSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      const optimisticSection = {
        id: tempId,
        name,
        slug: tempSlug,
        display_order: 999,
        is_system: false
      }

      // Optimistically add section to allSections
      queryClient.setQueryData(K.sections, (old: any[] = []) => {
        return [...old, optimisticSection]
      })

      // Optimistically add section override to asset layout selection
      if (assetId) {
        queryClient.setQueryData(K.selection, (old: any) => {
          const currentOverrides: SectionOverride[] = old?.section_overrides || []
          return {
            ...old,
            layout_id: old?.layout_id || null,
            layout: old?.layout || null,
            field_overrides: old?.field_overrides || [],
            section_overrides: [...currentOverrides, { section_id: tempId, is_added: true }]
          }
        })
      }

      return { previousSections, previousSelection, tempId }
    },
    onSuccess: (newSection, _vars, context) => {
      // Replace temp ID with real ID in the cache (no flash)
      if (context?.tempId && newSection) {
        // Update allSections: replace temp section with real one
        queryClient.setQueryData(K.sections, (old: any[] = []) => {
          return old.map(s => s.id === context.tempId ? {
            id: newSection.id,
            name: newSection.name,
            slug: newSection.slug,
            display_order: newSection.display_order,
            is_system: newSection.is_system
          } : s)
        })

        // Update asset layout selection: replace temp section_id with real one
        if (assetId) {
          queryClient.setQueryData(K.selection, (old: any) => {
            if (!old) return old
            const updatedOverrides = (old.section_overrides || []).map((o: SectionOverride) =>
              o.section_id === context.tempId ? { ...o, section_id: newSection.id } : o
            )
            return { ...old, section_overrides: updatedOverrides }
          })
        }
      }
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      if (context?.previousSections) {
        queryClient.setQueryData(K.sections, context.previousSections)
      }
      if (context?.previousSelection) {
        queryClient.setQueryData(K.selection, context.previousSelection)
      }
    }
  })

  // Delete a section that was added as an override for this asset
  const deleteAddedSection = useMutation({
    mutationFn: async ({ sectionId }: { sectionId: string }) => {
      if (!user?.id || !assetId) throw new Error('Not authenticated or no asset')

      // Remove the section override from user_asset_layout_selections
      const { data: existing } = await supabase
        .from(S.tables.selections)
        .select('*')
        .eq('user_id', user.id)
        .eq(S.subjectColumn, assetId)
        .maybeSingle()

      if (existing) {
        const currentOverrides: SectionOverride[] = existing.section_overrides || []
        const newOverrides = currentOverrides.filter(o => o.section_id !== sectionId)

        const { error } = await supabase
          .from(S.tables.selections)
          .update({ section_overrides: newOverrides })
          .eq('id', existing.id)

        if (error) throw error
      }
    },
    onMutate: async ({ sectionId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: K.selection })

      // Snapshot previous value
      const previousSelection = queryClient.getQueryData(K.selection)

      // Optimistically remove section override
      queryClient.setQueryData(K.selection, (old: any) => {
        if (!old) return old
        const currentOverrides: SectionOverride[] = old.section_overrides || []
        return {
          ...old,
          section_overrides: currentOverrides.filter(o => o.section_id !== sectionId)
        }
      })

      return { previousSelection }
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      if (context?.previousSelection) {
        queryClient.setQueryData(K.selection, context.previousSelection)
      }
    },
    onSettled: () => {
      // Refetch to sync with server
      queryClient.invalidateQueries({ queryKey: K.selection })
    }
  })

  // Reorder sections for this asset
  const reorderSections = useMutation({
    mutationFn: async ({ orderedSectionIds }: { orderedSectionIds: string[] }) => {
      if (!user?.id || !assetId) throw new Error('Not authenticated or no asset')

      // Get existing selection
      const { data: existing } = await supabase
        .from(S.tables.selections)
        .select('*')
        .eq('user_id', user.id)
        .eq(S.subjectColumn, assetId)
        .maybeSingle()

      const currentOverrides: SectionOverride[] = existing?.section_overrides || []

      /* The decision itself is a pure function, tested on its own in
         `layout-resolver.test.ts`: putting a section back where it
         started must CLEAR the positions rather than write every
         section's, which is what pinned a stock to "Custom layout"
         after a nudge and a nudge back. */
      const newOverrides = reorderedSectionOverrides({
        orderedSectionIds,
        currentOverrides,
        baselineOrderOf: sectionBaselineOrder,
        templateHidesSection,
      })

      if (existing) {
        const { error } = await supabase
          .from(S.tables.selections)
          .update({ section_overrides: newOverrides })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from(S.tables.selections)
          .insert({
            user_id: user.id,
            [S.subjectColumn]: assetId,
            layout_id: null,
            field_overrides: [],
            section_overrides: newOverrides
          })

        if (error) throw error
      }
    },
    onMutate: async ({ orderedSectionIds }) => {
      await queryClient.cancelQueries({ queryKey: K.selection })
      const previousSelection = queryClient.getQueryData(K.selection)

      // Optimistically update section order
      queryClient.setQueryData(K.selection, (old: any) => {
        /* The same rule the write uses, not a second copy of it. The
           optimistic path had its own inline version that always wrote
           explicit positions, so a reorder back to the template's order
           flashed "Custom layout" until the refetch disagreed with it. */
        return {
          ...old,
          section_overrides: reorderedSectionOverrides({
            orderedSectionIds,
            currentOverrides: old?.section_overrides || [],
            baselineOrderOf: sectionBaselineOrder,
            templateHidesSection,
          }),
        }
      })

      return { previousSelection }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousSelection) {
        queryClient.setQueryData(K.selection, context.previousSelection)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: K.selection })
    }
  })

  // Reorder fields within a section for this asset
  const reorderFieldsInSection = useMutation({
    mutationFn: async ({ sectionId, orderedFieldIds, hiddenFieldIds = [] }: { sectionId: string; orderedFieldIds: string[]; hiddenFieldIds?: string[] }) => {
      if (!user?.id || !assetId) throw new Error('Not authenticated or no asset')

      // Get existing selection
      const { data: existing } = await supabase
        .from(S.tables.selections)
        .select('*')
        .eq('user_id', user.id)
        .eq(S.subjectColumn, assetId)
        .maybeSingle()

      // Build field overrides with new display_order
      const currentOverrides: FieldOverride[] = existing?.field_overrides || []

      // Update/add overrides for reordered fields
      const newOverrides = [...currentOverrides]
      orderedFieldIds.forEach((fieldId, index) => {
        const existingIdx = newOverrides.findIndex(o => o.field_id === fieldId)
        if (existingIdx >= 0) {
          newOverrides[existingIdx] = {
            ...newOverrides[existingIdx],
            is_visible: true,
            display_order: index,
            section_id: sectionId
          }
        } else {
          newOverrides.push({
            field_id: fieldId,
            is_visible: true,
            display_order: index,
            section_id: sectionId
          })
        }
      })

      // Update/add overrides for hidden fields (removed from section)
      hiddenFieldIds.forEach((fieldId) => {
        const existingIdx = newOverrides.findIndex(o => o.field_id === fieldId)
        if (existingIdx >= 0) {
          newOverrides[existingIdx] = {
            ...newOverrides[existingIdx],
            is_visible: false
          }
        } else {
          newOverrides.push({
            field_id: fieldId,
            is_visible: false,
            section_id: sectionId
          })
        }
      })

      if (existing) {
        const { error } = await supabase
          .from(S.tables.selections)
          .update({ field_overrides: newOverrides })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from(S.tables.selections)
          .insert({
            user_id: user.id,
            [S.subjectColumn]: assetId,
            layout_id: null,
            field_overrides: newOverrides,
            section_overrides: []
          })

        if (error) throw error
      }
    },
    onMutate: async ({ sectionId, orderedFieldIds }) => {
      await queryClient.cancelQueries({ queryKey: K.selection })
      const previousSelection = queryClient.getQueryData(K.selection)

      // Optimistically update field order
      queryClient.setQueryData(K.selection, (old: any) => {
        const currentOverrides: FieldOverride[] = old?.field_overrides || []
        const newOverrides = [...currentOverrides]

        orderedFieldIds.forEach((fieldId, index) => {
          const existingIdx = newOverrides.findIndex(o => o.field_id === fieldId)
          if (existingIdx >= 0) {
            newOverrides[existingIdx] = {
              ...newOverrides[existingIdx],
              display_order: index,
              section_id: sectionId
            }
          } else {
            newOverrides.push({
              field_id: fieldId,
              is_visible: true,
              display_order: index,
              section_id: sectionId
            })
          }
        })

        return {
          ...old,
          field_overrides: newOverrides
        }
      })

      return { previousSelection }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousSelection) {
        queryClient.setQueryData(K.selection, context.previousSelection)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: K.selection })
    }
  })

  // Atomic save via RPC — single transaction, auth.uid() enforced server-side
  const saveCustomization = useMutation({
    mutationFn: async (params: {
      layoutId?: string | null
      fieldOverrides: FieldOverride[]
      sectionOverrides: SectionOverride[]
      newSections: Array<{ temp_id: string; name: string }>
      clearAll?: boolean
    }) => {
      if (!user?.id || !assetId) throw new Error('Not authenticated or no asset')

      // Pass current version for optimistic concurrency control
      const currentVersion = assetLayoutSelection?.version ?? null

      const { data, error } = await supabase.rpc(S.tables.saveCustomizationFn, {
        [S.tables.saveCustomizationSubjectParam]: assetId,
        p_layout_id: params.layoutId ?? null,
        p_field_overrides: params.fieldOverrides,
        p_section_overrides: params.sectionOverrides,
        p_new_sections: params.newSections,
        p_clear_all: params.clearAll ?? false,
        p_expected_version: currentVersion
      })

      if (error) {
        // Surface concurrency conflicts with a clear message
        if (error.message?.includes('CONFLICT:')) {
          throw new Error('This layout was modified in another tab or session. Please refresh and try again.')
        }
        /*
         * PGRST202 is "no function by that name", which for a theme means
         * `save_theme_layout_customization` has not been applied to this
         * server yet. Say so, rather than letting a 404 surface as a
         * generic failure -- the layout tables exist, so everything else on
         * the page works and only saving does not.
         */
        if (error.code === 'PGRST202') {
          throw new Error(
            'Saving a layout is not enabled on this server yet. Your research is unaffected.'
          )
        }
        throw error
      }
      return data as {
        status: string
        selection_id: string | null
        created_sections: Array<{ temp_id: string; real_id: string; name: string; slug: string }>
        version: number | null
      }
    },
    onSuccess: () => {
      // Invalidate all relevant queries to ensure fresh data
      queryClient.invalidateQueries({ queryKey: K.selection })
      queryClient.invalidateQueries({ queryKey: K.defaultLayout })
      queryClient.invalidateQueries({ queryKey: K.sections })
      queryClient.invalidateQueries({ queryKey: K.fields })
    }
  })

  // Helper to check if a field is visible (for use by other features)
  const isFieldVisible = (fieldId: string): boolean => {
    const field = fieldsWithPreferences.find(f => f.field_id === fieldId)
    return field?.is_visible ?? false
  }

  // Helper to check if a field is visible by slug (for use by other features)
  const isFieldVisibleBySlug = (fieldSlug: string): boolean => {
    const field = fieldsWithPreferences.find(f => f.field_slug === fieldSlug)
    return field?.is_visible ?? false
  }

  // Helper to get visible field IDs (for filtering contributions in other features)
  const getVisibleFieldIds = (): Set<string> => {
    return new Set(fieldsWithPreferences.filter(f => f.is_visible).map(f => f.field_id))
  }

  // Helper to get visible field slugs (for filtering contributions in other features)
  const getVisibleFieldSlugs = (): Set<string> => {
    return new Set(fieldsWithPreferences.filter(f => f.is_visible).map(f => f.field_slug))
  }

  return {
    // Data
    availableFields,
    allSections,
    fieldsWithPreferences,
    fieldsBySection,
    displayedFieldsBySection,
    activeLayout,
    defaultLayout,
    assetLayoutSelection,
    assetFieldOverrides,
    assetSectionOverrides,
    resolvedSectionOverrides,
    sectionsForArranging,
    hasAssetCustomization,
    overridesTemplate,
    templateBaselineFields,

    // Loading states
    isLoading: fieldsLoading || sectionsLoading || layoutLoading || (assetId ? assetLayoutLoading : false),

    // Mutations
    saveCustomization,
    toggleAssetFieldVisibility,
    addFieldToSection,
    removeFieldFromSection,
    selectLayoutForAsset,
    clearAssetOverrides,
    updateSectionOverride,
    createSection,
    deleteAddedSection,
    reorderSections,
    reorderFieldsInSection,

    // Helpers for field visibility (for use by other features)
    isFieldVisible,
    isFieldVisibleBySlug,
    getVisibleFieldIds,
    getVisibleFieldSlugs,

    // Mutation states
    isUpdating: toggleAssetFieldVisibility.isPending || updateSectionOverride.isPending
  }
}

export interface LayoutWithSharing extends SavedLayout {
  is_shared_with_me?: boolean
  shared_by?: {
    id: string
    first_name?: string
    last_name?: string
    email?: string
  }
  my_permission?: 'view' | 'edit' | 'admin' | 'owner'
}

/**
 * Fire-and-forget audit event for layout template CRUD.
 * Never throws — audit logging should not break main flow.
 */
async function logLayoutAuditEvent(
  userId: string,
  entityId: string,
  actionType: string,
  templateName: string
) {
  try {
    // Written through record_audit_event(). The org lookup that used to sit
    // here is gone: the server reads the caller's current organization, which is
    // also more correct than the arbitrary `.single()` active membership this
    // picked for a user who belongs to more than one.
    //
    // `userId` is no longer sent — actor_id comes from auth.uid(). It is still
    // taken as a parameter so callers do not change, and so this cannot silently
    // start logging for the wrong user if it is ever called with a stale id.
    void userId

    // action_category was 'research_layout', which is NOT in the
    // `valid_action_category` CHECK constraint — the allowed set is still the
    // original ('lifecycle','state_change','field_edit','relationship','access',
    // 'system') and no migration has widened it. So every one of these inserts
    // has been violating the constraint and being swallowed by the catch below:
    // this function has never written a row. `20260418000000_fix_morph_session_audit.sql`
    // records the same mistake being fixed elsewhere. Layout template CRUD is
    // entity lifecycle, so it is mapped to 'lifecycle' and now actually records.
    const { error } = await supabase.rpc('record_audit_event', {
      p_entity_type: 'layout_template',
      p_entity_id: entityId,
      p_action_type: actionType,
      p_action_category: 'lifecycle',
      p_entity_display_name: templateName,
      p_metadata: { ui_source: 'template_manager' },
    })

    if (error) {
      // Same contract as before: never break the main flow.
      console.error('[AUDIT] layout template event failed:', error)
    }
  } catch {
    // Audit logging should never break the main flow
  }
}

/**
 * Named layout templates for one subject. Asset-shaped entry point.
 */
export function useUserAssetPageLayouts() {
  return useResearchPageLayouts(assetSubject(undefined))
}

/**
 * The templates themselves are not per-subject -- they belong to the user --
 * but they live in a different TABLE per subject, so this still takes one.
 * The subject's `id` is unused here and callers may pass `undefined` for it.
 */
export function useResearchPageLayouts(subject: ResearchSubject) {
  const S = subject.descriptor
  const { user } = useAuth()
  // Org-wide layout shares are scoped to the org the user is currently in.
  // See the note in `useUserAssetPagePreferences` on why this is not a
  // membership lookup.
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  const K = researchLayoutKeys(subject, user?.id, currentOrgId)

  // Fetch user's own layouts + layouts shared with them
  const { data: layouts, isLoading } = useQuery({
    queryKey: K.layouts,
    queryFn: async () => {
      if (!user?.id) return []

      // 1. Get user's own layouts
      const { data: ownLayouts, error: ownError } = await supabase
        .from(S.tables.layouts)
        .select('*')
        .eq('user_id', user.id)
        .order('name')

      if (ownError) throw ownError

      // 2. Get layouts shared with user directly
      const { data: directShares, error: directError } = await supabase
        .from(S.tables.layoutCollaborations)
        .select(`
          permission,
          ${S.embeds.collaborationLayout}
        `)
        .eq('user_id', user.id)

      if (directError) throw directError

      // 3. Get layouts shared via teams user belongs to
      const { data: teamMemberships } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)

      const teamIds = (teamMemberships || []).map(tm => tm.team_id)

      let teamShares: any[] = []
      if (teamIds.length > 0) {
        const { data, error: teamError } = await supabase
          .from(S.tables.layoutCollaborations)
          .select(`
            permission,
            ${S.embeds.collaborationLayout}
          `)
          .in('team_id', teamIds)

        if (teamError) throw teamError
        teamShares = data || []
      }

      // 4. Get layouts shared via org nodes user belongs to
      const { data: nodeMemberships } = await supabase
        .from('org_chart_node_members')
        .select('node_id')
        .eq('user_id', user.id)

      const nodeIds = (nodeMemberships || []).map(nm => nm.node_id)

      let nodeShares: any[] = []
      if (nodeIds.length > 0) {
        const { data, error: nodeError } = await supabase
          .from(S.tables.layoutCollaborations)
          .select(`
            permission,
            ${S.embeds.collaborationLayout}
          `)
          .in('org_node_id', nodeIds)

        if (nodeError) throw nodeError
        nodeShares = data || []
      }

      // 5. Get layouts shared with entire organization. The org is the one
      // the user has switched to — see the note at the top of the hook.
      let orgShares: any[] = []
      if (currentOrgId) {
        const { data, error: orgError } = await supabase
          .from(S.tables.layoutCollaborations)
          .select(`
            permission,
            ${S.embeds.collaborationLayout}
          `)
          .is('user_id', null)
          .is('team_id', null)
          .is('org_node_id', null)

        if (orgError) throw orgError
        orgShares = data || []
      }

      // Combine all shared layouts
      const allShares = [...directShares || [], ...teamShares, ...nodeShares, ...orgShares]

      // Collect unique owner user IDs to fetch their info
      const ownerUserIds = new Set<string>()
      for (const share of allShares) {
        if (share.layout?.user_id && share.layout.user_id !== user.id) {
          ownerUserIds.add(share.layout.user_id)
        }
      }

      // Fetch owner info from public.users
      let ownersMap = new Map<string, { id: string; first_name?: string; last_name?: string; email?: string }>()
      if (ownerUserIds.size > 0) {
        const { data: owners } = await supabase
          .from('users')
          .select('id, first_name, last_name, email')
          .in('id', Array.from(ownerUserIds))

        for (const owner of owners || []) {
          ownersMap.set(owner.id, owner)
        }
      }

      // Deduplicate and find highest permission for each layout
      const sharedLayoutsMap = new Map<string, { permission: string; layout: any; owner?: any }>()
      for (const share of allShares) {
        if (!share.layout || share.layout.user_id === user.id) continue // Skip own layouts

        const existing = sharedLayoutsMap.get(share.layout.id)
        const permissionRank = { view: 1, edit: 2, admin: 3 }
        const currentRank = permissionRank[share.permission as keyof typeof permissionRank] || 0
        const existingRank = existing ? permissionRank[existing.permission as keyof typeof permissionRank] || 0 : 0

        if (!existing || currentRank > existingRank) {
          const owner = ownersMap.get(share.layout.user_id)
          sharedLayoutsMap.set(share.layout.id, { ...share, owner })
        }
      }

      // Format own layouts
      const formattedOwnLayouts: LayoutWithSharing[] = (ownLayouts || []).map(layout => ({
        ...layout,
        is_shared_with_me: false,
        my_permission: 'owner' as const
      }))

      // Format shared layouts
      const formattedSharedLayouts: LayoutWithSharing[] = Array.from(sharedLayoutsMap.values()).map(share => ({
        ...share.layout,
        is_shared_with_me: true,
        shared_by: share.owner,
        my_permission: share.permission as 'view' | 'edit' | 'admin'
      }))

      // Combine and sort
      const allLayouts = [...formattedOwnLayouts, ...formattedSharedLayouts]
      allLayouts.sort((a, b) => a.name.localeCompare(b.name))

      return allLayouts
    },
    enabled: !!user?.id
  })

  // Save current layout
  const saveLayout = useMutation({
    mutationFn: async ({
      name,
      description,
      fieldConfig,
      sectionConfig,
      isDefault = false
    }: {
      name: string
      description?: string
      fieldConfig: FieldConfigItem[]
      /** The template's sections. Omitted means "says nothing about them". */
      sectionConfig?: SectionOverride[]
      isDefault?: boolean
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // If setting as default, clear other defaults first
      if (isDefault) {
        await supabase
          .from(S.tables.layouts)
          .update({ is_default: false })
          .eq('user_id', user.id)
      }

      const { data, error } = await supabase
        .from(S.tables.layouts)
        .insert({
          user_id: user.id,
          name,
          description: description || null,
          is_default: isDefault,
          field_config: fieldConfig,
          /* null, not [], when the caller says nothing: an empty array is
             a template asserting it has no sections, which would hide
             every section rather than deferring to the defaults. */
          section_config: sectionConfig ?? null
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onMutate: async ({ name, description, fieldConfig, isDefault }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: K.layouts })

      // Snapshot previous value
      const previousLayouts = queryClient.getQueryData(K.layouts)

      // Optimistically add the new layout
      const optimisticLayout: LayoutWithSharing = {
        id: `temp-${Date.now()}`,
        user_id: user?.id || '',
        name,
        description: description || null,
        is_default: isDefault || false,
        field_config: fieldConfig,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_shared_with_me: false,
        my_permission: 'owner'
      }

      queryClient.setQueryData(K.layouts, (old: LayoutWithSharing[] = []) => {
        // If setting as default, clear other defaults
        const updated = isDefault
          ? old.map(l => ({ ...l, is_default: false }))
          : old
        return [...updated, optimisticLayout].sort((a, b) => a.name.localeCompare(b.name))
      })

      return { previousLayouts }
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      if (context?.previousLayouts) {
        queryClient.setQueryData(K.layouts, context.previousLayouts)
      }
    },
    onSettled: (_data, _err, vars) => {
      // Refetch to sync with server
      queryClient.invalidateQueries({ queryKey: K.layouts })
      // Also invalidate default layout query so preferences hook picks up changes
      queryClient.invalidateQueries({ queryKey: K.defaultLayout })

      // Fire-and-forget audit event for template creation
      if (_data && !_err && user?.id) {
        logLayoutAuditEvent(user.id, _data.id, 'create', vars.name)
      }
    }
  })

  // Update layout
  const updateLayout = useMutation({
    mutationFn: async ({
      layoutId,
      name,
      description,
      fieldConfig,
      sectionConfig,
      isDefault,
      expectedUpdatedAt
    }: {
      layoutId: string
      name?: string
      description?: string
      fieldConfig?: FieldConfigItem[]
      /** Undefined leaves the stored sections alone; it does not clear them. */
      sectionConfig?: SectionOverride[]
      isDefault?: boolean
      /**
       * The `updated_at` the caller believes it is overwriting.
       *
       * A template is shared by every asset using it, so two tabs editing
       * one is not exotic. Without this the second write silently erased
       * the first — no error, no sign, just an arrangement that reverted.
       * Passing it turns that into a refusal the caller can report.
       *
       * It is a real token, not a hopeful one: the table carries
       * `update_user_asset_page_layouts_updated_at`, a BEFORE UPDATE
       * trigger, so the value moves on every write. A guard on a column
       * that never changed would never fire.
       */
      expectedUpdatedAt?: string
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // If setting as default, clear other defaults first
      if (isDefault) {
        await supabase
          .from(S.tables.layouts)
          .update({ is_default: false })
          .eq('user_id', user.id)
      }

      const updates: Partial<SavedLayout> = {}
      if (name !== undefined) updates.name = name
      if (description !== undefined) updates.description = description
      if (fieldConfig !== undefined) updates.field_config = fieldConfig
      if (sectionConfig !== undefined) updates.section_config = sectionConfig
      if (isDefault !== undefined) updates.is_default = isDefault

      /*
       * `.select()` is what makes the guard observable. Narrowing by
       * `updated_at` alone would just match no rows and report success,
       * which is the silent overwrite wearing a different hat; asking
       * which rows changed is how a miss becomes a conflict.
       */
      let query = supabase
        .from(S.tables.layouts)
        .update(updates)
        .eq('id', layoutId)
      if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)

      const { data: changed, error } = await query.select('id')

      if (error) throw error
      if (expectedUpdatedAt && (!changed || changed.length === 0)) {
        throw new Error(
          'CONFLICT: this template changed somewhere else while you were arranging. ' +
          'Reload the page to see the current layout, then make your changes again.',
        )
      }
    },
    onMutate: async ({ layoutId, name, description, fieldConfig, sectionConfig, isDefault }) => {
      await queryClient.cancelQueries({ queryKey: K.layouts })
      const previousLayouts = queryClient.getQueryData(K.layouts)

      queryClient.setQueryData(K.layouts, (old: LayoutWithSharing[] = []) => {
        return old.map(layout => {
          // Clear other defaults if setting this as default
          if (isDefault && layout.id !== layoutId) {
            return { ...layout, is_default: false }
          }
          if (layout.id !== layoutId) return layout
          return {
            ...layout,
            ...(name !== undefined && { name }),
            ...(description !== undefined && { description }),
            ...(fieldConfig !== undefined && { field_config: fieldConfig }),
            ...(sectionConfig !== undefined && { section_config: sectionConfig }),
            ...(isDefault !== undefined && { is_default: isDefault }),
            updated_at: new Date().toISOString()
          }
        }).sort((a, b) => a.name.localeCompare(b.name))
      })

      return { previousLayouts }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousLayouts) {
        queryClient.setQueryData(K.layouts, context.previousLayouts)
      }
    },
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({ queryKey: K.layouts })
      queryClient.invalidateQueries({ queryKey: K.defaultLayout })

      // Fire-and-forget audit event for template update
      if (!_err && user?.id) {
        const layout = layouts?.find(l => l.id === vars.layoutId)
        logLayoutAuditEvent(user.id, vars.layoutId, 'update_fields', layout?.name || vars.name || 'Unknown')
      }
    }
  })

  // Delete layout
  const deleteLayout = useMutation({
    mutationFn: async (layoutId: string) => {
      const { error } = await supabase
        .from(S.tables.layouts)
        .delete()
        .eq('id', layoutId)

      if (error) throw error
    },
    onMutate: async (layoutId) => {
      await queryClient.cancelQueries({ queryKey: K.layouts })
      const previousLayouts = queryClient.getQueryData(K.layouts) as LayoutWithSharing[] | undefined
      const deletedName = previousLayouts?.find(l => l.id === layoutId)?.name

      queryClient.setQueryData(K.layouts, (old: LayoutWithSharing[] = []) => {
        return old.filter(layout => layout.id !== layoutId)
      })

      return { previousLayouts, deletedName }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousLayouts) {
        queryClient.setQueryData(K.layouts, context.previousLayouts)
      }
    },
    onSettled: (_data, _err, layoutId, context) => {
      queryClient.invalidateQueries({ queryKey: K.layouts })
      // Deleted template may have been the default — refetch
      queryClient.invalidateQueries({ queryKey: K.defaultLayout })

      // Fire-and-forget audit event for template deletion
      if (!_err && user?.id) {
        logLayoutAuditEvent(user.id, layoutId, 'delete', context?.deletedName || 'Unknown')
      }
    }
  })

  // Get default layout
  const defaultLayout = layouts?.find(l => l.is_default)

  // Dev diagnostics: warn about data integrity issues
  useEffect(() => {
    if (!layouts || layouts.length === 0) return
    warnDataIntegrityIssues(
      layouts.map(l => ({ id: l.id, name: l.name, field_config: l.field_config, is_default: l.is_default })),
      { userId: user?.id }
    )
  }, [layouts, user?.id])

  return {
    layouts,
    defaultLayout,
    isLoading,
    saveLayout,
    updateLayout,
    deleteLayout,
    isSaving: saveLayout.isPending
  }
}

// ============================================================================
// LAYOUT USAGE METRICS
// ============================================================================

import type {
  LayoutUsageMetric,
  LayoutCollaborationSummary,
} from '../lib/research/layout-card-model'

/**
 * Fetches per-layout usage counts from user_asset_layout_selections.
 *
 * Returns:
 *  - perLayout: LayoutUsageMetric[] (assets_using + assets_with_overrides per layout_id)
 *  - globalOverrideCount: total assets with any overrides (field or section)
 */
export function useLayoutUsageMetrics(
  subject: ResearchSubject = assetSubject(undefined),
) {
  const S = subject.descriptor
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const K = researchLayoutKeys(subject, user?.id, currentOrgId)

  return useQuery({
    queryKey: K.usageMetrics,
    queryFn: async () => {
      if (!user?.id) return { perLayout: [] as LayoutUsageMetric[], globalOverrideCount: 0 }

      // Fetch all layout selections for this user
      const { data, error } = await supabase
        .from(S.tables.selections)
        .select('layout_id, field_overrides, section_overrides')
        .eq('user_id', user.id)

      if (error) throw error
      const rows = data || []

      // Aggregate per layout
      const layoutMap = new Map<string, { assets_using: number; assets_with_overrides: number }>()
      let globalOverrideCount = 0

      for (const row of rows) {
        const lid = row.layout_id || '__none__'
        const entry = layoutMap.get(lid) || { assets_using: 0, assets_with_overrides: 0 }
        entry.assets_using++

        const hasOverrides =
          (Array.isArray(row.field_overrides) && row.field_overrides.length > 0) ||
          (Array.isArray(row.section_overrides) && row.section_overrides.length > 0)

        if (hasOverrides) {
          entry.assets_with_overrides++
          globalOverrideCount++
        }

        layoutMap.set(lid, entry)
      }

      const perLayout: LayoutUsageMetric[] = Array.from(layoutMap.entries())
        .filter(([key]) => key !== '__none__')
        .map(([layout_id, counts]) => ({
          layout_id,
          ...counts,
        }))

      return { perLayout, globalOverrideCount }
    },
    enabled: !!user?.id,
    staleTime: 30_000, // Cache for 30s — usage counts don't need to be real-time
  })
}

/**
 * Fetches collaboration summary per owned layout for scope derivation.
 *
 * Returns an array of LayoutCollaborationSummary — one per layout that has collaborations.
 * Layouts with no collaborations won't appear (scope defaults to 'personal').
 */
export function useLayoutCollabSummaries(
  subject: ResearchSubject = assetSubject(undefined),
) {
  const S = subject.descriptor
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const K = researchLayoutKeys(subject, user?.id, currentOrgId)

  return useQuery({
    queryKey: K.collabSummaries,
    queryFn: async () => {
      if (!user?.id) return [] as LayoutCollaborationSummary[]

      // Step 1: Get owned layout IDs
      const { data: layouts } = await supabase
        .from(S.tables.layouts)
        .select('id')
        .eq('user_id', user.id)

      if (!layouts || layouts.length === 0) return [] as LayoutCollaborationSummary[]

      // Step 2: Get all collaborations for those layouts
      const layoutIds = layouts.map(l => l.id)
      const { data: collabs, error } = await supabase
        .from(S.tables.layoutCollaborations)
        .select('layout_id, user_id, team_id, org_node_id')
        .in('layout_id', layoutIds)

      if (error) throw error

      return aggregateCollabSummaries(collabs || [])
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  })
}

function aggregateCollabSummaries(
  rows: Array<{ layout_id: string; user_id: string | null; team_id: string | null; org_node_id: string | null }>
): LayoutCollaborationSummary[] {
  const map = new Map<string, LayoutCollaborationSummary>()

  for (const row of rows) {
    const entry = map.get(row.layout_id) || {
      layout_id: row.layout_id,
      has_org_wide_share: false,
      has_team_share: false,
      has_user_share: false,
    }

    // Org-wide: all target fields are null
    if (!row.user_id && !row.team_id && !row.org_node_id) {
      entry.has_org_wide_share = true
    } else if (row.team_id || row.org_node_id) {
      entry.has_team_share = true
    } else if (row.user_id) {
      entry.has_user_share = true
    }

    map.set(row.layout_id, entry)
  }

  return Array.from(map.values())
}

// ============================================================================
// AFFECTED ASSETS — for summary tile drilldown drawers
// ============================================================================

export interface AffectedAsset {
  asset_id: string
  symbol: string
  company_name: string
  layout_id: string | null
  layout_name: string | null
  has_overrides: boolean
  updated_at: string | null
}

/**
 * Fetches the list of assets that have layout selections (custom layout or overrides).
 * Used by the summary tile drilldown drawers to show exactly which assets are affected.
 *
 * kind = 'custom_layouts' → assets where layout_id is set (non-default)
 * kind = 'overrides'      → assets with field or section overrides
 * kind = 'by_layout'      → assets assigned to a specific layout (requires layoutId)
 *
 * Lazy-loaded: only runs when `enabled` is true (drawer is open).
 */
export function useAffectedAssets(
  kind: 'custom_layouts' | 'overrides' | 'by_layout',
  enabled: boolean,
  layoutId?: string | null,
) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['affected-assets', kind, layoutId ?? null, user?.id],
    queryFn: async (): Promise<AffectedAsset[]> => {
      if (!user?.id) return []

      let query = supabase
        .from(S.tables.selections)
        .select(`
          asset_id,
          layout_id,
          field_overrides,
          section_overrides,
          updated_at,
          asset:assets!user_asset_layout_selections_asset_id_fkey(id, symbol, company_name),
          layout:user_asset_page_layouts!user_asset_layout_selections_layout_id_fkey(id, name)
        `)
        .eq('user_id', user.id)

      // For by_layout, filter at the DB level for efficiency
      if (kind === 'by_layout' && layoutId) {
        query = query.eq('layout_id', layoutId)
      }

      const { data, error } = await query

      if (error) throw error
      if (!data) return []

      return data
        .map(row => {
          const asset = row.asset as any
          const layout = row.layout as any
          if (!asset) return null

          const hasOverrides =
            (Array.isArray(row.field_overrides) && row.field_overrides.length > 0) ||
            (Array.isArray(row.section_overrides) && row.section_overrides.length > 0)

          return {
            asset_id: asset.id,
            symbol: asset.symbol || '???',
            company_name: asset.company_name || '',
            layout_id: row.layout_id,
            layout_name: layout?.name || null,
            has_overrides: hasOverrides,
            updated_at: row.updated_at,
          } as AffectedAsset
        })
        .filter((a): a is AffectedAsset => a !== null)
    },
    enabled: enabled && !!user?.id,
    staleTime: 30_000,
  })
}
