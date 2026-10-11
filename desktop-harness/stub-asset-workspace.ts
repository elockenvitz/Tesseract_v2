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
  sections: [
    { section: 'thesis', content: 'Services mix is still being valued as hardware. The attach rate on the installed base has room before it is priced.', supportingDetail: null, updatedAt: '2026-09-28T10:00:00Z', authorName: 'Ana Bell' },
    { section: 'bull_case', content: 'Services crosses 30% of gross profit and the multiple re-rates with it.', supportingDetail: null, updatedAt: '2026-09-20T10:00:00Z', authorName: 'Ana Bell' },
    { section: 'bear_case', content: 'Regulatory pressure on App Store take rate compresses the best margin line.', supportingDetail: null, updatedAt: '2026-09-18T10:00:00Z', authorName: 'Tom Vega' },
    { section: 'base_case', content: '', supportingDetail: null, updatedAt: '2026-09-18T10:00:00Z', authorName: null },
  ] as never,
  evidence: [] as never,
  caseWrittenAt: '2026-09-28T10:00:00Z',
  coreSections: ['thesis', 'bull_case', 'bear_case', 'base_case'],
  history: [],
  spot: 231.4,
  ladder: null,
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

export function useAssetWorkspace(assetId: string | null) {
  const data = assetId === 'empty' ? EMPTY : POPULATED
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
