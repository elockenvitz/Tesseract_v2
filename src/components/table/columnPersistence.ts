/**
 * Saved column layout: what is kept, and when a new default is allowed to win.
 *
 * Extracted from `AssetTableView` so it can be tested at all. Two defects are
 * encoded here, both of which were invisible in review.
 *
 * ── 1. A new default could never reach anyone ─────────────────────────────
 *
 * A surface's curated default (`columnPreset`) could not reach a reader who
 * had saved column state, because the merge took `visible` from storage
 * unconditionally — and the persist effect writes on every mount, so after one
 * render that is everyone. The columns appeared in the new ORDER, which made
 * it look as though the preset had run.
 *
 * Bumping the storage key "fixes" that once, discards every width and pin the
 * reader chose, and has to be bumped again for every future change. So the
 * preset's version travels inside the blob instead.
 *
 * ── 2. ...and then the bump threw away everything ─────────────────────────
 *
 * The first fix was all-or-nothing: on a version mismatch the whole stored
 * layout was dropped for the new baseline. A reader who had widened Work,
 * pinned the ticker and turned Coverage back on lost all three because an
 * unrelated column was folded into another.
 *
 * So the blob also records the DEFAULTS that were in force when it was
 * written, and a bump is a three-way merge:
 *
 *   saved === old default   the reader never touched it   → take the new default
 *   saved !== old default   the reader chose it           → keep their choice
 *
 * which is the only way to tell a deliberate customisation from a default that
 * happens to still be sitting there. A blob from before defaults were recorded
 * cannot be diffed, so it falls back to taking the new baseline — the old
 * behaviour, and the honest one, since nothing in it can be attributed.
 *
 * Only id/visible/width/pinned are persisted. Storing whole column objects
 * froze labels and widths that later changed in code.
 */

export interface PersistedColumn {
  id: string
  visible: boolean
  width: number
  pinned: boolean
}

export interface PersistedColumns {
  /** The `columnPresetVersion` in force when this was written. */
  v: string | null
  columns: PersistedColumn[]
  /**
   * The baseline this layout was written against.
   *
   * Lets a later version bump tell "the reader chose this" from "this is just
   * what the default happened to be". Absent on blobs written before this
   * existed; see the fallback in `mergeSavedColumns`.
   */
  d?: PersistedColumn[]
}

/** What a column must look like for the merge. The real type has more. */
interface MergeableColumn {
  id: string
  visible: boolean
  width: number
  pinned: boolean
}

const sameAs = (a: PersistedColumn, b: MergeableColumn) =>
  a.visible === b.visible && a.width === b.width && a.pinned === b.pinned

/**
 * Apply a saved layout over a baseline.
 *
 * @param base    the surface's baseline — built-ins plus extras, preset applied
 * @param raw     whatever was in storage, already JSON-parsed. A bare array is
 *                the pre-versioning shape and is treated as version `null`.
 * @param version the current preset version, or null/undefined for surfaces
 *                with no preset
 *
 * Returns `base` untouched when there is nothing usable to apply, so the
 * caller can use the result directly as initial state.
 */
export function mergeSavedColumns<T extends MergeableColumn>(
  base: T[],
  raw: unknown,
  version: string | null | undefined,
): T[] {
  if (!raw) return base

  // A bare array predates versioning. It cannot have been written by any
  // preset, so when one exists the stored layout is by definition stale.
  const isLegacyArray = Array.isArray(raw)
  const storedVersion: string | null = isLegacyArray
    ? null
    : (raw as PersistedColumns)?.v ?? null
  const stored: PersistedColumn[] = isLegacyArray
    ? (raw as PersistedColumn[])
    : (raw as PersistedColumns)?.columns ?? []
  const wasDefault: PersistedColumn[] | undefined = isLegacyArray
    ? undefined
    : (raw as PersistedColumns)?.d

  if (stored.length === 0) return base

  const savedById = new Map(stored.map(c => [c.id, c]))

  // Same preset: the stored layout IS the reader's layout, in full.
  if ((version ?? null) === storedVersion) {
    return base.map(col => {
      const saved = savedById.get(col.id)
      return saved
        ? { ...col, visible: saved.visible, width: saved.width, pinned: saved.pinned }
        : col
    })
  }

  /*
   * A new preset, and no record of what the old one wanted.
   *
   * Nothing in the blob can be attributed to the reader rather than to a
   * baseline they never saw, so the new default takes the surface whole. This
   * is the pre-migration behaviour and the only honest answer here.
   */
  if (!wasDefault || wasDefault.length === 0) return base

  // A new preset, and we know what the old one wanted: keep only what the
  // reader actually changed, and let the new default win everywhere else.
  const defaultById = new Map(wasDefault.map(c => [c.id, c]))
  return base.map(col => {
    const saved = savedById.get(col.id)
    if (!saved) return col
    const prevDefault = defaultById.get(col.id)
    // A column the old baseline never mentioned cannot be diffed either.
    if (!prevDefault) return col
    if (sameAs(saved, prevDefault)) return col

    /*
     * Field by field, not row by row.
     *
     * A reader who only widened a column should still receive the new
     * default's visibility for it. Treating the row as one unit would hand
     * them a stale `visible` as the price of a width they liked.
     */
    return {
      ...col,
      visible: saved.visible === prevDefault.visible ? col.visible : saved.visible,
      width: saved.width === prevDefault.width ? col.width : saved.width,
      pinned: saved.pinned === prevDefault.pinned ? col.pinned : saved.pinned,
    }
  })
}

/**
 * The blob to store.
 *
 * Stamped with the preset version AND the baseline it was written against, so
 * the next bump can tell a reader's choice from an untouched default. `base`
 * is optional only so a caller without a preset can omit it; a surface that
 * has one must pass it or its readers lose their customisations at the next
 * version change.
 */
export function serializeColumns<T extends MergeableColumn>(
  columns: T[],
  version: string | null | undefined,
  base?: readonly T[],
): PersistedColumns {
  const strip = (c: MergeableColumn): PersistedColumn =>
    ({ id: c.id, visible: c.visible, width: c.width, pinned: c.pinned })
  return {
    v: version ?? null,
    columns: columns.map(strip),
    ...(base ? { d: base.map(strip) } : {}),
  }
}
