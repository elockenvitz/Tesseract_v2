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

  it('preserves the caller’s field order when no section position is given', () => {
    // The original contract, kept for callers that cannot say where their
    // sections sit. FIELDS carries no section_display_order, so this is the
    // untouched path.
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

/*
 * The defect these pin.
 *
 * The Default template screen listed Forecasts & Estimates, then Catalysts &
 * Events, then Thesis & Risks. The asset page that template describes listed
 * Thesis & Risks, Catalysts & Events, Forecasts & Estimates. Nobody chose
 * either order.
 *
 * The page sorts by the SECTION's display_order. The template screen groups
 * sections by the first field it meets while walking `field_config` in
 * `display_order`, and `display_order` here was the array index — so it was
 * the arrival order of the catalogue query. That query sorts on the FIELD's
 * display_order, which is only meaningful within a section, and in the live
 * database the first field of all three sections carries 0. Three tied rows,
 * order picked by Postgres, and the template screen reported whichever came
 * back first.
 *
 * ARRIVAL_WORST_CASE below is that tie resolved the unlucky way.
 */
describe('section order is stated, not inherited from the caller’s sort', () => {
  /** Section positions as the asset page sees them. */
  const THESIS = 0
  const CATALYSTS = 1
  const FORECASTS = 2

  /** The eight curated fields, as the catalogue handed them over. */
  const ARRIVAL_WORST_CASE: DefaultLayoutSourceField[] = [
    // All three of these are display_order 0 in their own section; the tie
    // came back Forecasts-first, which is exactly what went wrong.
    { field_id: 'f-rating', field_slug: 'rating', section_id: 'sec-forecast', section_display_order: FORECASTS, field_display_order: 0 },
    { field_id: 'f-catalysts', field_slug: 'key_catalysts', section_id: 'sec-catalyst', section_display_order: CATALYSTS, field_display_order: 0 },
    { field_id: 'f-business', field_slug: 'business_model', section_id: 'sec-thesis', section_display_order: THESIS, field_display_order: 0 },
    { field_id: 'f-targets', field_slug: 'price_targets', section_id: 'sec-forecast', section_display_order: FORECASTS, field_display_order: 1 },
    { field_id: 'f-thesis', field_slug: 'thesis', section_id: 'sec-thesis', section_display_order: THESIS, field_display_order: 1 },
    { field_id: 'f-estimates', field_slug: 'estimates', section_id: 'sec-forecast', section_display_order: FORECASTS, field_display_order: 2 },
    { field_id: 'f-different', field_slug: 'where_different', section_id: 'sec-thesis', section_display_order: THESIS, field_display_order: 2 },
    { field_id: 'f-risks', field_slug: 'risks_to_thesis', section_id: 'sec-thesis', section_display_order: THESIS, field_display_order: 3 },
  ]

  /** Which section each `field_config` row belongs to, in emitted order. */
  const sectionsInOrder = (fields: DefaultLayoutSourceField[]): string[] => {
    const seen: string[] = []
    for (const item of buildSystemDefaultLayout(fields).field_config) {
      if (seen[seen.length - 1] !== item.section_id) seen.push(item.section_id)
    }
    return seen
  }

  it('puts the sections in the order the asset page puts them', () => {
    expect(sectionsInOrder(ARRIVAL_WORST_CASE))
      .toEqual(['sec-thesis', 'sec-catalyst', 'sec-forecast'])
  })

  it('keeps each section’s fields together, in their own order', () => {
    expect(buildSystemDefaultLayout(ARRIVAL_WORST_CASE).field_config.map((f) => f.field_id))
      .toEqual([
        'f-business', 'f-thesis', 'f-different', 'f-risks',
        'f-catalysts',
        'f-rating', 'f-targets', 'f-estimates',
      ])
  })

  it('gives the same answer whatever order the catalogue arrives in', () => {
    // This is the whole point: a tie decided differently must not change the
    // template. Three shuffles that a real query could plausibly return.
    const first = buildSystemDefaultLayout(ARRIVAL_WORST_CASE).field_config
    for (const shuffle of [
      [...ARRIVAL_WORST_CASE].reverse(),
      [...ARRIVAL_WORST_CASE].sort((a, b) => a.field_slug.localeCompare(b.field_slug)),
      [...ARRIVAL_WORST_CASE].sort((a, b) => b.field_id.localeCompare(a.field_id)),
    ]) {
      expect(buildSystemDefaultLayout(shuffle).field_config).toEqual(first)
    }
  })

  it('still numbers display_order densely from zero after sorting', () => {
    expect(buildSystemDefaultLayout(ARRIVAL_WORST_CASE).field_config.map((f) => f.display_order))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('falls back to input order if even one field cannot say where it sits', () => {
    /*
     * All or nothing, deliberately. A field with no section position would
     * sort to the front of a list it knows nothing about — worse than the
     * old behaviour, because it would look deliberate.
     */
    const incomplete = ARRIVAL_WORST_CASE.map((f, i) =>
      i === 0 ? { ...f, section_display_order: undefined } : f,
    )
    expect(buildSystemDefaultLayout(incomplete).field_config[0].field_id).toBe('f-rating')
  })

  it('ignores the position of a field that is not in the default', () => {
    // A non-curated field sorting first must not drag its section to the top.
    const withIntruder: DefaultLayoutSourceField[] = [
      { field_id: 'f-custom', field_slug: 'my_custom_field', section_id: 'sec-zzz', section_display_order: -5, field_display_order: 0 },
      ...ARRIVAL_WORST_CASE,
    ]
    expect(sectionsInOrder(withIntruder))
      .toEqual(['sec-thesis', 'sec-catalyst', 'sec-forecast'])
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
  /*
   * These rows are in each surface's OWN natural order, not a shared one.
   *
   * The previous version of this test handed both calls the same two rows in
   * the same sequence, so it could only ever check the shape mapping. It
   * passed throughout, while the two surfaces genuinely disagreed: the desktop
   * catalogue sorts by the field's display_order, `useResearchFields` sorts by
   * name, and the index was the default's order. Same fields, two orders.
   */
  const SECTIONS = { 'sec-thesis': 0, 'sec-forecast': 2 } as const

  // Desktop: sorted by the field's own display_order. Rating is 0 in its
  // section and Thesis is 1 in its own, so Rating arrives first.
  const desktopRows = [
    { field_id: 'f-rating', field_slug: 'rating', section_id: 'sec-forecast', field_name: 'Rating', display_order: 0 },
    { field_id: 'f-thesis', field_slug: 'thesis', section_id: 'sec-thesis', field_name: 'Thesis', display_order: 1 },
  ] as const

  // Mobile: sorted by name. "Rating" < "Thesis", same arrival, different reason.
  const mobileRows = [
    { id: 'f-rating', slug: 'rating', section_id: 'sec-forecast', name: 'Rating', display_order: 0 },
    { id: 'f-thesis', slug: 'thesis', section_id: 'sec-thesis', name: 'Thesis', display_order: 1 },
  ] as const

  it('produces an identical default from either surface’s field shape', () => {
    const fromDesktop = buildSystemDefaultLayout(
      desktopRows.map((f) => ({
        field_id: f.field_id, field_slug: f.field_slug, section_id: f.section_id,
        section_display_order: SECTIONS[f.section_id],
        field_display_order: f.display_order,
      })),
    )
    const fromMobile = buildSystemDefaultLayout(
      mobileRows.map((f) => ({
        field_id: f.id, field_slug: f.slug, section_id: f.section_id ?? '',
        section_display_order: SECTIONS[f.section_id],
        field_display_order: f.display_order,
      })),
    )
    expect(fromMobile).toEqual(fromDesktop)
  })

  it('agrees on ORDER, not just on which fields are in', () => {
    // Both surfaces hand over Rating first. Thesis must still come first,
    // because its section does.
    const fromMobile = buildSystemDefaultLayout(
      mobileRows.map((f) => ({
        field_id: f.id, field_slug: f.slug, section_id: f.section_id ?? '',
        section_display_order: SECTIONS[f.section_id],
        field_display_order: f.display_order,
      })),
    )
    expect(fromMobile.field_config.map((f) => f.field_id)).toEqual(['f-thesis', 'f-rating'])
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
