/**
 * Section order: one answer, in one place.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * The Default template screen listed Forecasts & Estimates, then Catalysts &
 * Events, then Thesis & Risks. The asset page that template describes listed
 * Thesis & Risks, Catalysts & Events, Forecasts & Estimates. Nobody chose
 * either order, and the two screens were reading different things:
 *
 *   - the asset page sorts sections by `research_sections.display_order`
 *   - the template screen walked `field_config` and took each section's first
 *     appearance, and `field_config.display_order` for the derived default was
 *     the array index — so it was the arrival order of the catalogue query
 *   - that query sorted on `research_fields.display_order`, which only means
 *     anything WITHIN a section, and which ties across them: the first field
 *     of all three default sections carries 0, so Postgres picked
 *
 * `research_sections.display_order` ties too — this org has "Blue Ska Doo" and
 * "Thesis & Risks" both at 0 — so section order itself could move between
 * runs.
 *
 * ── What is tested where ─────────────────────────────────────────────────
 *
 * The DECISIONS are tested behaviourally, by calling them:
 *   - `catalogFieldOrder` in `../layout-resolver.test.ts`
 *   - `buildSystemDefaultLayout` in `./default-layout.test.ts`
 *
 * This file tests the WIRING — that the call sites actually use them, and that
 * the editor stops inferring section order from field numbers. Source is read
 * with comments stripped, so prose in the code cannot satisfy an assertion
 * here, and every assertion below was confirmed to fail with its fix removed.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const HOOK = strip(read('src/hooks/useUserAssetPagePreferences.ts'))
const FIELDS_HOOK = strip(read('src/hooks/useResearchFields.ts'))
const MANAGER = strip(read('src/components/templates/ResearchFieldsManager.tsx'))
const MOBILE_EDITOR = strip(read('src/components/templates/mobile/MobileResearchLayoutEditor.tsx'))

/**
 * Every sections query, as a slice of its own source.
 *
 * The anchor used to be the literal `.from('research_sections')`. The
 * layout stack now names its tables through the subject descriptor, so the
 * literal is gone from the hooks and only the descriptor spells it. Both
 * spellings are matched: other files (the mobile editor) still use the
 * literal, and a slice that found nothing would make every assertion below
 * vacuously true.
 */
const SECTION_FROM = [".from('research_sections')", '.from(S.tables.sections)']

const sectionQueries = (src: string): string[] => {
  const out: string[] = []
  for (const anchor of SECTION_FROM) {
    let at = src.indexOf(anchor)
    while (at !== -1) {
      out.push(src.slice(at, at + 500))
      at = src.indexOf(anchor, at + 1)
    }
  }
  return out
}

