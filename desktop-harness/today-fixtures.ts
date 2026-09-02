/**
 * Engine output for the Today harness.
 *
 * Deliberately stubbed at the ENGINE boundary rather than at `TodayItem`, so
 * the real pipeline runs: `expandToObjects` unwraps the synthetic rollups,
 * `adaptDecisionItem` builds the tile model, `compareTodayItems` ranks and
 * `diversify` arranges. What the harness supplies is what the evaluators would
 * have produced; every composition decision under test is still made by the
 * product code.
 *
 * Shaped from the finding keys the tile actually maps tones for, one per
 * archetype the visual layer can draw, plus a genuine rollup parent so the
 * aggregate path is exercised.
 */
import type { DecisionItem } from '../src/engine/decisionEngine/types'
import type { EnrichmentMap } from '../src/lib/today'

const day = 86_400_000
const iso = (d: number) => new Date(Date.now() - d * day).toISOString()
const ymd = (d: number) => iso(d).slice(0, 10)

function closes(from: number, to: number, days: number, wobble = 0.05) {
  return Array.from({ length: days }, (_, i) => {
    const t = i / (days - 1)
    const drift = from + (to - from) * t
    const shape = Math.sin(t * Math.PI * 2.1) * from * wobble * (1 - t * 0.35)
    return { date: ymd(days - 1 - i), close: +(drift + shape).toFixed(2) }
  })
}

/** An unconfirmed execution: the only finding the tile treats as critical. */
const execution: DecisionItem = {
  id: 'f-exec-1', surface: 'action', severity: 'red', category: 'risk',
  title: 'Execution not confirmed', titleKey: 'EXECUTION_NOT_CONFIRMED',
  description: 'A 2.4% Buy in Global Equity was approved four days ago and no fill has been recorded against it.',
  chips: [{ label: 'Ticker', value: 'TSM' }, { label: 'Portfolio', value: 'Global Equity' }, { label: 'Age', value: '4d' }],
  context: {
    assetId: 'a-tsm', assetTicker: 'TSM', portfolioId: 'p1',
    portfolioName: 'Global Equity', action: 'Buy', proposedWeight: 2.4,
  },
  ctas: [{ label: 'Review execution', actionKey: 'REVIEW_THESIS', kind: 'primary' }],
  decisionTier: 'capital', sortScore: 980, createdAt: iso(4),
}

/** A proposal nobody has decided. */
const proposal: DecisionItem = {
  id: 'f-prop-1', surface: 'action', severity: 'orange', category: 'alpha',
  title: 'Proposal awaiting decision', titleKey: 'PROPOSAL_AWAITING_DECISION',
  description: 'A 4.5% Buy has been sitting in the deciding stage for eleven days while the price ran 8% toward the bull case.',
  chips: [{ label: 'Portfolio', value: 'Global Equity' }, { label: 'Ticker', value: 'LLY' }, { label: 'Age', value: '11d' }],
  context: {
    assetId: 'a-lly', assetTicker: 'LLY', portfolioId: 'p1',
    portfolioName: 'Global Equity', action: 'Buy', proposedWeight: 4.5,
    stage: 'deciding', urgency: 'high',
  },
  ctas: [{ label: 'Review decision', actionKey: 'REVIEW_THESIS', kind: 'primary' }],
  decisionTier: 'capital', sortScore: 910, createdAt: iso(11),
}

/**
 * The rollup. `postprocess` collapses repeated findings into a synthetic
 * parent, and Today unwraps it -- this is the fixture that proves it still
 * does, and that the children arrive as real objects with real context.
 */
