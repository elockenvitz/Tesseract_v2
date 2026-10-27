/**
 * Dev-only synthetic data for previewing the REAL AssetWorkspacePane (and its new
 * DecisionBand) at a URL, without production data or a login. Seeded into the
 * react-query cache under the hook's own key so the real component renders it.
 * Nothing here ships in the app bundle or touches production.
 */
import type { AssetWorkspaceData } from '../src/hooks/useAssetWorkspace'

export const AW_ASSET = { id: 'aw-demo', symbol: 'AAPL', company_name: 'Apple Inc.' }
export const AW_ORG = 'demo-org'

const position = {
  assetId: 'aw-demo', portfolioId: 'p-growth', portfolioName: 'Tech & Consumer Growth',
  shares: 12_000, price: 231.4, marketValue: 9_800_000,
  weightPct: 2.55, avgCost: 150, unrealisedGain: 977_000, unrealisedPct: 11.1, asOf: '2026-10-10',
} as any

const ladder = {
  assetId: 'aw-demo', symbol: 'AAPL', companyName: 'Apple Inc.', updatedAt: '2026-09-28', valid: true, reason: '',
  cases: [{ name: 'Bear', price: 168 }, { name: 'Base', price: 224 }, { name: 'Bull', price: 296 }],
} as any

const BASE: AssetWorkspaceData = {
  sections: [], evidence: [], caseWrittenAt: null, coreSections: [],
  history: [{ date: '2026-10-09', close: 232.6 }, { date: '2026-10-10', close: 231.4 }],
  spot: 231.4, ladder, target: 268, positions: [position], liveIdeas: [], decisions: [],
}

/** An asset with a request waiting on the reader: the band must render. */
export const AW_PENDING: AssetWorkspaceData = {
  ...BASE,
  liveIdeas: [{ id: 'idea-1', action: 'add', stage: 'deciding', rationale: null, portfolioName: 'Tech & Consumer Growth' }],
  decisions: [{
    id: 'req-1', status: 'pending', action: 'Add in Tech & Consumer Growth', decidedAt: null,
    portfolioId: 'p-growth', portfolioName: 'Tech & Consumer Growth', decisionNote: 'Raising to target on the print.',
  }],
}

/** Same asset, nothing pending: the band must collapse to nothing. */
export const AW_NONE: AssetWorkspaceData = {
  ...BASE,
  decisions: [{
    id: 'req-0', status: 'approved', action: 'Add in Tech & Consumer Growth', decidedAt: '2026-10-01',
    portfolioId: 'p-growth', portfolioName: 'Tech & Consumer Growth', decisionNote: null,
  }],
}
