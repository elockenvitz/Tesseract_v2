/**
 * Today never says "review" unless the date it counts from is a review.
 *
 * Every age and every price move on a Today tile is counted from one start
 * date, and the words for it come from what that date actually is: a recorded
 * research review, a case being written, the last edit to a thesis. The tile,
 * its drawn window and the Ask AI context must all name the same event.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { DecisionItem } from '../../../engine/decisionEngine/types'
import type { CoverageResearchCandidate } from '../../../lib/research/coverage-research-gaps'
import type { ResearchFraming } from '../../../lib/research/case-state'
import { adaptDecisionItem, applyEnrichment, coverageDecisionItem } from '../../../lib/today'
import type { TodayEnrichment, TodayItem } from '../../../lib/today'
import { TodayTile } from '../TodayTile'

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

/** Daily closes ending today, starting `days` ago. */
const history = (days: number) => Array.from({ length: days + 1 }, (_, i) => ({
  date: new Date(Date.now() - (days - i) * DAY).toISOString().slice(0, 10),
  close: 100 + i,
}))

const PRIORITY: Record<ResearchFraming, number> = { new_evidence: 1, price_move: 2, no_case: 3, incomplete_case: 4, long_silence: 5 }

function candidate(framing: ResearchFraming, anchoredOn: 'reviewed' | 'written', days: number): CoverageResearchCandidate {
  return {
    id: 'coverage-research:a-nke', assetId: 'a-nke', symbol: 'NKE', companyName: 'Nike',
    coverage: 'own', framing, priority: PRIORITY[framing], score: 0.5,
    headline: 'x', body: 'x', prompt: 'x',
    facts: {
      missingSections: framing === 'incomplete_case' ? ['risks_to_thesis'] : [],
      presentSections: ['thesis', 'where_different'],
      movePct: framing === 'price_move' ? 18.2 : null, evidenceSince: [], evidenceCount: 0,
      daysSinceReview: days, daysSinceWritten: anchoredOn === 'written' ? days : days + 60,
      anchoredOn, caseWrittenAt: ago(anchoredOn === 'written' ? days : days + 60), reviewAnchor: ago(days),
    },
    exposure: { held: false, weightPct: null, portfolioId: null, portfolioName: null, portfolioCount: 0 },
    liveIdeas: [],
    open: { assetId: 'a-nke', symbol: 'NKE', companyName: null, focus: 'research', origin: 'coverage-research', issue: 'x' },
    insight: {} as never,
  }
}

const staleThesis = (days: number): DecisionItem => ({
  id: 'thesis-stale-a-amzn', surface: 'action', severity: 'red', category: 'risk',
  title: 'Thesis May Be Stale', titleKey: 'THESIS_STALE', description: 'x',
  chips: [{ label: 'Ticker', value: 'AMZN' }, { label: 'Age', value: `${days}d` }],
  context: { assetId: 'a-amzn', assetTicker: 'AMZN' },
  ctas: [{ label: 'Update Thesis', actionKey: 'OPEN_ASSET_UPDATE_THESIS', kind: 'primary' }],
  sortScore: 0, createdAt: ago(days),
} as DecisionItem)

const today = (d: DecisionItem, e?: TodayEnrichment) => applyEnrichment(adaptDecisionItem(d), e)
const priceMetric = (t: TodayItem) => t.metrics.find(m => m.label.startsWith('Price'))
const aiLabels = (t: TodayItem) => (t.target?.contextChips ?? []).map(c => c.label)
function tileText(t: TodayItem) {
  const { container, unmount } = render(<TodayTile item={t} rank={1} onPrimary={vi.fn()} onDismiss={vi.fn()} onSnooze={vi.fn()} />)
  const text = container.textContent ?? ''
  unmount()
  return text
}

/** Wording that claims a review happened. Calls to action ("Review thesis") are not claims. */
const CLAIMS_REVIEW = /since review|since last review|unreviewed|last review|reviewed/i

