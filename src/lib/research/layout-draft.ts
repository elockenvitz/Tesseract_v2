import type { FieldConfigItem } from './layout-resolver'

/**
 * The editable model behind a Research Layout, for touch.
 *
 * ── What a Research Layout actually is ─────────────────────────────────────
 *
 * `user_asset_page_layouts.field_config` is a flat `FieldConfigItem[]` —
 * `{field_id, section_id, is_visible, display_order, is_collapsed}`. It is not
 * a grid. It says which fields appear, under which section, in what order.
 * That is an ordered list grouped into buckets, which is a thing a phone does
 * well: reorder by moving one row at a time, and toggle a row on or off.
 *
 * So this module turns that flat array into sections-with-fields, applies the
 * edits a phone can express, and serialises back. The desktop grid editor and
 * the phone both write the same `FieldConfigItem[]` through the same
 * `saveLayout`/`updateLayout` mutations; only the gesture differs.
 *
 * ── The hazard this model exists to prevent ────────────────────────────────
 *
 * A field ABSENT from `field_config` is hidden, not defaulted —
 * `layout-resolver.ts` resolves an unlisted field to `is_visible: false` with
 * source `template-not-listed` once a custom template is active. So a naive
 * mobile editor that rebuilt the array from only what it chose to render
 * would silently hide every field it did not know about. Reopening that
 * layout on a desktop would show a layout quietly stripped of fields nobody
 * removed.
 *
 * `serializeDraft` therefore keeps an entry for every field that was in the
 * incoming config, whether or not the phone showed it, whether or not it is
 * visible. It adds an entry only when the user turns a previously unlisted
 * field ON — the one case where a new entry is the user's actual intent.
 * Nothing else is invented and nothing is dropped.
 */

/** One field as the phone edits it. */
export interface DraftField {
  field_id: string
  name: string
  field_type: string
  is_visible: boolean
  is_collapsed: boolean
  /**
   * True when this field had an entry in the incoming `field_config`.
   *
   * Carried so serialisation can tell "the author had an opinion about this
   * field and it was off" apart from "this field was never in this layout" —
   * the two resolve identically today but are different intents, and only the
   * first should keep occupying the stored array.
   */
  was_listed: boolean
}

/** One section with the fields assigned to it, in order. */
export interface DraftSection {
  section_id: string
  name: string
  fields: DraftField[]
}

/** The minimum a caller must supply about a readable field. */
export interface DraftSourceField {
  id: string
  name: string
  field_type: string
  /** The field's home section, used when the config does not reassign it. */
  section_id: string | null
}

/** The minimum a caller must supply about a readable section. */
export interface DraftSourceSection {
  id: string
  name: string
  display_order: number
}

/**
 * Build the editable draft from what RLS let the user read plus the stored
 * config.
 *
 * `fields` and `sections` must be only what the user can actually SELECT —
 * this function does no permission work of its own and will happily lay out
 * anything it is handed.
 *
 * A config entry's `section_id` wins over the field's home section: that is
 * how the desktop expresses "this field was moved into another section for
 * this layout", and dropping it would move fields back on a mobile save.
 */
export function buildDraft(
  sections: DraftSourceSection[],
  fields: DraftSourceField[],
  fieldConfig: FieldConfigItem[],
): DraftSection[] {
  const configByField = new Map<string, FieldConfigItem>()
  for (const item of fieldConfig) configByField.set(item.field_id, item)

  const sectionIds = new Set(sections.map((s) => s.id))
  const ordered = [...sections].sort((a, b) => a.display_order - b.display_order)

  const draft: DraftSection[] = ordered.map((s) => ({
    section_id: s.id,
    name: s.name,
    fields: [],
  }))
  const byId = new Map(draft.map((s) => [s.section_id, s]))

  for (const field of fields) {
    const cfg = configByField.get(field.id)
    // The config's placement wins, then the field's own home section. A field
    // pointing at a section the user cannot read is skipped rather than
    // dropped into an arbitrary bucket.
    const target = cfg?.section_id ?? field.section_id
    if (!target || !sectionIds.has(target)) continue

    byId.get(target)?.fields.push({
      field_id: field.id,
      name: field.name,
      field_type: field.field_type,
      is_visible: cfg?.is_visible ?? false,
      is_collapsed: cfg?.is_collapsed ?? false,
      was_listed: !!cfg,
    })
  }

  // Within a section: the stored order first, then everything the config
  // never positioned, alphabetically so the list is at least stable.
  for (const section of draft) {
    section.fields.sort((a, b) => {
      const ao = configByField.get(a.field_id)?.display_order
      const bo = configByField.get(b.field_id)?.display_order
      if (ao != null && bo != null) return ao - bo
      if (ao != null) return -1
      if (bo != null) return 1
      return a.name.localeCompare(b.name)
    })
  }

  return draft
}

