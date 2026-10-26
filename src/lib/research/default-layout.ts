import { SYSTEM_DEFAULT_FIELD_SLUGS } from './layout-resolver'
import type { FieldConfigItem } from './layout-resolver'

/**
 * The default Research Layout — the one that is not a row.
 *
 * ── What it actually is ────────────────────────────────────────────────────
 *
 * There is no `user_asset_page_layouts` row for "Default". It is DERIVED:
 * the curated slugs in `SYSTEM_DEFAULT_FIELD_SLUGS`, resolved against the
 * fields this user can read, assembled into a `SavedLayout` shape at render
 * time. It has no id in the database; it carries the sentinel id below.
 *
 * That is correct and deliberate — the default is a RULE, not a record, so
 * it follows the field catalog instead of going stale beside it. But it
 * means a surface only sees the default if it computes the default. The
 * mobile editor listed persisted rows and nothing else, so with no custom
 * layouts a phone said "No saved layouts yet" while a desktop showed
 * "Default". Same query, same data, different derived state.
 *
 * This module is that derivation, extracted so both surfaces share one copy.
 *
 * ── Why `is_default` matters for READS ─────────────────────────────────────
 *
 * The virtual default is WITHDRAWN once the user has their own default:
 * `resolveLayoutList` drops it when any owned layout carries
 * `is_default = true`. Two things called Default in one list is a worse
 * answer than either one alone.
 *
 * So a surface must read `is_default` even though — per the Files/Templates
 * product decision — mobile never WRITES it. Reading it and writing it are
 * different permissions on the same column, and only the write is deferred.
 *
 * ── What it is not ─────────────────────────────────────────────────────────
 *
 * Not seeded, not persisted, not fabricated. Nothing here inserts a row, and
 * the sentinel id is never sent to the database — `isSystemDefaultLayout`
 * exists so callers can branch before a save, because saving the default has
 * to CREATE the user's own layout rather than update an id that does not
 * exist.
 */

/** Sentinel id for the derived default. Never a database id. */
export const SYSTEM_DEFAULT_LAYOUT_ID = 'system-default'

/** The shape any caller can supply, from either surface's field hook. */
export interface DefaultLayoutSourceField {
  field_id: string
  field_slug: string
  section_id: string
  /**
   * Where this field's SECTION sits, and where the field sits inside it.
   *
   * Optional because order used to be the caller's business: this function
   * stamped `display_order` from the array index, so whatever sort a hook
   * happened to apply became the default template's order. The two callers
   * applied different ones — desktop sorted by the field's own
   * `display_order`, mobile by name — so the "same default on both surfaces"
   * this module exists to guarantee held for membership but not for order.
   *
   * Supply both and the default is sorted here, by section and then by field,
   * which is the order a reader sees on the asset page. Supply neither and
   * input order is preserved exactly as before.
   */
  section_display_order?: number
  field_display_order?: number
}

/** Matches `SavedLayout` in useUserAssetPagePreferences, structurally. */
export interface SystemDefaultLayout {
  id: string
  user_id: string
  name: string
  description: string | null
  is_default: boolean
  field_config: FieldConfigItem[]
  created_at: string
  updated_at: string
}

/** True when this layout is the derived default rather than a stored row. */
export function isSystemDefaultLayout(layout: { id: string } | null | undefined): boolean {
  return layout?.id === SYSTEM_DEFAULT_LAYOUT_ID
}

/**
 * Build the derived default from the fields this user can read.
 *
 * Transcribed from `createVirtualDefaultLayout` in ResearchFieldsManager so
 * desktop behaviour is identical by construction: same slug filter, same
 * `is_visible: true`, same `display_order` by index, same
 * `is_collapsed: false`, same name and description.
 *
 * Order comes from `section_display_order` / `field_display_order` when every
 * surviving field carries a section position, and otherwise from input order
 * exactly as before — `display_order` is still the index either way.
 *
 * It had to stop being purely the caller's order. `display_order: idx` off an
 * unsorted list meant the editor, which groups sections by first appearance,
 * reported whichever section owned the first row. The asset-page catalogue
 * ties three fields at `display_order` 0 (one per section), so that row was
 * Postgres's choice, and the Default template listed Forecasts & Estimates
 * first while the page it describes listed Thesis & Risks first.
 */
export function buildSystemDefaultLayout(
  fields: readonly DefaultLayoutSourceField[],
): SystemDefaultLayout {
  const selected = fields.filter((f) => SYSTEM_DEFAULT_FIELD_SLUGS.has(f.field_slug))

  /*
   * All or nothing: one field without a section position would sort to the
   * front of a list it knows nothing about. A caller that cannot say where
   * its sections sit keeps the old contract instead.
   */
  const positioned = selected.every((f) => typeof f.section_display_order === 'number')

  const defaultFields = positioned
    ? [...selected].sort(
        (a, b) =>
          (a.section_display_order as number) - (b.section_display_order as number) ||
          (a.field_display_order ?? 0) - (b.field_display_order ?? 0),
      )
    : selected

  return {
    id: SYSTEM_DEFAULT_LAYOUT_ID,
    user_id: '',
    name: 'Default',
    description: 'Standard research layout with thesis, forecasts, catalysts & documents',
    is_default: true,
    field_config: defaultFields.map((f, idx) => ({
      field_id: f.field_id,
      section_id: f.section_id,
      is_visible: true,
      display_order: idx,
      is_collapsed: false,
    })),
    created_at: '',
    updated_at: '',
  }
}

/** The minimum a caller must tell us about a stored layout. */
export interface StoredLayoutLike {
  id: string
  is_default: boolean
  is_shared_with_me?: boolean
}

/**
 * The list a surface should show: stored layouts, plus the derived default
 * when — and only when — the user has no default of their own.
 *
 * `is_shared_with_me` is excluded from the "do they have a default?" test on
 * purpose. Somebody else's default is default for THEM; inheriting it would
 * silently withdraw this user's default because a colleague shared a layout.
 *
 * Returns the same array contents both surfaces render, so "desktop and
 * mobile show the same layouts" is one function rather than two agreements.
 */
export function resolveLayoutList<T extends StoredLayoutLike>(
  layouts: readonly T[] | null | undefined,
  systemDefault: SystemDefaultLayout,
): (T | SystemDefaultLayout)[] {
  const raw = layouts ?? []
  const hasOwnDefault = raw.some((l) => !l.is_shared_with_me && l.is_default)
  return hasOwnDefault ? [...raw] : [systemDefault, ...raw]
}

/**
 * How many fields a layout shows, and out of how many.
 *
 * Both numbers come from `field_config` rather than from the catalog: a
 * layout's own array is what it claims, and counting the catalog instead
 * would report fields the layout has never heard of.
 */
export function layoutCounts(field_config: readonly FieldConfigItem[]): {
  shown: number
  total: number
  sections: number
} {
  return {
    shown: field_config.filter((f) => f.is_visible).length,
    total: field_config.length,
    sections: new Set(field_config.map((f) => f.section_id)).size,
  }
}
