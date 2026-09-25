/**
 * Research Layout: a phone and a desktop must describe the same layout.
 *
 * The canonical artefact is `user_asset_page_layouts.field_config`, a flat
 * `FieldConfigItem[]`. Both editors write it and both read it, so what is
 * pinned here is the round trip, not the interface:
 *
 *   desktop-authored layout opens on mobile
 *   reorder on mobile serialises to a canonical config
 *   a mobile-saved config reopens on desktop unchanged
 *   hiding and showing stays schema-shaped and loses nothing
 *
 * The sharpest risk has its own test: a field ABSENT from field_config is
 * HIDDEN (layout-resolver resolves it to is_visible:false, source
 * 'template-not-listed'). An editor that rebuilt the array from only the rows
 * it rendered would silently hide fields nobody removed.
 */
import { describe, it, expect } from 'vitest'
import {
  buildDraft,
  moveFieldWithinSection,
  moveFieldToSection,
  setFieldVisibility,
  serializeDraft,
  isDraftDirty,
  type DraftSourceField,
  type DraftSourceSection,
} from '../layout-draft'
import type { FieldConfigItem } from '../layout-resolver'

const SECTIONS: DraftSourceSection[] = [
  { id: 'sec-thesis', name: 'Thesis & Risks', display_order: 0 },
  { id: 'sec-forecast', name: 'Forecasts', display_order: 1 },
]

const FIELDS: DraftSourceField[] = [
  { id: 'f-thesis', name: 'Thesis', field_type: 'rich_text', section_id: 'sec-thesis' },
  { id: 'f-risks', name: 'Risks', field_type: 'rich_text', section_id: 'sec-thesis' },
  { id: 'f-model', name: 'Business Model', field_type: 'rich_text', section_id: 'sec-thesis' },
  { id: 'f-rating', name: 'Rating', field_type: 'rating', section_id: 'sec-forecast' },
  { id: 'f-target', name: 'Price Targets', field_type: 'numeric', section_id: 'sec-forecast' },
]

/** A layout as the desktop editor would have written it. */
const DESKTOP_CONFIG: FieldConfigItem[] = [
  { field_id: 'f-risks', section_id: 'sec-thesis', is_visible: true, display_order: 0, is_collapsed: false },
  { field_id: 'f-thesis', section_id: 'sec-thesis', is_visible: true, display_order: 1, is_collapsed: true },
  { field_id: 'f-rating', section_id: 'sec-forecast', is_visible: true, display_order: 0, is_collapsed: false },
]

describe('a desktop-authored layout opens on a phone', () => {
  it('keeps the stored order rather than the alphabetical one', () => {
    const draft = buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG)
    const thesis = draft.find((s) => s.section_id === 'sec-thesis')!

    // Risks before Thesis is the AUTHOR's order, not the alphabet's.
    expect(thesis.fields.map((f) => f.field_id)).toEqual(['f-risks', 'f-thesis', 'f-model'])
  })

  it('carries is_visible and is_collapsed through unchanged', () => {
    const draft = buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG)
    const thesis = draft.find((s) => s.section_id === 'sec-thesis')!

    expect(thesis.fields.find((f) => f.field_id === 'f-thesis')!.is_collapsed).toBe(true)
    // f-model was never listed, so it is off — matching how the resolver
    // treats an unlisted field once a custom template is active.
    expect(thesis.fields.find((f) => f.field_id === 'f-model')!.is_visible).toBe(false)
    expect(thesis.fields.find((f) => f.field_id === 'f-model')!.was_listed).toBe(false)
  })

  it('surfaces every readable field, not only the listed ones', () => {
    // A phone that showed only listed fields could never turn one back on.
    const draft = buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG)
    const all = draft.flatMap((s) => s.fields.map((f) => f.field_id))
    expect(all.sort()).toEqual(['f-model', 'f-rating', 'f-risks', 'f-target', 'f-thesis'])
  })

  it('honours a config that reassigns a field to another section', () => {
    // The desktop's way of saying "moved for this layout". Losing it would
    // move fields home again on the next mobile save.
    const moved: FieldConfigItem[] = [
      { field_id: 'f-rating', section_id: 'sec-thesis', is_visible: true, display_order: 0, is_collapsed: false },
    ]
    const draft = buildDraft(SECTIONS, FIELDS, moved)

    expect(draft.find((s) => s.section_id === 'sec-thesis')!.fields.map((f) => f.field_id))
      .toContain('f-rating')
    expect(draft.find((s) => s.section_id === 'sec-forecast')!.fields.map((f) => f.field_id))
      .not.toContain('f-rating')
  })

  it('orders sections by display_order, not by input order', () => {
    const draft = buildDraft([...SECTIONS].reverse(), FIELDS, DESKTOP_CONFIG)
    expect(draft.map((s) => s.section_id)).toEqual(['sec-thesis', 'sec-forecast'])
  })

  it('skips a field whose section the user cannot read', () => {
    // RLS can hide a section while leaving a field referencing it readable.
    // Dropping it into an arbitrary bucket would fabricate a placement.
    const orphan: DraftSourceField[] = [
      ...FIELDS,
      { id: 'f-orphan', name: 'Orphan', field_type: 'rich_text', section_id: 'sec-invisible' },
    ]
    const draft = buildDraft(SECTIONS, orphan, DESKTOP_CONFIG)
    expect(draft.flatMap((s) => s.fields.map((f) => f.field_id))).not.toContain('f-orphan')
  })
})