/** Move a field one place up or down inside its own section. */
export function moveFieldWithinSection(
  draft: DraftSection[],
  sectionId: string,
  fieldId: string,
  direction: 'up' | 'down',
): DraftSection[] {
  const sectionIndex = draft.findIndex((s) => s.section_id === sectionId)
  if (sectionIndex === -1) return draft

  const section = draft[sectionIndex]
  const from = section.fields.findIndex((f) => f.field_id === fieldId)
  if (from === -1) return draft

  const to = direction === 'up' ? from - 1 : from + 1
  // At either end this is a no-op, not an error: Move Up on the first row
  // should do nothing rather than throw. The SAME array comes back rather
  // than an equal one, so a React caller re-renders only on a real move.
  if (to < 0 || to >= section.fields.length) return draft

  const fields = [...section.fields]
  const [moved] = fields.splice(from, 1)
  fields.splice(to, 0, moved)

  const next = [...draft]
  next[sectionIndex] = { ...section, fields }
  return next
}

/**
 * Move a field into a different section, at the end of it.
 *
 * The phone equivalent of dragging a card between columns. Appending rather
 * than guessing an insertion point keeps the gesture one tap.
 */
export function moveFieldToSection(
  draft: DraftSection[],
  fieldId: string,
  toSectionId: string,
): DraftSection[] {
  const from = draft.find((s) => s.fields.some((f) => f.field_id === fieldId))
  if (!from || from.section_id === toSectionId) return draft
  if (!draft.some((s) => s.section_id === toSectionId)) return draft

  const field = from.fields.find((f) => f.field_id === fieldId)!
  return draft.map((section) => {
    if (section.section_id === from.section_id) {
      return { ...section, fields: section.fields.filter((f) => f.field_id !== fieldId) }
    }
    if (section.section_id === toSectionId) {
      return { ...section, fields: [...section.fields, field] }
    }
    return section
  })
}

/** Show or hide a field. */
export function setFieldVisibility(
  draft: DraftSection[],
  fieldId: string,
  isVisible: boolean,
): DraftSection[] {
  return draft.map((section) => ({
    ...section,
    fields: section.fields.map((f) =>
      f.field_id === fieldId ? { ...f, is_visible: isVisible } : f,
    ),
  }))
}

/**
 * Serialise the draft back to the canonical `FieldConfigItem[]`.
 *
 * Kept deliberately conservative — see the hazard note at the top of this
 * file. An entry is written when the field was already listed OR the user has
 * turned it on. `display_order` is the field's index among the entries
 * actually written for its section, so the numbers stay dense and match the
 * order the user sees.
 */
export function serializeDraft(draft: DraftSection[]): FieldConfigItem[] {
  const out: FieldConfigItem[] = []

  for (const section of draft) {
    const keep = section.fields.filter((f) => f.was_listed || f.is_visible)
    keep.forEach((field, index) => {
      out.push({
        field_id: field.field_id,
        section_id: section.section_id,
        is_visible: field.is_visible,
        display_order: index,
        is_collapsed: field.is_collapsed,
      })
    })
  }

  return out
}

/** Whether the draft differs from the config it was built from. */
export function isDraftDirty(draft: DraftSection[], original: FieldConfigItem[]): boolean {
  const next = serializeDraft(draft)
  if (next.length !== original.length) return true

  const key = (i: FieldConfigItem) =>
    `${i.field_id}|${i.section_id}|${i.is_visible}|${i.display_order}|${i.is_collapsed}`
  const before = new Set(original.map(key))
  return next.some((i) => !before.has(key(i)))
}
