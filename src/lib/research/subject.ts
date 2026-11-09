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
  /**
   * The SECURITY DEFINER function that writes a selection.
   *
   * Every customization save goes through this rather than through a direct
   * table write, because it does four things a client cannot: it creates new
   * sections in the org library and maps their temp ids into the overrides in
   * one transaction, it enforces the optimistic version check, it writes the
   * audit event, and it authorizes the template.
   *
   * `save_theme_layout_customization` is deliberately NOT a copy of the asset
   * one. The asset function resolves the organization with
   * `organization_memberships ... LIMIT 1` (arbitrary for a multi-org user)
   * and inlines the collaboration subquery that is the documented cross-org
   * layout-sharing leak. The theme one reads the organization from the theme
   * and calls `theme_layout_access`.
   */
  readonly saveCustomizationFn:
    | 'save_asset_layout_customization'
    | 'save_theme_layout_customization'
  /** That function's first parameter, which names the subject. */
  readonly saveCustomizationSubjectParam: 'p_asset_id' | 'p_theme_id'
}

/**
 * The PostgREST embeds, spelled out per subject.
 *
 * ── Why these cannot be built from the table names ────────────────────────
 *
 * An embed names a FOREIGN KEY CONSTRAINT, not just a table, and the
 * constraint names are not derivable: the selection-to-layout FK is
 * `user_asset_layout_selections_layout_id_fkey` on one side and
 * `user_theme_layout_selections_layout_id_fkey` on the other, and the
 * collaboration one is `layout_collaborations_layout_id_fkey` against
 * `theme_layout_collaborations_layout_id_fkey`. Every name here was read out
 * of `pg_constraint`, not guessed.
 *
 * ── Why getting one wrong is worse than it looks ──────────────────────────
 *
 * An UNKNOWN embedded relation is HTTP 400 on the WHOLE request, not an
 * empty embed. Pointing the theme page's field catalogue at
 * `research_sections!inner` does not return fields without sections, it
 * returns nothing at all and the research surface goes blank. That exact
 * mistake shipped once already on `theme_contributions_v2`.
 *
 * ── The aliases are deliberately identical across subjects ────────────────
 *
 * `research_sections:` keeps its asset-shaped name on both sides, because
 * three call sites read the embed back off the row by that property name.
 * Aliasing is what makes the response shape subject-independent; renaming it
 * per subject would push the difference back out into the component.
 */
export interface ResearchSubjectEmbeds {
  /** The layout joined onto a selection row. */
  readonly selectionLayout: string
  /** The section joined onto a catalogue field row, inner. */
  readonly fieldSection: string
  /** The layout joined onto a collaboration row. */
  readonly collaborationLayout: string
}

export interface ResearchSubjectDescriptor {
  readonly kind: ResearchSubjectKind
  /** The column naming the subject in every per-subject table. */
  readonly subjectColumn: 'asset_id' | 'theme_id'
  /** First element of every React Query key built for this subject. */
  readonly queryKeyPrefix: 'asset-research' | 'theme-research'
  readonly tables: ResearchSubjectTables
  readonly embeds: ResearchSubjectEmbeds
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
    saveCustomizationFn: 'save_asset_layout_customization',
    saveCustomizationSubjectParam: 'p_asset_id',
  },
  embeds: {
    selectionLayout:
      'layout:user_asset_page_layouts!user_asset_layout_selections_layout_id_fkey(*)',
    fieldSection: 'research_sections!inner',
    collaborationLayout:
      'layout:user_asset_page_layouts!layout_collaborations_layout_id_fkey(*)',
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
    saveCustomizationFn: 'save_theme_layout_customization',
    saveCustomizationSubjectParam: 'p_theme_id',
  },
  embeds: {
    selectionLayout:
      'layout:user_theme_page_layouts!user_theme_layout_selections_layout_id_fkey(*)',
    /* The ALIAS stays `research_sections` on purpose; see the note on
       `ResearchSubjectEmbeds`. Three call sites read the embed back off the
       row by that property name, so the response shape must not vary. */
    fieldSection: 'research_sections:theme_research_sections!inner',
    collaborationLayout:
      'layout:user_theme_page_layouts!theme_layout_collaborations_layout_id_fkey(*)',
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
