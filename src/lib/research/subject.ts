/**
 * What a research page is a page OF.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The Asset page's research stack is written against one subject, spelled out
 * in string literals: `from('user_asset_layout_selections')`,
 * `.eq('asset_id', assetId)`, `['asset-layout-selection', assetId]`. The
 * Theme page needs the same stack against its own tables, and there are only
 * two honest ways to get there:
 *
 *   1. copy the query layer and keep two of them in sync by hand
 *   2. name the differences once and pass them in
 *
 * This is (2). The differences are entirely table names and one column name:
 * every TYPE involved -- `SavedLayout`, `FieldConfigItem`, `FieldOverride`,
 * `SectionOverride`, `FieldWithPreference` -- already mentions no subject at
 * all, and the resolver in `layout-resolver.ts` is already pure. So the only
 * thing standing between the Asset page's customizer and a theme is which
 * rows the queries read.
 *
 * ── What is deliberately NOT in here ──────────────────────────────────────
 *
 * No queries, no React, no Supabase import. A descriptor is data. The point
 * is that a reader can see the whole difference between the two subjects on
 * one screen, which is impossible if the difference is spread across 51 call
 * sites.
 *
 * ── The query-key rule, which is load bearing ─────────────────────────────
 *
 * `queryKeyPrefix` is not decoration. React Query caches by key, and an asset
 * id and a theme id are both uuids: a key of `['layout-selection', id]` would
 * let a theme's selection row answer an asset's query if the ids ever matched,
 * and -- far more likely -- makes two differently SHAPED cache entries
 * indistinguishable in the devtools and in an invalidation. Every key built
 * for a subject starts with its prefix.
 */

export type ResearchSubjectKind = 'asset' | 'theme'

/**
 * The tables and the one column that differ between an asset's research page
 * and a theme's.
 *
 * Every name here is spelled as the literal that is actually in the database,
 * verified against `information_schema` rather than inferred from the
 * migrations -- the migrations in this repo do not describe production.
 */
export interface ResearchSubjectTables {
  /** Org-level section library. Identical column-for-column across subjects. */
  readonly sections: 'research_sections' | 'theme_research_sections'
  /**
   * Org-level field library. `theme_research_fields` carries an extra
   * `placeholder` and, since 20261104150000, the `category` and
   * `suggested_section` the library groups by.
   */
  readonly fields: 'research_fields' | 'theme_research_fields'
  /** Rich-text values, one row per (field, subject, author). */
  readonly contributions: 'asset_contributions' | 'theme_contributions_v2'
  /** A named template: which fields, in which sections, at what width. */
  readonly layouts: 'user_asset_page_layouts' | 'user_theme_page_layouts'
  /** Which template a given subject is using, plus that subject's overrides. */
  readonly selections: 'user_asset_layout_selections' | 'user_theme_layout_selections'
  /** Who else can see or edit a template. */
  readonly layoutCollaborations: 'layout_collaborations' | 'theme_layout_collaborations'
  /** The SECURITY DEFINER predicate the layout policies call. */
  readonly layoutAccessFn: 'user_has_layout_access' | 'theme_layout_access'
}

export interface ResearchSubjectDescriptor {
  readonly kind: ResearchSubjectKind
  /** The column naming the subject in every per-subject table. */
  readonly subjectColumn: 'asset_id' | 'theme_id'
  /** First element of every React Query key built for this subject. */
  readonly queryKeyPrefix: 'asset-research' | 'theme-research'
  readonly tables: ResearchSubjectTables
  /**
   * Whether a template row carries `organization_id`.
   *
   * It is `false` for assets and `true` for themes, and that is not an
   * oversight on either side. `user_asset_page_layouts` has no organization
   * column, which is precisely why its sharing leaks: a
   * `layout_collaborations` row with user_id, team_id and org_node_id all
   * NULL means "organization-wide", and `user_has_layout_access` has nowhere
   * to write the organization predicate, so it treats that row as a grant to
   * any authenticated caller. The theme tables carry the column and
   * `theme_layout_access` requires active membership of the layout's own
   * organization before any grant counts.
   *
   * Code that writes a layout must consult this rather than assume, because
   * sending `organization_id` to the asset table is an error and omitting it
   * from the theme table violates NOT NULL.
   */
  readonly layoutsAreOrgScoped: boolean
}