describe('the field catalogue is sorted by section, then within it', () => {
  /**
   * The field-catalogue queryFn, from its key to its `enabled`.
   *
   * The anchor was the literal key `'available-research-fields'`. Keys now
   * go through the subject descriptor and are built once in
   * `researchLayoutKeys`, so the catalogue query is keyed `K.fieldsVersioned`.
   * The `expect` on the index is kept, and matters more than it looks: if
   * this anchor ever stops resolving, every assertion in this block slices
   * an empty string and passes for free.
   */
  const catalogQuery = (() => {
    const from = HOOK.indexOf('queryKey: K.fieldsVersioned')
    expect(from, 'the catalogue query key moved; this block would slice nothing')
      .toBeGreaterThan(-1)
    const to = HOOK.indexOf('enabled: !!user?.id,', from)
    expect(to).toBeGreaterThan(from)
    return HOOK.slice(from, to)
  })()

  it('sorts the rows it returns, rather than trusting arrival order', () => {
    expect(catalogQuery).toMatch(/\.sort\(/)
  })

  it('sorts with the shared comparator, not a second opinion', () => {
    expect(catalogQuery).toContain('catalogFieldOrder(')
    expect(HOOK).toContain('catalogFieldOrder')
  })

  it('feeds the comparator the SECTION position, which is the whole point', () => {
    // A sort that passed only the field's own display_order would be the
    // original defect wearing the new function's name.
    expect(catalogQuery).toMatch(/section_display_order:\s*sectionOrderOf\(/)
  })

  it('reads that section position off the embedded section row', () => {
    expect(catalogQuery).toContain('research_sections')
    expect(catalogQuery).toMatch(/display_order/)
  })
})

describe('section order never depends on a tie the database breaks', () => {
  it('breaks the display_order tie with created_at everywhere sections are listed', () => {
    /*
     * Ascending only. `createSection` reads the max with
     * `.order('display_order', { ascending: false }).limit(1)`, which is an
     * aggregate, not a listing: every row sharing the top value answers it
     * the same way, so a tiebreak there would be noise.
     */
    const queries = [...sectionQueries(HOOK), ...sectionQueries(FIELDS_HOOK)]
      .filter(q => q.includes(".order('display_order', { ascending: true })"))

    // Three today: the asset-page catalogue, useResearchSections, and
    // useUserResearchLayout. If a fourth appears it must break the tie too.
    expect(queries.length).toBeGreaterThanOrEqual(3)
    for (const q of queries) {
      expect(q).toContain(".order('created_at'")
    }
  })
})

describe('the derived default is given section positions, not left to guess', () => {
  it('the desktop passes where each section sits', () => {
    const from = MANAGER.indexOf('function createVirtualDefaultLayout')
    expect(from).toBeGreaterThan(-1)
    const body = MANAGER.slice(from, MANAGER.indexOf('\n}', from))
    expect(body).toMatch(/section_display_order:\s*sectionOrderById\.get\(/)
    expect(body).toMatch(/field_display_order:/)
  })

  it('and builds that lookup from the section catalogue it already has', () => {
    expect(MANAGER).toMatch(/new Map\(fieldsBySection\.map\(s => \[s\.section_id, s\.section_display_order\]\)\)/)
  })

  it('the phone passes them too, so both surfaces derive one default', () => {
    const from = MOBILE_EDITOR.indexOf('buildSystemDefaultLayout(')
    expect(from).toBeGreaterThan(-1)
    const body = MOBILE_EDITOR.slice(from, from + 600)
    expect(body).toMatch(/section_display_order:\s*sectionOrderById\.get\(/)
    expect(body).toMatch(/field_display_order:/)
  })
})

describe('a template writes its section order down', () => {
  /** `handleSaveLayout`, from its declaration to the next declaration. */
  const saveHandler = (() => {
    const from = MANAGER.indexOf('const handleSaveLayout = async (')
    expect(from).toBeGreaterThan(-1)
    const to = MANAGER.indexOf('const handleStartBlank', from)
    expect(to).toBeGreaterThan(from)
    return MANAGER.slice(from, to)
  })()

  it('turns the editor’s section order into a section_config', () => {
    // `sectionOrder` reached this function from the first version of it and
    // was dropped on the floor; nothing recorded section order but field
    // numbers, which cannot express an empty section's position.
    expect(saveHandler).toMatch(/sectionOrder\.map\(/)
    expect(saveHandler).toMatch(/display_order:\s*index/)
  })

  it('sends it when updating an existing template', () => {
    const at = saveHandler.indexOf('updateLayout.mutateAsync({')
    expect(at).toBeGreaterThan(-1)
    expect(saveHandler.slice(at, saveHandler.indexOf('})', at))).toContain('sectionConfig')
  })

  it('sends it when creating one', () => {
    const at = saveHandler.indexOf('saveLayout.mutateAsync({')
    expect(at).toBeGreaterThan(-1)
    expect(saveHandler.slice(at, saveHandler.indexOf('})', at))).toContain('sectionConfig')
  })

  it('writes undefined rather than [] when there are no sections', () => {
    // `[]` is a template asserting it HAS no sections, which hides every one
    // of them instead of deferring to the catalogue. The insert path says so.
    expect(saveHandler).toMatch(/sectionOrder\.length[\s\S]{0,200}:\s*undefined/)
  })
})

describe('and reads it back, so an empty section keeps its place', () => {
  /** The saved-layout branch that rebuilds the editor's section list. */
  const sectionBuild = (() => {
    const from = MANAGER.indexOf('const sectionDetailsMap = new Map(')
    expect(from).toBeGreaterThan(-1)
    const to = MANAGER.indexOf('return sectionsArray\n    }', from)
    expect(to).toBeGreaterThan(from)
    return MANAGER.slice(from, to)
  })()

  it('reads the template’s own statement about its sections', () => {
    expect(sectionBuild).toContain('layout.section_config')
  })

  it('actually consults it when ordering, not merely declares it', () => {
    // The earlier version of this gate matched a declaration while the
    // decision was rewritten out from under it. Require the read.
    expect(sectionBuild).toMatch(/storedSectionOrder\.get\(s\.section_id\)/)
    expect(sectionBuild).toMatch(/\.sort\(\(a, b\) => a\.key - b\.key\)/)
  })

  it('restores a section the template keeps but no field mentions', () => {
    expect(sectionBuild).toMatch(/if \(seenSections\.has\(sectionId\)\) continue/)
    expect(sectionBuild).toMatch(/fields: \[\]/)
  })

  it('leaves un-stated sections after the stated ones, not hoisted to front', () => {
    // A missing number defaulting to 0 would float every silent section above
    // every stated one — the kind of fix that looks deliberate and is not.
    expect(sectionBuild).toMatch(/fallbackBase \+ inferredIndex/)
  })
})