describe('a case written and never reviewed', () => {
  const item = (framing: ResearchFraming, e?: TodayEnrichment) =>
    today(coverageDecisionItem(candidate(framing, 'written', 140)), e)

  it('counts from being written on the tile, its picture and in Ask AI', () => {
    const t = item('long_silence')
    expect(t.metrics).toContainEqual(expect.objectContaining({ label: 'Since written', value: '140d' }))
    expect(t.visual).toMatchObject({ archetype: 'aging', caption: 'Unchanged for', window: '140 days' })
    expect(t.visual.aging!.milestones[0].label).toBe('written')
    expect(t.claim).toBe('The NKE thesis was written 140 days ago and has not changed since.')
    expect(aiLabels(t)).toContain('Since written')
    expect(t.seedPrompt).toMatch(/was last written 140d ago/)

    const text = tileText(t)
    expect(text).toContain('Since written')
    expect(text).toContain('Unchanged for')
    expect(text).not.toMatch(CLAIMS_REVIEW)
    expect(`${aiLabels(t).join(' ')} ${t.seedPrompt}`).not.toMatch(CLAIMS_REVIEW)
  })

  it('names a price move since the thesis was written, drawn and in Ask AI', () => {
    const t = item('price_move', { history: history(200) })
    expect(t.state).toBe('Moved since thesis')
    expect(priceMetric(t)!.label).toBe('Price since written')
    expect(t.visual).toMatchObject({ archetype: 'review-window', caption: 'Price since the thesis was written' })
    expect(t.visual.reviewWindow!.anchorLabel).toBe('WRITTEN')
    expect(aiLabels(t)).toEqual(expect.arrayContaining(['Since written', 'Price since written']))
    expect(t.seedPrompt).toMatch(/since our case was last written/)
    expect(tileText(t)).not.toMatch(CLAIMS_REVIEW)
  })
})

describe('a case with a real review', () => {
  const item = (framing: ResearchFraming, e?: TodayEnrichment) =>
    today(coverageDecisionItem(candidate(framing, 'reviewed', 120)), e)

  it('keeps review wording, because the date is a review', () => {
    const quiet = item('long_silence')
    expect(quiet.metrics).toContainEqual(expect.objectContaining({ label: 'Since review', value: '120d' }))
    expect(quiet.visual.caption).toBe('Unreviewed for')
    expect(quiet.visual.aging!.milestones[0].label).toBe('reviewed')
    expect(quiet.claim).toBe('The NKE thesis has not been reviewed in 120 days.')
    expect(aiLabels(quiet)).toContain('Since review')

    const moved = item('price_move', { history: history(200) })
    expect(moved.state).toBe('Moved since review')
    expect(priceMetric(moved)!.label).toBe('Price since review')
    expect(moved.visual.caption).toBe('Price since last review')
    expect(aiLabels(moved)).toContain('Price since review')
    expect(moved.seedPrompt).toMatch(/since our case was last reviewed/)
  })
})

describe('a stale thesis, counted from its last edit', () => {
  it('says update, never review, on the tile, its picture, its claim and in Ask AI', () => {
    const bare = today(staleThesis(210))
    expect(bare.metrics[0]).toMatchObject({ label: 'Since update', value: '210d' })
    expect(bare.visual.caption).toBe('Not updated for')
    expect(bare.claim).toMatch(/has not been updated in over six months/)

    const priced = today(staleThesis(210), { history: history(300), weightPct: 2.1 })
    expect(priceMetric(priced)!.label).toBe('Price since update')
    expect(priced.visual).toMatchObject({ archetype: 'review-window', caption: 'Price since the last thesis update' })
    expect(priced.visual.reviewWindow!.anchorLabel).toBe('LAST UPDATE')
    expect(priced.claim).toMatch(/^The thesis has not been updated in 210 days/)
    expect(aiLabels(priced)).toEqual(expect.arrayContaining(['Since update', 'Price since update']))

    for (const t of [bare, priced]) {
      expect(tileText(t)).not.toMatch(CLAIMS_REVIEW)
      expect(aiLabels(t).join(' ')).not.toMatch(CLAIMS_REVIEW)
    }
  })
})

describe('price labels', () => {
  it('fall back to the history they measured when it does not reach the start date', () => {
    // Prices from 30 days ago; the thesis was written 140 days ago.
    const t = today(coverageDecisionItem(candidate('price_move', 'written', 140)), { history: history(30) })
    expect(priceMetric(t)!.label).toBe('Price over history')
    expect(t.visual.caption).toBe('Price over available history')
    expect(t.visual.note).toBe('History does not reach the date it was written, so this is not a since-written move.')
    expect(aiLabels(t)).toContain('Price over history')
    expect(tileText(t)).not.toMatch(CLAIMS_REVIEW)
  })

  it('name the start event on findings that draw no window, instead of defaulting to review', () => {
    const incomplete = today(coverageDecisionItem(candidate('incomplete_case', 'written', 40)), { history: history(60) })
    expect(priceMetric(incomplete)!.label).toBe('Price since written')
    expect(aiLabels(incomplete)).toContain('Price since written')
  })

  it('never claim a start event an unclassified finding does not have', () => {
    const t = today({
      id: 'x', surface: 'intel', severity: 'blue', category: 'alpha',
      title: 'Something new', titleKey: 'SOMETHING_NEW', description: 'x',
      chips: [{ label: 'Ticker', value: 'TSM' }], context: { assetId: 'a-tsm', assetTicker: 'TSM' },
      ctas: [], sortScore: 0,
    } as DecisionItem, { history: history(60) })
    expect(priceMetric(t)!.label).toBe('Price over history')
    expect(aiLabels(t)).toContain('Price over history')
  })
})