describe('the hazard: an unlisted field is hidden, so nothing may be dropped', () => {
  it('keeps an entry for every field the incoming config listed', () => {
    // Serialising only what is visible would drop a deliberately-hidden
    // field, which reads identically today but loses the author's decision.
    const withHidden: FieldConfigItem[] = [
      ...DESKTOP_CONFIG,
      { field_id: 'f-target', section_id: 'sec-forecast', is_visible: false, display_order: 1, is_collapsed: false },
    ]
    const out = serializeDraft(buildDraft(SECTIONS, FIELDS, withHidden))

    expect(out.map((i) => i.field_id).sort()).toEqual(
      ['f-rating', 'f-risks', 'f-target', 'f-thesis'].sort(),
    )
    expect(out.find((i) => i.field_id === 'f-target')!.is_visible).toBe(false)
  })

  it('does not invent entries for fields nobody touched', () => {
    // f-model is readable and unlisted. It must stay unlisted: writing it in
    // would grow the stored array on every mobile open.
    const out = serializeDraft(buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG))
    expect(out.map((i) => i.field_id)).not.toContain('f-model')
    expect(out).toHaveLength(DESKTOP_CONFIG.length)
  })

  it('adds an entry only when the user turns a field on', () => {
    const draft = setFieldVisibility(buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG), 'f-model', true)
    const out = serializeDraft(draft)

    const added = out.find((i) => i.field_id === 'f-model')
    expect(added).toBeDefined()
    expect(added!.is_visible).toBe(true)
    expect(added!.section_id).toBe('sec-thesis')
  })
})

