/**
 * The default Research Layout: one derivation, two surfaces.
 *
 * The defect this pins: the default is not a row. It is computed from
 * `SYSTEM_DEFAULT_FIELD_SLUGS` at render time, and a surface that lists only
 * persisted rows never sees it. Desktop computed it inside a 6,300-line
 * component; mobile did not compute it at all, so with no custom layouts a
 * phone said "No saved layouts yet" while a desktop showed "Default" — same
 * query, same data, different derived state.
 *
 * So what is tested here is the derivation itself, plus the withdrawal rule
 * that `is_default` drives on READ even though mobile never writes it.
 */
import { describe, it, expect } from 'vitest'
import {
  SYSTEM_DEFAULT_LAYOUT_ID,
  buildSystemDefaultLayout,
  isSystemDefaultLayout,
  layoutCounts,
  resolveLayoutList,
  type DefaultLayoutSourceField,
} from '../default-layout'
import { SYSTEM_DEFAULT_FIELD_SLUGS } from '../layout-resolver'

/** Two curated slugs, one not curated, in a deliberate order. */
const FIELDS: DefaultLayoutSourceField[] = [
  { field_id: 'f-thesis', field_slug: 'thesis', section_id: 'sec-thesis' },
  { field_id: 'f-custom', field_slug: 'my_custom_field', section_id: 'sec-thesis' },
  { field_id: 'f-risks', field_slug: 'risks_to_thesis', section_id: 'sec-thesis' },
  { field_id: 'f-rating', field_slug: 'rating', section_id: 'sec-forecast' },
]

const stored = (id: string, is_default: boolean, shared = false) => ({
  id, is_default, is_shared_with_me: shared,
})

describe('buildSystemDefaultLayout', () => {
  it('includes only the curated slugs', () => {
    const layout = buildSystemDefaultLayout(FIELDS)
    expect(layout.field_config.map((f) => f.field_id)).toEqual([
      'f-thesis', 'f-risks', 'f-rating',
    ])
    // The custom field is readable but not part of the default.
    expect(layout.field_config.map((f) => f.field_id)).not.toContain('f-custom')
  })

  it('every included slug really is in the curated set', () => {
    // Guards against the filter being inverted or dropped — an unfiltered
    // build would silently make "Default" mean "everything".
    const bySlug = new Map(FIELDS.map((f) => [f.field_id, f.field_slug]))
    for (const item of buildSystemDefaultLayout(FIELDS).field_config) {
      expect(SYSTEM_DEFAULT_FIELD_SLUGS.has(bySlug.get(item.field_id)!)).toBe(true)
    }
  })

  it('marks every field visible and numbers them densely from zero', () => {
    const layout = buildSystemDefaultLayout(FIELDS)
    expect(layout.field_config.every((f) => f.is_visible)).toBe(true)
    expect(layout.field_config.every((f) => f.is_collapsed === false)).toBe(true)
    expect(layout.field_config.map((f) => f.display_order)).toEqual([0, 1, 2])
  })

  it('preserves the caller’s field order, because order IS display_order', () => {
    const reversed = [...FIELDS].reverse()
    expect(buildSystemDefaultLayout(reversed).field_config.map((f) => f.field_id))
      .toEqual(['f-rating', 'f-risks', 'f-thesis'])
  })

  it('carries the sentinel identity the desktop uses', () => {
    const layout = buildSystemDefaultLayout(FIELDS)
    expect(layout.id).toBe(SYSTEM_DEFAULT_LAYOUT_ID)
    expect(layout.name).toBe('Default')
    expect(layout.is_default).toBe(true)
    // No owner and no timestamps: it is not a row and must not look like one.
    expect(layout.user_id).toBe('')
    expect(layout.created_at).toBe('')
  })

  it('emits exactly the canonical FieldConfigItem keys', () => {
    for (const item of buildSystemDefaultLayout(FIELDS).field_config) {
      expect(Object.keys(item).sort()).toEqual(
        ['display_order', 'field_id', 'is_collapsed', 'is_visible', 'section_id'],
      )
    }
  })

  it('is empty when the catalog has none of the curated fields', () => {
    const none = buildSystemDefaultLayout([
      { field_id: 'x', field_slug: 'nope', section_id: 's' },
    ])
    expect(none.field_config).toEqual([])
    // Still a layout, still named Default — an empty default is honest;
    // a missing one is the bug this module exists to fix.
    expect(none.id).toBe(SYSTEM_DEFAULT_LAYOUT_ID)
  })
})

