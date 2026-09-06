import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import { SignalCardSection } from '../SignalCardSection'
import { PricePane } from '../../signals/PricePane'
import { CasePane } from '../../signals/CasePane'
import { buildInsightCard } from '../../../lib/signals/builders/legacy-kinds'
import {
  caseCoverageFrom, framingWantsPrice, researchCopy, researchIssueFor,
  researchSignalTypeFor, reviewClocks,
} from '../../../lib/research/case-state'
import { horizonContaining } from '../../../lib/research/since-review'
import { FEED_CHART_PLOT } from '../../../lib/signals/chart-geometry'
import type { DerivedInsight } from '../../../hooks/mobile/useDerivedInsights'
import type { CoreSection } from '../../../lib/research/case-state'

/**
 * No Core Thesis and New Research get the SAME chart. Proven by rendering.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * A phone reported that No Core Thesis → Price was visibly taller than every
 * other family's Price pane, after a pass whose evidence was gallery fixtures
 * and call-site reading. Both of those said the families were identical, and
 * neither actually mounted the tree `MobileDashboard` builds for a Research
 * card — which is where a divergence would have to live.
 *
 * So this builds the card through the real rule, composes its panes the way
 * `MobileDashboard` composes them (including the two different `pricePane`
 * argument sets the two framings use), mounts the real `PricePane`, and
 * compares the resulting plot boxes to each other and to the token.
 *
 * jsdom still reports no pixels. What it can prove is that the two framings
 * reach the same element with the same geometry classes and no `plot="fill"`
 * anywhere — that the paths do not diverge, which is the claim in question.
 */

// The series, mocked at the hook so the real `PricePane` renders its drawable
// state rather than its loading one. Everything below the hook is real.
const SERIES = Array.from({ length: 260 }, (_, i) => ({
  date: new Date(Date.UTC(2025, 8, 1 + i)).toISOString().slice(0, 10),
  close: 100 + Math.sin(i / 12) * 8 + i * 0.05,
}))

vi.mock('../../../hooks/mobile/useSymbolHistory', () => ({
  useSymbolHistory: () => ({ data: SERIES, isLoading: false }),
}))

const DAY = 86_400_000
const NOW = new Date('2026-08-31T00:00:00.000Z').getTime()
const ago = (d: number) => new Date(NOW - d * DAY).toISOString()

/**
 * A Research insight through the real rule, in a given framing.
 *
 * `no_case` is produced the only way it can be — by a name with nothing
 * written — rather than by hand-building the issue, so the fixture cannot be a
 * shape the hook could never emit.
 */
function insight(framing: 'no_case' | 'new_evidence'): DerivedInsight {
  const written: CoreSection[] = framing === 'no_case'
    ? []
    : ['thesis', 'where_different', 'risks_to_thesis']
  const coverage = caseCoverageFrom(
    written.map(section => ({ section, hasContent: true, updated_at: ago(192) })),
  )
  const clocks = reviewClocks(coverage, null)
  const evidence = framing === 'new_evidence'
    ? [{ id: 'e1', at: ago(20), kind: 'note' as const, title: 'On fire', authorName: 'Priya Raman' }]
    : []
  const issue = researchIssueFor({ clocks, coverage, evidence, movePct: null, now: NOW })!
  expect(issue.framing).toBe(framing)

  const symbol = framing === 'no_case' ? 'GOOGL' : 'PLTR'
  const copy = researchCopy({ symbol, issue, portfolioName: 'Vision Fund 10K', weightPct: 4.1, held: true })
  return {
    id: `research-${framing}`,
    kind: researchSignalTypeFor(issue.framing) === 'no_research' ? 'no_thesis' : 'stale_research',
    headline: copy.headline,
    body: copy.body,
    prompt: copy.prompt,
    assetId: 'a1', symbol, companyName: symbol,
    portfolioName: 'Vision Fund 10K', portfolioId: 'p1', weightPct: 4.1,
    held: true, portfolioCount: 1, liveIdeas: [], coverageOwners: ['John Homler'],
    evidenceCount: evidence.length,
    issue,
    caseWrittenAt: clocks.caseWrittenAt,
    researchReviewAt: null,
    reviewAnchor: clocks.effectiveAnchor,
    anchoredOn: clocks.anchoredOn,
    daysSinceReview: issue.daysSinceReview,
    daysSinceWritten: issue.daysSinceWritten,
    score: 1,
  } as DerivedInsight
}

/**
 * The price pane, composed with the SAME arguments `MobileDashboard` passes.
 *
 * The two branches genuinely differ, and that difference is the only thing
 * that could have made one family's chart another size: an anchored framing
 * gets a marker and a horizon wide enough to contain it, and an authoring
 * framing gets plain market context with neither. Both go through the one
 * `pricePane` helper, so both must land on the same geometry.
 */