const staleTheses: DecisionItem = {
  id: 'f-stale-parent', surface: 'action', severity: 'orange', category: 'process',
  title: '4 theses may be stale', titleKey: 'THESIS_STALE',
  description: 'Four theses have passed their review window.',
  context: {},
  ctas: [{ label: 'Review theses', actionKey: 'REVIEW_THESIS', kind: 'primary' }],
  decisionTier: 'integrity', sortScore: 870,
  children: [
    {
      id: 'f-stale-nvda', surface: 'action', severity: 'orange', category: 'process',
      title: 'Thesis may be stale', titleKey: 'THESIS_STALE',
      description: 'The thesis was written when the multiple was half this, and the position is now the largest in the book.',
      chips: [{ label: 'Ticker', value: 'NVDA' }, { label: 'Age', value: '214d' }],
      context: { assetId: 'a-nvda', assetTicker: 'NVDA', portfolioId: 'p1', portfolioName: 'Global Equity' },
      ctas: [{ label: 'Review thesis', actionKey: 'REVIEW_THESIS', kind: 'primary' }],
      decisionTier: 'integrity', sortScore: 860, createdAt: iso(214),
    },
    {
      id: 'f-stale-ko', surface: 'action', severity: 'yellow', category: 'process',
      title: 'Thesis may be stale', titleKey: 'THESIS_STALE',
      description: 'Pricing power in Latin America was the whole case and it has not been revisited in seven months.',
      chips: [{ label: 'Ticker', value: 'KO' }, { label: 'Age', value: '212d' }],
      context: { assetId: 'a-ko', assetTicker: 'KO', portfolioId: 'p2', portfolioName: 'Income' },
      ctas: [{ label: 'Review thesis', actionKey: 'REVIEW_THESIS', kind: 'primary' }],
      decisionTier: 'integrity', sortScore: 700, createdAt: iso(212),
    },
    {
      id: 'f-stale-xom', surface: 'action', severity: 'yellow', category: 'process',
      title: 'Thesis may be stale', titleKey: 'THESIS_STALE',
      description: 'Guyana breakevens are the equity story and the case has not been updated since the last disclosure.',
      chips: [{ label: 'Ticker', value: 'XOM' }, { label: 'Age', value: '168d' }],
      context: { assetId: 'a-xom', assetTicker: 'XOM', portfolioId: 'p1', portfolioName: 'Global Equity' },
      ctas: [{ label: 'Review thesis', actionKey: 'REVIEW_THESIS', kind: 'primary' }],
      decisionTier: 'integrity', sortScore: 640, createdAt: iso(168),
    },
    {
      id: 'f-stale-baba', surface: 'action', severity: 'yellow', category: 'process',
      title: 'Thesis may be stale', titleKey: 'THESIS_STALE',
      description: 'No claim has ever been written against this name and it has been open for eleven months.',
      chips: [{ label: 'Ticker', value: 'BABA' }, { label: 'Age', value: '324d' }],
      context: { assetId: 'a-baba', assetTicker: 'BABA', portfolioId: 'p2', portfolioName: 'Income' },
      ctas: [{ label: 'Review thesis', actionKey: 'REVIEW_THESIS', kind: 'primary' }],
      decisionTier: 'integrity', sortScore: 610, createdAt: iso(324),
    },
  ],
}

const ratingNoFollowup: DecisionItem = {
  id: 'f-rating-1', surface: 'action', severity: 'yellow', category: 'process',
  title: 'Rating change with no follow-up', titleKey: 'RATING_NO_FOLLOWUP',
  description: 'The rating moved from Hold to Buy three weeks ago and no research, target or sizing work followed it.',
  chips: [{ label: 'Ticker', value: 'DASH' }, { label: 'From', value: 'Hold' }, { label: 'To', value: 'Buy' }],
  context: {
    assetId: 'a-dash', assetTicker: 'DASH', portfolioId: 'p1',
    portfolioName: 'Global Equity', ratingFrom: 'Hold', ratingTo: 'Buy',
  },
  ctas: [{ label: 'Review rating', actionKey: 'REVIEW_THESIS', kind: 'primary' }],
  decisionTier: 'coverage', sortScore: 560, createdAt: iso(21),
}