describe('resolveLayoutList — what both surfaces render', () => {
  const sysDefault = buildSystemDefaultLayout(FIELDS)

  it('shows the derived default when the user has no layouts at all', () => {
    // The reported symptom: this list was empty on a phone.
    const list = resolveLayoutList([], sysDefault)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(SYSTEM_DEFAULT_LAYOUT_ID)
  })

  it('shows it alongside custom layouts that are not default', () => {
    const list = resolveLayoutList([stored('a', false), stored('b', false)], sysDefault)
    expect(list.map((l) => l.id)).toEqual([SYSTEM_DEFAULT_LAYOUT_ID, 'a', 'b'])
  })

  it('withdraws it once the user has their own default', () => {
    // Two things called Default is worse than either alone.
    const list = resolveLayoutList([stored('a', true), stored('b', false)], sysDefault)
    expect(list.map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('does NOT withdraw it for somebody else’s shared default', () => {
    // A colleague's default is default for them. Inheriting it would make
    // this user's default vanish because someone else shared a layout.
    const list = resolveLayoutList([stored('shared', true, true)], sysDefault)
    expect(list.map((l) => l.id)).toEqual([SYSTEM_DEFAULT_LAYOUT_ID, 'shared'])
  })

  it('treats null and undefined as an empty list', () => {
    expect(resolveLayoutList(null, sysDefault).map((l) => l.id))
      .toEqual([SYSTEM_DEFAULT_LAYOUT_ID])
    expect(resolveLayoutList(undefined, sysDefault).map((l) => l.id))
      .toEqual([SYSTEM_DEFAULT_LAYOUT_ID])
  })

  it('does not mutate the array it was given', () => {
    const input = [stored('a', false)]
    resolveLayoutList(input, sysDefault)
    expect(input).toHaveLength(1)
  })
})

describe('desktop and mobile resolve the SAME list', () => {
  // Both surfaces pass their own field hook's rows through one mapper, so
  // this simulates each shape arriving at the same place. If these ever
  // disagree, one surface is showing a layout the other cannot.
  const desktopRows = [
    { field_id: 'f-thesis', field_slug: 'thesis', section_id: 'sec-thesis', field_name: 'Thesis' },
    { field_id: 'f-rating', field_slug: 'rating', section_id: 'sec-forecast', field_name: 'Rating' },
  ]
  const mobileRows = [
    { id: 'f-thesis', slug: 'thesis', section_id: 'sec-thesis', name: 'Thesis' },
    { id: 'f-rating', slug: 'rating', section_id: 'sec-forecast', name: 'Rating' },
  ]

  it('produces an identical default from either surface’s field shape', () => {
    const fromDesktop = buildSystemDefaultLayout(
      desktopRows.map((f) => ({
        field_id: f.field_id, field_slug: f.field_slug, section_id: f.section_id,
      })),
    )
    const fromMobile = buildSystemDefaultLayout(
      mobileRows.map((f) => ({
        field_id: f.id, field_slug: f.slug, section_id: f.section_id ?? '',
      })),
    )
    expect(fromMobile).toEqual(fromDesktop)
  })

  it('produces an identical list for the same stored layouts', () => {
    const sys = buildSystemDefaultLayout(FIELDS)
    const layouts = [stored('a', false), stored('shared', true, true)]
    expect(resolveLayoutList(layouts, sys)).toEqual(resolveLayoutList(layouts, sys))
    expect(resolveLayoutList(layouts, sys).map((l) => l.id))
      .toEqual([SYSTEM_DEFAULT_LAYOUT_ID, 'a', 'shared'])
  })
})

describe('isSystemDefaultLayout — the save-path branch', () => {
  it('recognises the derived default', () => {
    expect(isSystemDefaultLayout(buildSystemDefaultLayout(FIELDS))).toBe(true)
    expect(isSystemDefaultLayout({ id: SYSTEM_DEFAULT_LAYOUT_ID })).toBe(true)
  })

  it('does not mistake a stored layout for it', () => {
    expect(isSystemDefaultLayout({ id: 'a-real-uuid' })).toBe(false)
    expect(isSystemDefaultLayout(null)).toBe(false)
    expect(isSystemDefaultLayout(undefined)).toBe(false)
  })
})

describe('layoutCounts', () => {
  it('counts shown, total and distinct sections from field_config', () => {
    expect(layoutCounts([
      { field_id: 'a', section_id: 's1', is_visible: true, display_order: 0, is_collapsed: false },
      { field_id: 'b', section_id: 's1', is_visible: false, display_order: 1, is_collapsed: false },
      { field_id: 'c', section_id: 's2', is_visible: true, display_order: 0, is_collapsed: false },
    ])).toEqual({ shown: 2, total: 3, sections: 2 })
  })

  it('is all zeros for an empty layout', () => {
    expect(layoutCounts([])).toEqual({ shown: 0, total: 0, sections: 0 })
  })
})
