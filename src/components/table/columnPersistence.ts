/**
 * Saved column layout: what is kept, and when a new default is allowed to win.
 *
 * Extracted from `AssetTableView` so it can be tested at all. The bug this
 * encodes was invisible in review and cost a full cycle:
 *
 *   A surface's curated default (`columnPreset`) could never reach anyone who
 *   had saved column state, because the merge took `visible` from storage
 *   unconditionally — and the persist effect writes on every mount, so after
 *   one render that is everyone. The columns appeared in the new ORDER, which
 *   made it look as though the preset had run.
 *
 * Bumping the storage key "fixes" it once and discards the widths and pins the
 * reader chose, and has to be bumped again for every future change. So the
 * preset's version travels inside the blob instead: a mismatch takes the new
 * baseline exactly once, and anything the reader changes afterwards sticks.
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
}

/** What a column must look like for the merge. The real type has more. */
interface MergeableColumn {
  id: string
  visible: boolean
  width: number
  pinned: boolean
}

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

  if (stored.length === 0) return base
  if ((version ?? null) !== storedVersion) return base

  return base.map(defaultCol => {
    const savedCol = stored.find(c => c.id === defaultCol.id)
    if (!savedCol) return defaultCol
    return {
      ...defaultCol,
      visible: savedCol.visible,
      width: savedCol.width,
      pinned: savedCol.pinned,
    }
  })
}

/** The blob to store. Stamped so `mergeSavedColumns` can judge it later. */
export function serializeColumns<T extends MergeableColumn>(
  columns: T[],
  version: string | null | undefined,
): PersistedColumns {
  return {
    v: version ?? null,
    columns: columns.map(c => ({
      id: c.id, visible: c.visible, width: c.width, pinned: c.pinned,
    })),
  }
}
