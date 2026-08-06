import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SLUG_TO_SECTION,
  contributionSectionsForSlug,
  writeSectionForSlug,
} from '../../../../lib/research/contribution-sections'

/**
 * The case editor writes through useContributions using a section key derived
 * from a template field's slug. If that derivation disagrees with the one the
 * desktop page reads by, a thesis edited on a phone lands in a section nothing
 * displays — the write succeeds, the user sees a confirmation, and the work
 * vanishes.
 *
 * Nothing else would catch it: both sides pass bare strings, and a
 * wrong-but-valid key is a successful insert.
 */
describe('contribution section mapping', () => {
  it('writes to the section the desktop thesis reads', () => {
    const desktop = readFileSync('src/components/contributions/ThesisContainer.tsx', 'utf8')
    const desktopKeys = new Set<string>()
    for (const m of desktop.matchAll(
      /useContributions\(\{ assetId, section: '([a-z_]+)' \}\)/g
    )) {
      desktopKeys.add(m[1])
    }

    expect(desktopKeys.size).toBeGreaterThan(0)
    for (const key of desktopKeys) {
      // The slug and the section coincide for the built-in fields, so a field
      // named after the section must resolve back to it.
      expect(writeSectionForSlug(key)).toBe(key)
    }
  })

  it('resolves hyphenated template slugs to underscored section keys', () => {
    expect(writeSectionForSlug('investment-thesis')).toBe('thesis')
    expect(writeSectionForSlug('where-different')).toBe('where_different')
    expect(writeSectionForSlug('risks-to-thesis')).toBe('risks_to_thesis')
  })

  it('reads aliases but writes only one key', () => {
    // 'key-risks' has legacy content under both 'risks_to_thesis' and 'risks'.
    // Reading must cover both; writing must not split future content across
    // them, or the field slowly acquires two competing versions.
    expect(contributionSectionsForSlug('key-risks')).toEqual(['risks_to_thesis', 'risks'])
    expect(writeSectionForSlug('key-risks')).toBe('risks_to_thesis')
  })

  it('falls back to the slug for fields an organisation added itself', () => {
    // Custom fields are not in the map. They must still resolve to something
    // stable rather than undefined, or the section cannot be written at all.
    expect(writeSectionForSlug('supply-chain')).toBe('supply-chain')
    expect(contributionSectionsForSlug('supply-chain')).toContain('supply_chain')
    expect(writeSectionForSlug('moat')).toBe('moat')
  })

  it('never resolves a mapped slug to an empty list', () => {
    for (const slug of Object.keys(SLUG_TO_SECTION)) {
      expect(contributionSectionsForSlug(slug).length).toBeGreaterThan(0)
      expect(writeSectionForSlug(slug)).toBeTruthy()
    }
  })
})