describe('reordering on a phone writes a canonical config', () => {
  it('moves a field up and renumbers display_order densely from zero', () => {
    const draft = moveFieldWithinSection(
      buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG),
      'sec-thesis',
      'f-thesis',
      'up',
    )
    const out = serializeDraft(draft)
    const thesisRows = out.filter((i) => i.section_id === 'sec-thesis')

    expect(thesisRows.map((i) => i.field_id)).toEqual(['f-thesis', 'f-risks'])
    expect(thesisRows.map((i) => i.display_order)).toEqual([0, 1])
  })

  it('moves a field down', () => {
    const draft = moveFieldWithinSection(
      buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG),
      'sec-thesis',
      'f-risks',
      'down',
    )
    const thesis = draft.find((s) => s.section_id === 'sec-thesis')!
    expect(thesis.fields.map((f) => f.field_id)).toEqual(['f-thesis', 'f-risks', 'f-model'])
  })

  it('is a no-op at either end rather than an error', () => {
    const draft = buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG)
    expect(moveFieldWithinSection(draft, 'sec-thesis', 'f-risks', 'up')).toBe(draft)
    expect(moveFieldWithinSection(draft, 'sec-thesis', 'f-model', 'down')).toBe(draft)
    expect(moveFieldWithinSection(draft, 'sec-nope', 'f-risks', 'up')).toBe(draft)
    expect(moveFieldWithinSection(draft, 'sec-thesis', 'f-nope', 'up')).toBe(draft)
  })

  it('does not mutate the draft it was given', () => {
    const draft = buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG)
    const before = draft.map((s) => s.fields.map((f) => f.field_id))
    moveFieldWithinSection(draft, 'sec-thesis', 'f-thesis', 'up')
    expect(draft.map((s) => s.fields.map((f) => f.field_id))).toEqual(before)
  })

  it('moves a field across sections and rewrites its section_id', () => {
    const draft = moveFieldToSection(
      buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG),
      'f-rating',
      'sec-thesis',
    )
    const out = serializeDraft(draft)

    expect(out.find((i) => i.field_id === 'f-rating')!.section_id).toBe('sec-thesis')
    // And it does not linger in the section it left.
    expect(out.filter((i) => i.section_id === 'sec-forecast')).toHaveLength(0)
  })

  it('refuses a cross-section move to a section that does not exist', () => {
    const draft = buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG)
    expect(moveFieldToSection(draft, 'f-rating', 'sec-nope')).toBe(draft)
    expect(moveFieldToSection(draft, 'f-nope', 'sec-thesis')).toBe(draft)
  })
})

describe('a phone-saved layout reopens on the desktop unchanged', () => {
  it('round-trips an untouched layout byte for byte', () => {
    // Opening on a phone and saving without editing must not rewrite the row.
    const out = serializeDraft(buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG))

    const sortKey = (i: FieldConfigItem) => `${i.section_id}:${i.display_order}`
    expect([...out].sort((a, b) => sortKey(a).localeCompare(sortKey(b))))
      .toEqual([...DESKTOP_CONFIG].sort((a, b) => sortKey(a).localeCompare(sortKey(b))))
  })

  it('survives a phone edit reopened and re-serialised as if on desktop', () => {
    const edited = serializeDraft(
      moveFieldWithinSection(
        buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG),
        'sec-thesis',
        'f-thesis',
        'up',
      ),
    )

    // Reopen the phone's output the way the desktop would, then write again.
    const reopened = serializeDraft(buildDraft(SECTIONS, FIELDS, edited))
    expect(reopened).toEqual(edited)
  })

  it('stays stable across repeated open/save cycles', () => {
    // A generator that drifted would grow or reorder the array each pass.
    let cfg = DESKTOP_CONFIG
    for (let i = 0; i < 4; i++) cfg = serializeDraft(buildDraft(SECTIONS, FIELDS, cfg))
    expect(cfg).toEqual(serializeDraft(buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG)))
  })

  it('emits exactly the five canonical keys and nothing else', () => {
    // The phone must not begin writing a key the desktop does not.
    const out = serializeDraft(
      setFieldVisibility(buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG), 'f-model', true),
    )
    for (const item of out) {
      expect(Object.keys(item).sort()).toEqual(
        ['display_order', 'field_id', 'is_collapsed', 'is_visible', 'section_id'],
      )
    }
  })
})

describe('isDraftDirty', () => {
  it('is false for an untouched draft', () => {
    expect(isDraftDirty(buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG), DESKTOP_CONFIG)).toBe(false)
  })

  it('is true after a reorder, a visibility change and a section move', () => {
    const base = buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG)
    expect(isDraftDirty(moveFieldWithinSection(base, 'sec-thesis', 'f-thesis', 'up'), DESKTOP_CONFIG)).toBe(true)
    expect(isDraftDirty(setFieldVisibility(base, 'f-model', true), DESKTOP_CONFIG)).toBe(true)
    expect(isDraftDirty(moveFieldToSection(base, 'f-rating', 'sec-thesis'), DESKTOP_CONFIG)).toBe(true)
  })

  it('is true when a field is turned off, even though the row count holds', () => {
    const off = setFieldVisibility(buildDraft(SECTIONS, FIELDS, DESKTOP_CONFIG), 'f-rating', false)
    expect(isDraftDirty(off, DESKTOP_CONFIG)).toBe(true)
  })
})
