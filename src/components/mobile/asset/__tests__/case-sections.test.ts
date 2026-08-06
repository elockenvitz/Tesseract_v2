import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The mobile case editor writes through useContributions using a section key.
 * If those keys drift from the ones the desktop page reads, a thesis edited on
 * a phone lands in a section nothing displays — the write succeeds, the user
 * sees a confirmation, and the work vanishes.
 *
 * Nothing else would catch that: both sides type the key as a bare string, and
 * a wrong-but-valid key is a successful insert.
 */
describe('mobile asset case sections', () => {
  const mobile = readFileSync('src/components/mobile/asset/MobileAssetPage.tsx', 'utf8')
  const desktop = readFileSync('src/components/contributions/ThesisContainer.tsx', 'utf8')

  const keysIn = (source: string, pattern: RegExp) => {
    const found = new Set<string>()
    for (const m of source.matchAll(pattern)) found.add(m[1])
    return found
  }

  it('uses the same section keys the desktop thesis reads', () => {
    const mobileKeys = keysIn(mobile, /sectionKey: '([a-z_]+)'/g)
    const desktopKeys = keysIn(desktop, /useContributions\(\{ assetId, section: '([a-z_]+)' \}\)/g)

    expect(desktopKeys.size).toBeGreaterThan(0)
    expect([...mobileKeys].sort()).toEqual([...desktopKeys].sort())
  })

  it('covers every section rather than a subset', () => {
    // A section present on desktop but missing here is not a crash, it is an
    // invisible gap: the reader assumes they have seen the whole case.
    const mobileKeys = keysIn(mobile, /sectionKey: '([a-z_]+)'/g)
    expect(mobileKeys).toContain('thesis')
    expect(mobileKeys).toContain('where_different')
    expect(mobileKeys).toContain('risks_to_thesis')
  })
})
