/**
 * Fixtures for the asset workspace — the one read behind both Snapshots.
 *
 * Two securities, because the interesting cases are the pair:
 *
 *   `aapl`  HELD in three books, with a written case, a target, live ideas
 *           and open decisions. The populated path.
 *   `empty` UNHELD, no case, no target, no ideas, no decisions. The path
 *           where a surface either says so honestly or invents something.
 *
 * Mirrors `AssetWorkspaceData` exactly, so a shape change breaks the harness
 * rather than silently rendering half a page.
 */

import { useEffect, useState } from 'react'
import type { AssetWorkspaceData, AssetPosition } from '../src/hooks/useAssetWorkspace'

const POSITIONS: AssetPosition[] = [
  {
    portfolioId: 'pf-growth', portfolioName: 'Tech & Consumer Growth',
    shares: 42_500, price: 231.4, marketValue: 9_834_500, weightPct: 2.55,
    avgCost: 188.2, unrealisedGain: 1_836_000, unrealisedPct: 22.9,
    asOf: '2026-10-10',
  },
  {
    portfolioId: 'pf-income', portfolioName: 'Core Income',
    shares: 8_200, price: 231.4, marketValue: 1_897_480, weightPct: 0.84,
    avgCost: 205.1, unrealisedGain: 215_660, unrealisedPct: 12.8,
    asOf: '2026-10-10',
  },
  {
    portfolioId: 'pf-opps', portfolioName: 'Special Opportunities',
    shares: 1_100, price: 231.4, marketValue: 254_540, weightPct: null,
    avgCost: 240.0, unrealisedGain: -9_460, unrealisedPct: -3.6,
    asOf: '2026-10-10',
  },
]

const POPULATED: AssetWorkspaceData = {
  /* `ThesisSection` is { section, content, supportingDetail, updatedAt, authorName }. */
  /*
   * All three CORE sections carry prose, and that is the point of the fixture.
   *
   * It used to hold `thesis` plus `bull_case` and `bear_case` — but the core
   * vocabulary is thesis / where_different / risks_to_thesis, so two of the
   * three core rows were missing and the Snapshot rendered "Not written"
   * twice. A surface whose job is to show the argument cannot be judged on a
   * fixture that has two thirds of the argument missing, and the empty
   * security (`?asset=empty`) already covers the nothing-written path.
   */
  sections: [
    { section: 'thesis', content: 'Services mix is still being valued as hardware. The attach rate on the installed base has room before it is priced, and the replacement cycle has stopped mattering to the revenue line.', supportingDetail: null, updatedAt: '2026-09-28T10:00:00Z', authorName: 'Ana Bell' },
    { section: 'where_different', content: 'Consensus treats the services take-rate as a policy variable that regulators will reset. We treat it as a contract term, which is why our 2028 services estimate sits 11% above the street.', supportingDetail: null, updatedAt: '2026-09-28T10:00:00Z', authorName: 'Ana Bell' },
    { section: 'risks_to_thesis', content: 'App Store remedies in the EU with a US equivalent would take 4-6% off services revenue, and the multiple would follow it down. China is the second: two thirds of the growth gap against our model is one country.', supportingDetail: null, updatedAt: '2026-09-18T10:00:00Z', authorName: 'Tom Vega' },
    { section: 'bull_case', content: 'Services crosses 30% of gross profit and the multiple re-rates with it.', supportingDetail: null, updatedAt: '2026-09-20T10:00:00Z', authorName: 'Ana Bell' },
    { section: 'bear_case', content: 'Regulatory pressure on App Store take rate compresses the best margin line.', supportingDetail: null, updatedAt: '2026-09-18T10:00:00Z', authorName: 'Tom Vega' },
  ] as never,
  evidence: [] as never,
  caseWrittenAt: '2026-09-28T10:00:00Z',
  /*
   * The real core vocabulary, which this listed wrongly.
   *
   * It said thesis / bull_case / bear_case / base_case. `CORE_SECTIONS` is
   * thesis / where_different / risks_to_thesis, and the phone filters its
   * sections through THIS list — so the differentiated view was filtered out
   * of the mobile Snapshot by the fixture, and the conclusion band rendered
   * without the one thing it leads on. The desktop reads `CORE_SECTIONS`
   * directly and was unaffected, which is how the two shells disagreed while
   * sharing a hook.
   */
  coreSections: ['thesis', 'where_different', 'risks_to_thesis'],
  history: [],
  spot: 231.4,
  /*
   * A real three-rung ladder, so the valuation visual actually renders.
   *
   * It was `null`, which meant `FrameworkScale` returned null and every
   * screenshot of this surface was taken with the valuation band missing —
   * a surface cannot be judged on a case it never shows. Spot (231.4) sits
   * between Base and Bull, which is the ordinary and most informative case:
   * inside the framework, with asymmetry still readable on both sides.
   */
  ladder: {
    assetId: 'aapl',
    symbol: 'AAPL',
    companyName: 'Apple Inc.',
    updatedAt: '2026-09-28T10:00:00Z',
    valid: true,
    reason: '',
    cases: [
      { scenarioId: 'sc-bear', name: 'Bear', price: 168, probability: 0.2, timeframe: '12m', reasoning: 'App Store remedies land.', id: 'pt-bear', userId: 'u-rivera' },
      { scenarioId: 'sc-base', name: 'Base', price: 224, probability: 0.55, timeframe: '12m', reasoning: 'Services attach holds.', id: 'pt-base', userId: 'u-rivera' },
      { scenarioId: 'sc-bull', name: 'Bull', price: 296, probability: 0.25, timeframe: '12m', reasoning: 'Attach rate re-rates.', id: 'pt-bull', userId: 'u-rivera' },
    ],
  },
  target: 268,
  positions: POSITIONS,
  liveIdeas: [
    { id: 'idea-1', action: 'add', stage: 'deciding', rationale: 'Accelerating backlog.', portfolioName: 'Tech & Consumer Growth' },
    { id: 'idea-2', action: 'trim', stage: 'researching', rationale: 'Trimming into strength.', portfolioName: 'Core Income' },
  ] as never,
  decisions: [
    { id: 'dr-1', action: 'add', portfolioId: 'pf-growth', portfolioName: 'Tech & Consumer Growth', decidedAt: null, decisionNote: 'Raising to target on the print.' },
    { id: 'dr-2', action: 'trim', portfolioId: 'pf-income', portfolioName: 'Core Income', decidedAt: '2026-05-27T14:02:00Z', decisionNote: 'Half size.' },
  ] as never,
}

