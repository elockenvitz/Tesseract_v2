/**
 * The four-mode model.
 *
 * The invariants here are the ones that fail loudly if someone adds a
 * destination later: every sub-page must belong to a mode, every mode must
 * land on a sub-page that is in that mode, and every Work sub-page must have
 * an anchor to scroll to. Without those a new tab renders nothing, or lands
 * the reader in a different mode than the one they clicked.
 */
import { describe, it, expect } from 'vitest'
import {
  ASSET_MODES, MODE_LANDING, MODE_LABEL, SUBPAGE_MODE,
  WORK_SUBPAGES, WORK_SECTION_ID,
  isAssetSubPage, modeOf, workSectionId,
  type AssetSubPage,
} from '../modes'

const SUBPAGES = Object.keys(SUBPAGE_MODE) as AssetSubPage[]

describe('the model is total', () => {
  it('maps every destination to one of the four modes', () => {
    for (const sub of SUBPAGES) {
      expect(ASSET_MODES).toContain(SUBPAGE_MODE[sub])
    }
  })

  it('lands every mode on a destination that mode actually renders', () => {
    // A landing in the wrong mode is a nav button that appears to do nothing.
    for (const mode of ASSET_MODES) {
      expect(SUBPAGE_MODE[MODE_LANDING[mode]]).toBe(mode)
    }
  })

  it('labels and orders all four modes, with no duplicates', () => {
    expect(ASSET_MODES).toHaveLength(4)
    expect(new Set(ASSET_MODES).size).toBe(4)
    for (const mode of ASSET_MODES) expect(MODE_LABEL[mode]).toBeTruthy()
  })

  it('gives a Work sub-page a scroll anchor only if the section exists', () => {
    /*
     * Was `expect(WORK_SECTION_ID[sub]).toMatch(/^work-/)` for all three,
     * which is how `decisions: 'work-ideas'` survived: the test checked the
     * SHAPE of the id, not that anything carried it. No rendered file has
     * ever had `work-ideas`, so that anchor resolved to nothing every time.
     *
     * The rule now is the one that matters — an anchor is either null or a
     * `work-` id, and the non-null ones are distinct — plus a named
     * assertion for the sub-page that deliberately has none.
     */
    for (const sub of WORK_SUBPAGES) {
      expect(SUBPAGE_MODE[sub]).toBe('work')
      const id = WORK_SECTION_ID[sub]
      if (id !== null) expect(id).toMatch(/^work-/)
    }
    expect(WORK_SECTION_ID.decisions).toBeNull()
    const anchored = Object.values(WORK_SECTION_ID).filter(v => v !== null)
    expect(new Set(anchored).size).toBe(anchored.length)
    expect(anchored).toHaveLength(2)
  })

  it('has exactly the Work sub-pages in Work, no more', () => {
    const inWork = SUBPAGES.filter(s => SUBPAGE_MODE[s] === 'work')
    expect(inWork.sort()).toEqual([...WORK_SUBPAGES].sort())
  })
})

describe('the original five tabs keep their names', () => {
  it.each([
    ['snapshot', 'overview'],
    ['research', 'research'],
    ['workflow', 'work'],
    ['decisions', 'work'],
    ['lists', 'work'],
    ['history', 'history'],
  ] as const)('%s renders in %s', (sub, mode) => {
    expect(modeOf(sub)).toBe(mode)
  })
})

describe('persisted state from an older build', () => {
  it('falls back to Overview rather than rendering nothing', () => {
    // Tab state is persisted by key. A build that wrote 'position' or
    // 'overview' must not resolve to a mode with no content.
    expect(modeOf('position')).toBe('overview')
    expect(modeOf(null)).toBe('overview')
    expect(modeOf(undefined)).toBe('overview')
    expect(modeOf('')).toBe('overview')
  })

  it('does not treat an inherited Object property as a sub-page', () => {
    // `value in SUBPAGE_MODE` would say yes to 'toString' on a plain object
    // literal's prototype chain if the guard were careless.
    expect(isAssetSubPage('toString')).toBe(false)
    expect(isAssetSubPage('constructor')).toBe(false)
    expect(isAssetSubPage(42)).toBe(false)
    expect(isAssetSubPage('research')).toBe(true)
  })
})

describe('scroll anchors', () => {
  it('names the section for a Work destination', () => {
    expect(workSectionId('workflow')).toBe(WORK_SECTION_ID.workflow)
    expect(workSectionId('lists')).toBe(WORK_SECTION_ID.lists)
    /*
     * Null, and spelled out rather than compared to the table, so this reads
     * as a claim about behaviour. The caller (`focusWorkSection`) treats null
     * as "set no anchor", which is what arriving at the ideas should do —
     * they are already on screen.
     */
    expect(workSectionId('decisions')).toBeNull()
  })

  it('is null outside Work, so nothing scrolls on the other modes', () => {
    expect(workSectionId('snapshot')).toBeNull()
    expect(workSectionId('research')).toBeNull()
    expect(workSectionId('history')).toBeNull()
    expect(workSectionId('nonsense')).toBeNull()
  })
})