function pricePaneFor(ins: DerivedInsight) {
  const framing = ins.issue.framing
  return framingWantsPrice(framing)
    ? (
      <PricePane
        symbol={ins.symbol!}
        markers={ins.caseWrittenAt
          ? [{ date: ins.caseWrittenAt, label: 'Case written', kind: 'event' as const }]
          : []}
        initialRange={horizonContaining(ins.reviewAnchor, NOW) ?? undefined}
      />
    )
    // `no_case` / `incomplete_case` where the position is real.
    : <PricePane symbol={ins.symbol!} markers={[]} />
}

function renderResearchCard(framing: 'no_case' | 'new_evidence') {
  const ins = insight(framing)
  const built = buildInsightCard(ins)
  if (!built.ok) throw new Error(`suppressed: ${built.reason}`)

  const { container } = render(
    <SignalCardSection
      card={built.card}
      panes={[
        { id: 'price', label: 'Price', content: pricePaneFor(ins) },
        {
          id: 'case',
          label: 'Case',
          content: (
            <CasePane
              present={ins.issue.present}
              caseWrittenAt={ins.caseWrittenAt}
              daysSinceWritten={ins.daysSinceWritten}
              held portfolioName={ins.portfolioName} weightPct={ins.weightPct}
              coverageOwners={ins.coverageOwners}
              motivate={framing === 'no_case'}
            />
          ),
        },
      ]}
      onOpenAsset={() => {}} onCapture={() => {}} onSnooze={() => {}}
      onDismiss={() => {}} onPrimary={() => {}}
    />
  )
  return container
}

/** The box the standard is applied to: the SVG's grandparent. */
function plotBox(c: HTMLElement): HTMLElement {
  const svg = c.querySelector('[data-testid="price-chart"]')
  if (!svg) throw new Error('no chart rendered — the pane did not reach PriceContext')
  return svg.parentElement!.parentElement as HTMLElement
}

describe('the No Core Thesis price pane reaches the shared standard', () => {
  it('mounts a real chart at all, through the real PricePane', () => {
    // If this ever fails the rest is meaningless: it would mean the framing
    // reaches the loading or the "no history" branch, neither of which is the
    // path under test.
    const c = renderResearchCard('no_case')
    expect(c.querySelector('[data-testid="price-context"]')).toBeTruthy()
    expect(c.querySelector('[data-slot="price-loading"]')).toBeNull()
    expect(c.querySelector('[data-slot="no-price-history"]')).toBeNull()
  })

  it('takes the feed geometry, not the fill path', () => {
    const box = plotBox(renderResearchCard('no_case'))
    expect(box.getAttribute('data-plot-geometry')).toBe('feed')
    for (const cls of FEED_CHART_PLOT.split(' ')) expect(box.className).toContain(cls)
    // The two ways a chart could grow past the standard, both closed.
    expect(box.className).not.toContain('flex-1')
    expect(box.className).toContain('grow-0')
  })

  it('resolves to exactly the same geometry as New Research', () => {
    /**
     * The comparison the phone report is about. The two framings differ in
     * their markers, their horizon, their headline, their pane count and
     * whether they carry a Respond pane — and in none of that is there a
     * height.
     */
    const noCase = plotBox(renderResearchCard('no_case'))
    const newEvidence = plotBox(renderResearchCard('new_evidence'))
    expect(noCase.className).toBe(newEvidence.className)
    expect(noCase.getAttribute('data-plot-geometry'))
      .toBe(newEvidence.getAttribute('data-plot-geometry'))
  })

  it('states its height rather than inheriting what is left over', () => {
    /**
     * The actual bug, and why No Core Thesis was the family that showed it.
     *
     * The height was a ceiling over a box that could still shrink, so on a
     * short screen it resolved to `workspace - pane chrome`, and the workspace
     * is `card - HEADER - description - footer`. This framing carries the
     * lightest header of any family - no question line, no Respond pane - so
     * it was the only one still reaching the ceiling while every other family
     * shrank beneath it. Measured at 400px wide: 105px of header here against
     * 213 on Case vs Price, which is 108px of chart.
     *
     * The band is now chosen from the viewport before flex distributes
     * anything, so no amount of header can reach it.
     */
    const box = plotBox(renderResearchCard('no_case'))
    expect(box.className).toContain('h-[128px]')
    expect(box.className).toContain('[@media(min-height:720px)]:h-[160px]')
    expect(box.className).toContain('[@media(min-height:768px)]:h-[208px]')
    expect(box.className).not.toContain('max-h-')
  })

  it('names no family, framing or card anywhere in its geometry', () => {
    // The chart height must not be able to learn which card it is on.
    const box = plotBox(renderResearchCard('no_case'))
    for (const word of ['no_case', 'research', 'idea', 'scenario', 'framing']) {
      expect(box.className).not.toContain(word)
    }
  })

  it('leaves the case pane on the full workspace', () => {
    // §10. The standard is about charts. The pane holding the thesis rows,
    // exposure and coverage keeps everything the carousel gives it.
    const c = renderResearchCard('no_case')
    const casePane = c.querySelector('[data-slot="case-pane"]') as HTMLElement
    expect(casePane).toBeTruthy()
    expect(casePane.className).toContain('h-full')
    expect(casePane.className).not.toContain('280px')
  })
})
