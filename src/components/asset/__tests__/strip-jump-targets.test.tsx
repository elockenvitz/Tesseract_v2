import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Row = Record<string, unknown>
const ws = vi.hoisted(() => ({ data: null as Row | null, isLoading: false }))
const rt = vi.hoisted(() => ({ consensus: [] as Row[], ratings: [] as Row[], myRating: null as Row | null }))

vi.mock('../../../hooks/useAssetWorkspace', () => ({
  useAssetWorkspace: () => ws,
  primaryPosition: (positions: Array<unknown>) => positions[0] ?? null,
}))
vi.mock('../../../hooks/useAnalystRatings', () => ({ useAnalystRatings: () => rt }))

import { AssetContextStrip } from '../AssetContextStrip'
import { SnapBlock } from '../SnapshotBlocks'
import {
  STRIP_TARGET, STRIP_CELLS, stripTarget, EXPOSURE_ANCHOR_ID, type StripCell,
} from '../../../lib/asset-workspace/strip-targets'

/**
 * Pressing a fact in the header strip goes to that fact.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * Each cell called `onOpen(subPage)`: it named a PAGE and stopped. For the
 * three cells whose subject is written in the case, that meant landing
 * wherever Research happened to be scrolled to.
 *
 * Measured on AMZN at 1920 — before: "Firm rating" switched to Research and
 * left the Rating card at y=701, 420px down the content area and partly past
 * the fold, with the scroller at 328 of 1939, which was simply where Research
 * had been left. After: rating, price target and case all land at y=343,
 * directly under the Research toolbar; exposure at y=304 on the Overview.
 *
 * Exposure also changed DESTINATION. It opened Work, which holds the open
 * loops — ideas, the process, the lists — and none of them is the position.
 * The position is drawn on the Overview in "Exposure & valuation".
 */

const EMPTY_WS = {
  sections: [], evidence: [], caseWrittenAt: null, spot: null, target: null,
  positions: [], liveIdeas: [], decisions: [],
}

beforeEach(() => {
  cleanup()
  ws.data = { ...EMPTY_WS }; ws.isLoading = false
  rt.consensus = []; rt.ratings = []; rt.myRating = null
})

/** The label each cell is drawn under, so a press can be aimed by eye. */
const LABEL: Record<StripCell, string> = {
  rating: 'Firm rating',
  target: 'Price target',
  exposure: 'Exposure',
  work: 'Active work',
  case: 'Case freshness',
}

describe('the strip names the fact, not a page', () => {
  it('emits one cell name per press, for every cell it draws', () => {
    const seen: StripCell[] = []
    render(<AssetContextStrip assetId="a1" symbol="LLY" spot={null} onJump={c => seen.push(c)} />)
    for (const cell of STRIP_CELLS) {
      screen.getByText(LABEL[cell]).closest('button')!.click()
    }
    expect(seen).toEqual([...STRIP_CELLS])
  })

  it('draws every cell the target table claims to cover, and no more', () => {
    // The table and the render agreeing is the whole point of the seam: a
    // sixth cell with no destination would be a dead control.
    render(<AssetContextStrip assetId="a1" symbol="LLY" spot={null} onJump={() => {}} />)
    const buttons = document.querySelectorAll('[aria-label="Investment context"] button')
    expect(buttons.length).toBe(STRIP_CELLS.length)
    expect(Object.keys(STRIP_TARGET).sort()).toEqual([...STRIP_CELLS].sort())
  })

  it('is inert, not broken, when nothing is listening', () => {
    // The strip renders in contexts that pass no handler; those cells must be
    // plain text rather than buttons that do nothing when pressed.
    render(<AssetContextStrip assetId="a1" symbol="LLY" spot={null} />)
    expect(document.querySelectorAll('[aria-label="Investment context"] button').length).toBe(0)
  })

  it('says where it is going, rather than restating the label', () => {
    render(<AssetContextStrip assetId="a1" symbol="LLY" spot={null} onJump={() => {}} />)
    const titles = [...document.querySelectorAll('[aria-label="Investment context"] button')]
      .map(b => (b as HTMLElement).title)
    expect(titles.every(t => /^Go to /.test(t))).toBe(true)
  })
})

describe('every fact resolves to somewhere it is actually written', () => {
  it('sends the three case-borne facts to a research anchor', () => {
    for (const cell of ['rating', 'target', 'case'] as const) {
      const t = stripTarget(cell)
      expect(t.subPage).toBe('research')
      expect(t.anchor).toBeTruthy()
    }
  })

  it('sends exposure to the Overview block that draws the position', () => {
    // It used to open Work, which holds no position at all.
    const t = stripTarget('exposure')
    expect(t.subPage).toBe('snapshot')
    expect(t.sectionId).toBe(EXPOSURE_ANCHOR_ID)
    expect(t.anchor).toBeUndefined()
  })

  it('gives active work no anchor, because there is nowhere to scroll', () => {
    /*
     * `WORK_SECTION_ID.decisions` is null and its note says why: the ideas
     * are rows the surface SELECTS, not a section you scroll to, and arriving
     * at Work already shows them. An anchor here would be an id that nothing
     * resolves — which is the failure mode that note exists to record.
     */
    const t = stripTarget('work')
    expect(t.subPage).toBe('decisions')
    expect(t.anchor).toBeUndefined()
    expect(t.sectionId).toBeUndefined()
  })

  it('names only anchors the page can resolve', () => {
    // The attention effect in AssetTab owns the anchor → DOM id map. A
    // destination naming an anchor it has no case for would scroll nowhere.
    const TAB = readFileSync(
      resolve(__dirname, '../../tabs/AssetTab.tsx'), 'utf8',
    )
    const map = TAB.slice(TAB.indexOf('const map: Record<string, string> = {'))
      .slice(0, 400)
    for (const t of Object.values(STRIP_TARGET)) {
      if (t.anchor) expect(map).toContain(`${t.anchor}:`)
    }
  })
})

describe('the exposure block carries the id it is sent to', () => {
  it('SnapBlock puts anchorId on the section, and offsets the landing', () => {
    render(<SnapBlock title="Exposure & valuation" anchorId={EXPOSURE_ANCHOR_ID}>x</SnapBlock>)
    const el = document.getElementById(EXPOSURE_ANCHOR_ID)
    expect(el).toBeTruthy()
    // Landing flush under the sticky band hides the heading being landed on.
    expect(el!.className).toContain('scroll-mt')
  })

  it('does not hand an id to a section nobody navigates to', () => {
    // An anchor on every block is how the page accumulated ids that resolve
    // but mean nothing; `anchorId` is opt-in.
    render(<SnapBlock title="Plain">x</SnapBlock>)
    expect(document.querySelector('section')!.getAttribute('id')).toBeNull()
  })

  it('the Overview block reads the id from the table, not a copy of it', () => {
    const SRC = readFileSync(
      resolve(__dirname, '../InvestmentSnapshot.tsx'), 'utf8',
    ).split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(SRC).toContain('anchorId={EXPOSURE_ANCHOR_ID}')
    // A literal here and a literal in the table is two things that can drift.
    expect(SRC).not.toContain(`anchorId="${EXPOSURE_ANCHOR_ID}"`)
  })
})