/**
 * The asset descriptor.
 *
 * These names are the literals `useUserAssetPagePreferences`,
 * `useUserAssetPageLayouts` and `useResearchFields` already use. A test pins
 * that, so this descriptor cannot drift away from the queries it describes
 * while both still compile.
 */
export const ASSET_RESEARCH_SUBJECT: ResearchSubjectDescriptor = {
  kind: 'asset',
  subjectColumn: 'asset_id',
  queryKeyPrefix: 'asset-research',
  tables: {
    sections: 'research_sections',
    fields: 'research_fields',
    contributions: 'asset_contributions',
    layouts: 'user_asset_page_layouts',
    selections: 'user_asset_layout_selections',
    layoutCollaborations: 'layout_collaborations',
    layoutAccessFn: 'user_has_layout_access',
  },
  layoutsAreOrgScoped: false,
}

/**
 * The theme descriptor.
 *
 * `user_theme_page_layouts`, `user_theme_layout_selections`,
 * `theme_layout_collaborations` and `theme_layout_access` were added by
 * 20261104150001_theme_page_layouts, with a cross-org isolation test in
 * `supabase/tests/theme-page-layouts-tenant-isolation.sql`.
 */
export const THEME_RESEARCH_SUBJECT: ResearchSubjectDescriptor = {
  kind: 'theme',
  subjectColumn: 'theme_id',
  queryKeyPrefix: 'theme-research',
  tables: {
    sections: 'theme_research_sections',
    fields: 'theme_research_fields',
    contributions: 'theme_contributions_v2',
    layouts: 'user_theme_page_layouts',
    selections: 'user_theme_layout_selections',
    layoutCollaborations: 'theme_layout_collaborations',
    layoutAccessFn: 'theme_layout_access',
  },
  layoutsAreOrgScoped: true,
}

export const RESEARCH_SUBJECTS: Record<ResearchSubjectKind, ResearchSubjectDescriptor> = {
  asset: ASSET_RESEARCH_SUBJECT,
  theme: THEME_RESEARCH_SUBJECT,
}

/**
 * A subject, which is a descriptor plus the id of the thing being read.
 *
 * `id` may be undefined: both pages mount their research surface before the
 * subject resolves, and the hooks already treat a missing id as "the library
 * only, with no per-subject overrides".
 */
export interface ResearchSubject {
  readonly descriptor: ResearchSubjectDescriptor
  readonly id: string | undefined
}

export function assetSubject(assetId: string | undefined): ResearchSubject {
  return { descriptor: ASSET_RESEARCH_SUBJECT, id: assetId }
}

export function themeSubject(themeId: string | undefined): ResearchSubject {
  return { descriptor: THEME_RESEARCH_SUBJECT, id: themeId }
}

/**
 * A React Query key for a subject.
 *
 * Always via this function, never by hand, so no key can be written without
 * its prefix. See the note at the top on why that matters.
 */
export function subjectQueryKey(
  subject: ResearchSubject,
  name: string,
  ...rest: readonly (string | number | boolean | null | undefined)[]
): readonly unknown[] {
  return [subject.descriptor.queryKeyPrefix, name, subject.id, ...rest]
}

/**
 * Lookup by kind, for the few places that hold a kind rather than a subject
 * (a persisted tab value, a route param). Uses `hasOwnProperty` rather than
 * `in`, which would resolve 'toString' on this object literal and hand back
 * a function.
 */
export function researchSubjectOf(kind: string | null | undefined): ResearchSubjectDescriptor | null {
  if (typeof kind !== 'string') return null
  return Object.prototype.hasOwnProperty.call(RESEARCH_SUBJECTS, kind)
    ? RESEARCH_SUBJECTS[kind as ResearchSubjectKind]
    : null
}