const overdue: DecisionItem = {
  id: 'f-overdue-1', surface: 'action', severity: 'orange', category: 'project',
  title: 'Overdue deliverable', titleKey: 'OVERDUE_DELIVERABLE',
  description: 'The Q3 healthcare review was due nine days ago and has not been delivered.',
  chips: [{ label: 'Project', value: 'Q3 healthcare review' }, { label: 'Overdue', value: '9d' }],
  context: {
    assetId: 'a-pfe', assetTicker: 'PFE', projectName: 'Q3 healthcare review',
    overdueDays: 9, portfolioId: 'p1', portfolioName: 'Global Equity',
  },
  ctas: [{ label: 'Complete deliverable', actionKey: 'REVIEW_THESIS', kind: 'primary' }],
  decisionTier: 'coverage', sortScore: 520, createdAt: iso(9),
}

const highEv: DecisionItem = {
  id: 'f-ev-1', surface: 'intel', severity: 'blue', category: 'alpha',
  title: 'High expected return, no idea raised', titleKey: 'HIGH_EV_NO_IDEA',
  description: 'The desk framework implies 31% upside and nobody has raised an idea against it.',
  chips: [{ label: 'Ticker', value: 'MSFT' }, { label: 'Upside', value: '31%' }],
  context: { assetId: 'a-msft', assetTicker: 'MSFT', portfolioId: 'p1', portfolioName: 'Global Equity' },
  ctas: [{ label: 'Raise an idea', actionKey: 'RAISE_IDEA', kind: 'primary' }],
  decisionTier: 'coverage', sortScore: 410, createdAt: iso(2),
}

const notSimulated: DecisionItem = {
  id: 'f-sim-1', surface: 'intel', severity: 'blue', category: 'process',
  title: 'Idea not simulated', titleKey: 'IDEA_NOT_SIMULATED',
  description: 'An idea has been open for five weeks without a sizing simulation against the book.',
  chips: [{ label: 'Ticker', value: 'AAPL' }, { label: 'Age', value: '35d' }],
  context: { assetId: 'a-aapl', assetTicker: 'AAPL', portfolioId: 'p2', portfolioName: 'Income' },
  ctas: [{ label: 'Open simulation', actionKey: 'OPEN_SIMULATION', kind: 'primary' }],
  decisionTier: 'coverage', sortScore: 330, createdAt: iso(35),
}

export const ENGINE_SLICE = {
  action: [execution, proposal, staleTheses, ratingNoFollowup, overdue],
  intel: [highEv, notSimulated],
}

/** Cached history and framework for what surfaces. */
export const ENRICHMENT: EnrichmentMap = {
  'a-tsm': {
    history: closes(171, 189.4, 45), spot: 189.4, weightPct: 1.8,
    portfolioName: 'Global Equity', researchCount: 4,
  },
  'a-lly': {
    history: closes(820, 932.4, 60), spot: 932.4, weightPct: 3.2,
    portfolioName: 'Global Equity', researchCount: 7,
    ladder: {
      cases: [
        { name: 'Bear', price: 640 }, { name: 'Base', price: 880 }, { name: 'Bull', price: 1010 },
      ],
      updatedAt: iso(30),
    } as never,
  },
  'a-nvda': {
    history: closes(118, 141.8, 45), spot: 141.8, weightPct: 7.4,
    portfolioName: 'Global Equity', researchCount: 2,
  },
  'a-dash': {
    history: closes(180, 212.8, 45), spot: 212.8, weightPct: 0.9,
    portfolioName: 'Global Equity', researchCount: 3,
    ladder: {
      cases: [
        { name: 'Bear', price: 118 }, { name: 'Base', price: 165 }, { name: 'Bull', price: 205 },
      ],
      updatedAt: iso(64),
    } as never,
  },
  'a-pfe': { history: closes(27.4, 24.1, 45), spot: 24.1, weightPct: 2.1, portfolioName: 'Global Equity' },
  'a-msft': {
    history: closes(402, 448.2, 45), spot: 448.2, weightPct: 5.8,
    portfolioName: 'Global Equity', researchCount: 5,
    ladder: {
      cases: [
        { name: 'Bear', price: 360 }, { name: 'Base', price: 520 }, { name: 'Bull', price: 640 },
      ],
      updatedAt: iso(12),
    } as never,
  },
  'a-aapl': { history: closes(214, 226.9, 45), spot: 226.9, weightPct: 3.1, portfolioName: 'Income' },
}
