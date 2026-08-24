import type { ExploreItem } from '../explore-item'

/**
 * A realistic desk, built to stress the composition rather than to look tidy.
 *
 * Deliberately lopsided in the ways real data is lopsided: four items on one
 * ticker, six decisions against two workflow items, one artifact arriving
 * through two adapters, and a mix of gaps and genuine progress. A balanced
 * fixture would pass every diversity assertion without the code doing anything.
 *
 * Shared by the unit tests and the gallery so the two cannot drift.
 */

export const NOW = new Date('2026-08-20T12:00:00.000Z').getTime()
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString()

export const EXPLORE_FIXTURE: ExploreItem[] = [
  // ── Decisions ───────────────────────────────────────────────────────────
  {
    id: 'd-ceg-gap', dedupeKey: 'scenario_gap:ceg',
    category: 'decisions', subtype: 'signal',
    title: 'CEG is trading below your bear case',
    context: '22% under the worst outcome modelled',
    symbol: 'CEG', assetId: 'ceg', companyName: 'Constellation Energy',
    metric: { value: '22%', label: 'below bear', direction: 'bad' },
    portfolio: { weightPct: 12.4, name: 'Core Equity' },
    occurredAt: ago(3), importance: 0.9,
    destination: { kind: 'action', action: 'open_cases', assetId: 'ceg', symbol: 'CEG' },
  },
  {
    id: 'd-nvda-hit', dedupeKey: 'target_hit:nvda',
    category: 'decisions', subtype: 'signal',
    title: 'NVDA passed its target',
    context: 'Trading 31% through $118',
    symbol: 'NVDA', assetId: 'nvda', companyName: 'NVIDIA',
    metric: { value: '+31%', label: 'through target', direction: 'good' },
    // A reached target is a good outcome, and Explore should be able to say so.
    positive: true,
    portfolio: { weightPct: 8.1, name: 'Core Equity' },
    occurredAt: ago(1), importance: 0.85,
    destination: { kind: 'action', action: 'review_target', assetId: 'nvda', symbol: 'NVDA' },
  },
  {
    id: 'd-aapl-notarget', dedupeKey: 'no_target:aapl',
    category: 'decisions', subtype: 'signal',
    title: 'AAPL has no price target on record',
    context: '4.8% of Core Equity',
    symbol: 'AAPL', assetId: 'aapl', companyName: 'Apple',
    metric: { value: '4.8%', label: 'of the portfolio', direction: 'neutral' },
    portfolio: { weightPct: 4.8, name: 'Core Equity' },
    occurredAt: ago(30), importance: 0.55,
    destination: { kind: 'action', action: 'set_target', assetId: 'aapl', symbol: 'AAPL' },
  },
  {
    id: 'd-msft-expired', dedupeKey: 'target_expired:msft',
    category: 'decisions', subtype: 'signal',
    title: 'MSFT target has run past its horizon',
    context: '8 months past a 12 month view',
    symbol: 'MSFT', assetId: 'msft', companyName: 'Microsoft',
    metric: { value: '$420', label: 'stated target', direction: 'neutral' },
    portfolio: { weightPct: 6.3, name: 'Large Cap Growth' },
    occurredAt: ago(240), importance: 0.66,
    destination: { kind: 'action', action: 'review_target', assetId: 'msft', symbol: 'MSFT' },
  },

  // ── Research ────────────────────────────────────────────────────────────
  {
    id: 'r-nvda-thesis', dedupeKey: 'thesis:nvda',
    category: 'research', subtype: 'research',
    title: 'NVDA thesis strengthened after the datacenter print',
    context: 'Second revision this quarter',
    symbol: 'NVDA', assetId: 'nvda',
    source: { kind: 'person', label: 'Sarah Chen' },
    portfolio: { weightPct: 8.1, name: 'Core Equity' },
    positive: true, occurredAt: ago(2), importance: 0.5,
    destination: { kind: 'action', action: 'update_thesis', assetId: 'nvda', symbol: 'NVDA' },
  },
  {
    // The SAME artifact as above, arriving through the activity adapter. The
    // thinner preview must lose.
    id: 'r-activity-nvda', dedupeKey: 'thesis:nvda',
    category: 'research', subtype: 'research',
    title: 'Sarah Chen updated a thesis',
    source: { kind: 'person', label: 'Sarah Chen' },
    occurredAt: ago(2), importance: 0.2,
    destination: { kind: 'filter', category: 'research' },
  },
  {
    id: 'r-aapl-stale', dedupeKey: 'research_stale:aapl',
    category: 'research', subtype: 'research',
    title: 'AAPL has moved 18% since anyone last looked',
    context: '4.8% of Core Equity',
    symbol: 'AAPL', assetId: 'aapl',
    metric: { value: '+18%', label: 'since last look', direction: 'good' },
    portfolio: { weightPct: 4.8, name: 'Core Equity' },
    occurredAt: ago(48), importance: 0.7,
    destination: { kind: 'action', action: 'open_asset', assetId: 'aapl', symbol: 'AAPL' },
  },
  {
    id: 'r-roku-nothesis', dedupeKey: 'no_thesis:roku',
    category: 'research', subtype: 'research',
    title: 'ROKU has no research on record',
    context: '1.1% of Growth',
    symbol: 'ROKU', assetId: 'roku',
    portfolio: { weightPct: 1.1, name: 'Growth' },
    occurredAt: ago(5), importance: 0.4,
    destination: { kind: 'action', action: 'update_thesis', assetId: 'roku', symbol: 'ROKU' },
  },

  // ── Ideas ───────────────────────────────────────────────────────────────
  {
    id: 'i-clov-trade', dedupeKey: 'post:clov-1',
    category: 'ideas', subtype: 'idea',
    title: 'Long CLOV into the MA rate reset',
    context: 'Pair against the managed-care basket',
    symbol: 'CLOV', assetId: 'clov',
    source: { kind: 'person', label: 'Marcus Webb' },
    positive: true, occurredAt: ago(1), importance: 0.4,
    destination: { kind: 'action', action: 'open_asset', assetId: 'clov', symbol: 'CLOV' },
  },
  {
    id: 'i-aapl-thought', dedupeKey: 'post:aapl-2',
    category: 'ideas', subtype: 'idea',
    title: 'Services margin is doing more work than anyone credits',
    symbol: 'AAPL', assetId: 'aapl',
    source: { kind: 'person', label: 'Priya Raman' },
    positive: true, occurredAt: ago(2), importance: 0.35,
    destination: { kind: 'action', action: 'open_asset', assetId: 'aapl', symbol: 'AAPL' },
  },
  {
    id: 'i-tsm-note', dedupeKey: 'post:tsm-3',
    category: 'ideas', subtype: 'idea',
    title: 'TSM capex guide reads through to the whole chain',
    symbol: 'TSM', assetId: 'tsm',
    source: { kind: 'person', label: 'Marcus Webb' },
    positive: true, occurredAt: ago(4), importance: 0.35,
    destination: { kind: 'action', action: 'open_asset', assetId: 'tsm', symbol: 'TSM' },
  },

  // ── Workflow ────────────────────────────────────────────────────────────
  {
    id: 'w-q3', dedupeKey: 'attention:w-q3',
    category: 'workflow', subtype: 'workflow',
    title: 'Q3 sector review is two days overdue',
    source: { kind: 'person', label: 'You' },
    occurredAt: ago(2), importance: 0.3,
    destination: { kind: 'filter', category: 'workflow' },
  },
  {
    id: 'w-model', dedupeKey: 'attention:w-model',
    category: 'workflow', subtype: 'workflow',
    title: 'Semis model refresh awaiting review',
    source: { kind: 'person', label: 'Sarah Chen' },
    occurredAt: ago(6), importance: 0.35,
    destination: { kind: 'filter', category: 'workflow' },
  },

  // ── News ────────────────────────────────────────────────────────────────
  {
    id: 'n-aapl', dedupeKey: 'news:n-aapl',
    category: 'news', subtype: 'news',
    title: 'Apple wins partial reversal in App Store appeal',
    symbol: 'AAPL', assetId: 'aapl',
    source: { kind: 'market', label: 'Reuters' },
    occurredAt: ago(0.1), importance: 0.25,
    destination: { kind: 'action', action: 'open_asset', assetId: 'aapl', symbol: 'AAPL' },
  },
  {
    id: 'n-ceg-move', dedupeKey: 'unusual_move:ceg',
    category: 'news', subtype: 'news',
    title: 'CEG down 6.2% on the session',
    symbol: 'CEG', assetId: 'ceg',
    metric: { value: '-6.2%', label: 'today', direction: 'bad' },
    source: { kind: 'market', label: 'Market' },
    occurredAt: ago(0.2), importance: 0.3,
    destination: { kind: 'action', action: 'open_asset', assetId: 'ceg', symbol: 'CEG' },
  },
  {
    id: 'n-earnings', dedupeKey: 'earnings_ahead:tsm',
    category: 'news', subtype: 'news',
    title: 'TSM reports in three days',
    // Named, like the adapters do. This is the emptiest tile in the set — no
    // metric, no context, no price series — and it is the one the company-name
    // fallback exists for. Without it here the fixture could not show whether
    // the fallback lands.
    symbol: 'TSM', assetId: 'tsm', companyName: 'Taiwan Semiconductor',
    source: { kind: 'market', label: 'Market' },
    occurredAt: ago(0.5), importance: 0.3,
    destination: { kind: 'action', action: 'open_asset', assetId: 'tsm', symbol: 'TSM' },
  },
]