const EMPTY: AssetWorkspaceData = {
  sections: [
    { section: 'thesis', content: '', supportingDetail: null, updatedAt: '2026-01-01T00:00:00Z', authorName: null },
    { section: 'bull_case', content: '', supportingDetail: null, updatedAt: '2026-01-01T00:00:00Z', authorName: null },
    { section: 'bear_case', content: '', supportingDetail: null, updatedAt: '2026-01-01T00:00:00Z', authorName: null },
  ] as never,
  evidence: [] as never,
  caseWrittenAt: null,
  coreSections: ['thesis', 'bull_case', 'bear_case'],
  history: [],
  spot: 18.2,
  ladder: null,
  target: null,
  positions: [],
  liveIdeas: [],
  decisions: [],
}

/**
 * `?loading=<ms>` makes this stub resolve ASYNCHRONOUSLY, like the real query.
 *
 * Returning `isLoading: false` on the first render is what let a conditional
 * hook reach the authenticated app. `InvestmentSnapshot` has
 * `if (isLoading) return <SnapshotSkeleton />` part-way down, and a `useMemo`
 * had been placed below it — so the loading render ran seven hooks and the
 * loaded render ran eight, which React cannot reconcile:
 *
 *     Rendered more hooks than during the previous render.
 *
 * Every harness surface and every test fixture skipped the loading branch
 * entirely, so none of them could see it. This makes the transition
 * reproducible in a real browser; `probe-snapshot.mjs` drives it.
 */
export function useAssetWorkspace(assetId: string | null) {
  const data = assetId === 'empty' ? EMPTY : POPULATED
  const delay = typeof window !== 'undefined'
    ? Number(new URLSearchParams(window.location.search).get('loading') ?? '0')
    : 0

  const [resolved, setResolved] = useState(delay <= 0)
  useEffect(() => {
    if (delay <= 0) return
    const t = setTimeout(() => setResolved(true), delay)
    return () => clearTimeout(t)
  }, [delay])

  if (!resolved) {
    // The shape the real hook returns while in flight: the empty skeleton
    // data, not the populated set, so nothing paints before it should.
    return { data: EMPTY, isLoading: true, error: null }
  }
  return { data, isLoading: false, error: null }
}

/*
 * The two selectors, inlined rather than re-exported.
 *
 * A re-export from '../src/hooks/useAssetWorkspace' would be rewritten back
 * to THIS module by the harness resolver — the plugin matches the path
 * suffix, so the stub would import itself. These are four lines of pure
 * selection; they are copied with the same rule the real ones use.
 */

/** The book the reader arrived from, then the largest stake, then nothing. */
export function primaryPosition(
  positions: AssetPosition[],
  portfolioId: string | null,
): AssetPosition | null {
  if (portfolioId) return positions.find(p => p.portfolioId === portfolioId) ?? null
  return positions[0] ?? null
}

/** Every book except the one already shown as primary. */
export function otherPositions(
  positions: AssetPosition[],
  primary: AssetPosition | null,
): AssetPosition[] {
  if (!primary) return positions
  return positions.filter(p => p.portfolioId !== primary.portfolioId)
}
