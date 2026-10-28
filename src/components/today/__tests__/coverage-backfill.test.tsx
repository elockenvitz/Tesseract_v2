/**
 * Today's thin-feed backfill from coverage research gaps.
 *
 * Real findings first and never displaced; a thin morning topped up with the
 * reader's coverage work as ORDINARY Today tiles; nothing special to tell
 * them apart; generated items giving way as real findings arrive; and the
 * coverage scan never holding up the first paint.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import type { DecisionItem } from '../../../engine/decisionEngine/types'
import type { CoverageResearchCandidate } from '../../../lib/research/coverage-research-gaps'
import type { ResearchFraming } from '../../../lib/research/case-state'
import { TODAY_LIMIT } from '../../../lib/today'

const env = vi.hoisted(() => ({
  engine: { action: [] as unknown[], intel: [] as unknown[] },
  engineLoading: false,
  gaps: { status: 'ready', candidates: [] as unknown[], coveredCount: 50 } as { status: string; candidates: unknown[]; coveredCount: number },
  suppressed: new Set<string>(),
  focus: [] as Array<{ target: Record<string, unknown> }>,
}))

vi.mock('../../../engine/decisionEngine', () => ({
  useDecisionEngine: () => ({ selectForDashboard: () => env.engine, isLoading: env.engineLoading }),
}))
vi.mock('../../../engine/decisionEngine/dispatchDecisionAction', () => ({ dispatchDecisionAction: vi.fn() }))
vi.mock('../../../hooks/useTodayEnrichment', () => ({
  useTodayEnrichment: () => ({ map: {}, pending: false }),
}))

/* The field is gated on enrichment too, so a pending map holds the skeleton. */
describe('the field waits for its pictures', () => {
  it('holds the skeleton while enrichment is still in flight', async () => {
    vi.doMock('../../../hooks/useTodayEnrichment', () => ({
      useTodayEnrichment: () => ({ map: {}, pending: true }),
    }))
    vi.resetModules()
    const { TodayPage: Pending } = await import('../TodayPage')
    env.engine.action = [finding(1)]
    env.gaps = { status: 'ready', candidates: [], coveredCount: 3 }
    render(<Pending />)
    expect(screen.getByTestId('today-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('today-field')).not.toBeInTheDocument()
    vi.doUnmock('../../../hooks/useTodayEnrichment')
    vi.resetModules()
  })
})
vi.mock('../../../hooks/useAttentionState', () => ({
  useAttentionState: () => ({ suppressedKeys: env.suppressed, dismissForMe: vi.fn(), snoozeForMe: vi.fn(), isLoading: false }),
}))
vi.mock('../../../hooks/useCoverageResearchGaps', () => ({ useCoverageResearchGaps: () => env.gaps }))
vi.mock('../../coverage/FirstSessionCoveragePrompt', () => ({
  FirstSessionCoveragePrompt: () => <div data-testid="coverage-prompt">What do you follow?</div>,
}))
vi.mock('../../../lib/dashboard/focus', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../lib/dashboard/focus')>()
  return { ...actual, openDashboardFocus: (r: unknown) => { env.focus.push(r as (typeof env.focus)[number]); return true } }
})

import { TodayPage } from '../TodayPage'
import { feedItemAttentionKey } from '../../../lib/attention-state'
import { coverageDecisionItem, TODAY_COVERAGE_TARGET } from '../../../lib/today'

const PRIORITY: Record<ResearchFraming, number> = { new_evidence: 1, price_move: 2, no_case: 3, incomplete_case: 4, long_silence: 5 }
const BOOK = 'Tech & Consumer Growth'
const held = (weightPct: number) => ({ held: true, weightPct, portfolioId: 'p1', portfolioName: BOOK, portfolioCount: 1 })

function candidate(symbol: string, framing: ResearchFraming = 'no_case', over: Partial<CoverageResearchCandidate> = {}): CoverageResearchCandidate {
  const assetId = `a-${symbol.toLowerCase()}`
  return {
    id: `coverage-research:${assetId}`, assetId, symbol, companyName: `${symbol} Inc`,
    coverage: 'own', framing, priority: PRIORITY[framing], score: 0.55,
    headline: 'x', body: 'x', prompt: 'What best describes this position?',
    facts: {
      missingSections: ['thesis', 'where_different', 'risks_to_thesis'], presentSections: [],
      movePct: framing === 'price_move' ? -16.4 : null, evidenceSince: [], evidenceCount: 0,
      daysSinceReview: null, daysSinceWritten: null, anchoredOn: null, caseWrittenAt: null, reviewAnchor: null,
    },
    exposure: { held: false, weightPct: null, portfolioId: null, portfolioName: null, portfolioCount: 0 },
    liveIdeas: [],
    open: { assetId, symbol, companyName: null, focus: 'research', origin: 'coverage-research', issue: 'x' },
    insight: {} as never,
    ...over,
  }
}

const bogey = () => [
  candidate('AMZN', 'no_case', { exposure: held(5.4), liveIdeas: [{ id: 'i1', action: 'add' }] }),
  candidate('TSLA', 'no_case', { exposure: held(3.2) }),
  candidate('SBUX', 'no_case', { exposure: held(2.3) }),
  candidate('MELI', 'no_case', { exposure: held(2.1) }),
  ...Array.from({ length: 46 }, (_, i) => candidate(`U${String(i).padStart(2, '0')}`)),
]

/** A real engine finding, the shape Bogey Cap's one LLY item has. */
const finding = (n: number, over: Partial<DecisionItem> = {}): DecisionItem => ({
  id: `idea-not-simulated-${n}`, surface: 'action', severity: 'yellow', category: 'process',
  title: 'Idea Being Worked On', titleKey: 'IDEA_NOT_SIMULATED', description: 'x',
  chips: [{ label: 'Ticker', value: `R${n}` }],
  context: { assetId: `a-r${n}`, assetTicker: `R${n}` },
  ctas: [{ label: 'Simulate idea', actionKey: 'OPEN_TRADE_LAB', kind: 'primary' }],
  sortScore: 0, ...over,
} as DecisionItem)

const tiles = () => screen.queryAllByTestId('today-tile')
const tickers = () => tiles().map(t => t.getAttribute('aria-label')?.split(',')[0])

beforeEach(() => {
  env.engine = { action: [], intel: [] }
  env.engineLoading = false
  env.gaps = { status: 'ready', candidates: bogey(), coveredCount: 50 }
  env.suppressed = new Set()
  env.focus.length = 0
})

describe('a thin morning, Bogey Cap shaped', () => {
  it('shows the real finding first, then every coverage name the caps allow', () => {
    /*
     * This used to assert "to five", and the five was the whole rule.
     *
     * Measured against the real account it made the backfill unreachable:
     * the engine produced seven findings, six surfaced, and `room = 5 - 6`
     * was negative -- so a reader with FIFTY active coverage rows saw six
     * tiles and no coverage work at all. The target is the page now.
     *
     * What still bounds the page is the structural cap, and this fixture is
     * the real account's shape: four names that are held or carry an idea,
     * and forty-six bare covered names with nothing written. The forty-six
     * all say one sentence, so four of them appear, not forty-six.
     */
    env.engine.action = [finding(1)]
    render(<TodayPage />)
    expect(tickers()).toEqual(['R1', 'AMZN', 'TSLA', 'SBUX', 'MELI', 'U00', 'U01', 'U02', 'U03'])
    expect(tiles()).toHaveLength(9)
    expect(tiles().length).toBeLessThan(TODAY_COVERAGE_TARGET)
    expect(tiles()[0]).toHaveAttribute('data-rank', '1')
    expect(screen.queryByText(/Coverage needs work|covered names/)).not.toBeInTheDocument()
    expect(screen.getByText('9 items')).toBeInTheDocument()
  })

  it('says why each name is work now', () => {
    render(<TodayPage />)
    const [amzn, tsla] = tiles()
    expect(amzn).toHaveTextContent('Idea without a case')
    expect(amzn).toHaveTextContent('AMZN is being worked without a written case')
    expect(within(amzn).getByRole('button', { name: /Write thesis/ })).toBeInTheDocument()
    expect(tsla).toHaveTextContent('Position without a thesis')
    expect(tsla).toHaveTextContent('A 3.2% position in Tech & Consumer Growth with no written thesis.')
    expect(document.body.textContent).not.toContain('What best describes this position?')
  })

  it('caps bare coverage, so a fresh account is not a page of identical tiles', () => {
    /*
     * The cap is the only thing between this surface and forty-six copies of
     * one sentence. It was 1, which also made it the real limit on the
     * backfill -- the page could never show more than three generated tiles
     * however much coverage existed. It is a share of the page now, so the
     * number moved; the rule did not.
     */
    env.gaps = { status: 'ready', candidates: bogey().slice(4), coveredCount: 46 }
    render(<TodayPage />)
    // Forty-six unheld names are available and four of them appear.
    expect(bogey().slice(4)).toHaveLength(46)
    expect(tiles()).toHaveLength(4)
    expect(tiles()[0]).toHaveTextContent('is on your coverage with no thesis yet.')
  })
})

describe('real findings always win', () => {
  it('shows no coverage work when real findings already fill the surface', () => {
    // Sized off TODAY_LIMIT. It used to say "four real findings", which was
    // the same number as the whole surface; once the surface held eight, four
    // findings left room and the backfill correctly filled it -- the case was
    // asserting the old count, not the rule.
    env.engine.action = Array.from({ length: TODAY_LIMIT }, (_, i) => finding(i + 1))
    render(<TodayPage />)
    /*
     * The SET, not the sequence.
     *
     * This compared against `R1..R20` in numeric order, which only ever held
     * because the limit was single-digit: these findings tie on every ranking
     * key, so the comparator falls through to `id.localeCompare`, and once
     * there is an R10 it sorts before R2. The rule under test is that real
     * findings leave no room for coverage backfill -- their order among
     * themselves is a different rule, tested in tiers.
     */
    expect(new Set(tickers()))
      .toEqual(new Set(Array.from({ length: TODAY_LIMIT }, (_, i) => `R${i + 1}`)))
    expect(tickers()).toHaveLength(TODAY_LIMIT)
  })

  it('leads with every real finding, and never lets coverage displace one', () => {
    /*
     * This asserted "gives way one slot at a time", which was true only
     * while the target was five: three findings left exactly two slots. With
     * the target at the page's own limit, coverage no longer gives way until
     * the findings themselves fill the page -- the rule that survives, and
     * the one worth guarding, is that real findings LEAD and are never
     * pushed out by generated work.
     */
    env.engine.action = [1, 2, 3].map(n => finding(n))
    render(<TodayPage />)
    expect(tickers().slice(0, 3)).toEqual(['R1', 'R2', 'R3'])
    expect(tickers().slice(3)).not.toContain(undefined)
    expect(tiles().length).toBeLessThanOrEqual(TODAY_COVERAGE_TARGET)
    // And the whole backfill is still there behind them: nothing was dropped
    // to make room, because there was room.
    expect(tickers()).toEqual(['R1', 'R2', 'R3', 'AMZN', 'TSLA', 'SBUX', 'MELI', 'U00', 'U01', 'U02', 'U03'])
  })

  it('never raises a name a real finding already concerns', () => {
    env.engine.action = [finding(1, { chips: [{ label: 'Ticker', value: 'AMZN' }], context: { assetId: 'a-amzn', assetTicker: 'AMZN' } })]
    render(<TodayPage />)
    expect(tickers().filter(t => t === 'AMZN')).toHaveLength(1)
    expect(tickers()).toEqual(['AMZN', 'TSLA', 'SBUX', 'MELI', 'U00', 'U01', 'U02', 'U03'])
  })

  it('leaves out coverage work the reader dismissed', () => {
    env.suppressed = new Set([feedItemAttentionKey(coverageDecisionItem(bogey()[0]).id)!])
    render(<TodayPage />)
    expect(tickers()).not.toContain('AMZN')
  })
})

describe('first paint and empty states', () => {
  /*
   * REVERSED, deliberately, and the reason kept.
   *
   * This asserted that real findings paint while the coverage scan is still
   * running -- get the known work up, let the rest arrive. Measured on a cold
   * load at 1920x889, that is what "the loading is hitchy and happens in
   * different phases" turned out to be: tiles appeared at t~4.9s, then the
   * scan returned at t~5.3s and `layoutTotal` changed the supporting tiles'
   * WIDTH, then enrichment answered at t~6.2s and redrew every chart and
   * rewrote the text. Three assemblies in front of the reader.
   *
   * Painting early is only a kindness if what is painted then stays put. It
   * did not. So the field now waits for all three reads and renders once.
   */
  it('waits for the coverage scan rather than assembling the field in phases', () => {
    env.engine.action = [finding(1)]
    env.gaps = { status: 'loading', candidates: [], coveredCount: 0 }
    render(<TodayPage />)
    expect(tickers()).toEqual([])
    expect(screen.getByTestId('today-loading')).toBeInTheDocument()
  })

  it('waits for coverage instead of saying "You\'re current" when nothing real surfaced', () => {
    env.gaps = { status: 'loading', candidates: [], coveredCount: 0 }
    render(<TodayPage />)
    expect(screen.queryByText("You're current.")).not.toBeInTheDocument()
  })

  it('offers to choose coverage instead of "You\'re current" when there is none', () => {
    env.gaps = { status: 'ready', candidates: [], coveredCount: 0 }
    render(<TodayPage />)
    expect(screen.getByTestId('coverage-prompt')).toBeInTheDocument()
    expect(screen.queryByText("You're current.")).not.toBeInTheDocument()
  })

  it('still says "You\'re current" when coverage exists and has no work', () => {
    env.gaps = { status: 'ready', candidates: [], coveredCount: 12 }
    render(<TodayPage />)
    expect(screen.getByText("You're current.")).toBeInTheDocument()
  })
})

describe('coverage tiles act like every Today tile', () => {
  it('opens the Research workspace from Today, keeping Today as the way back', () => {
    render(<TodayPage />)
    fireEvent.click(within(tiles()[0]).getByRole('button', { name: /Write thesis/ }))
    const req = env.focus[env.focus.length - 1]
    expect(req.target).toMatchObject({ originLens: 'today', workspaceLens: 'research', objectId: 'a-amzn' })
  })

  it('shares its coverage source with the other lenses rather than forking one', () => {
    // Ideas has since grown its own thin-state (ideas-v2/__tests__). What must
    // stay true is that every lens reads the SAME candidates: one definition of
    // what the reader covers and what is missing on it, never a second scan.
    const ideas = readFileSync(path.join(process.cwd(), 'src/components/ideas-v2/IdeasWorkspace.tsx'), 'utf8')
    expect(ideas).toContain('useCoverageResearchGaps')
    // And it renders them in ITS shape, never by importing Today's or
    // Research's items.
    expect(ideas).not.toMatch(/coverageTodayItems|withCoverageSubjects/)
  })
})
