/**
 * Fixtures for the desktop Ideas harness.
 *
 * Shaped to exercise every visual primitive the card can select, in the order
 * `read()` chooses them: range, target, sizing, since, exposure, cases, gap.
 * Not test data in the assertion sense -- this exists so the field can be
 * rendered, screenshotted and measured at a real desktop width.
 */
import type { IdeaRow } from '../src/lib/desktop-ideas'
import type { ScanExposure, ScanFrame } from '../src/hooks/useDesktopIdeas'

const day = 86_400_000
const iso = (d: number) => new Date(Date.now() - d * day).toISOString()
const ymd = (d: number) => iso(d).slice(0, 10)

/** A close series walking from `from` to `to` with a mid-course wobble. */
function series(from: number, to: number, days: number, wobble = 0.06) {
  return Array.from({ length: days }, (_, i) => {
    const t = i / (days - 1)
    const drift = from + (to - from) * t
    const shape = Math.sin(t * Math.PI * 2.2) * from * wobble * (1 - t * 0.4)
    return { date: ymd(days - 1 - i), close: +(drift + shape).toFixed(2) }
  })
}

const base = (over: Partial<IdeaRow>): IdeaRow => ({
  id: 'x', assetId: 'ax', symbol: 'XXX', companyName: 'Example',
  direction: 'buy', stage: 'researching', maturity: 'researching',
  conviction: null, thesis: null, urgency: null, proposedWeight: null,
  portfolioId: 'p1', portfolioName: 'Global Equity', createdBy: 'u1',
  authorName: 'Eric Lockenvitz', createdAt: iso(20), updatedAt: null,
  decisionOutcome: null, ...over,
})

export const IDEAS: IdeaRow[] = [
  base({
    id: 'i-lly', assetId: 'a-lly', symbol: 'LLY', companyName: 'Eli Lilly & Co',
    direction: 'buy', maturity: 'decision_ready', conviction: 'high', urgency: 'high',
    thesis: 'Incretin capacity comes online two quarters ahead of consensus, and the Street is still modelling the supply constraint as the demand ceiling.',
    proposedWeight: 4.5, createdAt: iso(38),
  }),
  base({
    id: 'i-pfe', assetId: 'a-pfe', symbol: 'PFE', companyName: 'Pfizer Inc',
    direction: 'sell', maturity: 'deciding', conviction: 'high',
    thesis: 'The 2028 LOE cliff is being financed with buybacks rather than pipeline, and the acquired assets do not bridge it.',
    proposedWeight: 0, createdAt: iso(61),
  }),
  base({
    id: 'i-msft', assetId: 'a-msft', symbol: 'MSFT', companyName: 'Microsoft Corp',
    direction: 'buy', maturity: 'thesis_forming', conviction: 'medium',
    thesis: 'Copilot seat attach is running ahead of the disclosed number, but capex per incremental seat has not been tested through a full refresh.',
    createdAt: iso(12),
  }),
  base({
    id: 'i-dash', assetId: 'a-dash', symbol: 'DASH', companyName: 'DoorDash Inc',
    direction: 'buy', maturity: 'decision_ready',
    thesis: 'Grocery order frequency is compounding faster than the restaurant cohort ever did, at a contribution margin nobody has modelled separately.',
    proposedWeight: 2.0, createdAt: iso(96),
  }),
  base({
    id: 'i-aapl', assetId: 'a-aapl', symbol: 'AAPL', companyName: 'Apple Inc',
    direction: 'hold', maturity: 'researching',
    thesis: 'Services gross margin has carried three years of flat hardware. The question is whether the installed base can absorb another price step.',
    createdAt: iso(140),
  }),
  base({
    id: 'i-nvda', assetId: 'a-nvda', symbol: 'NVDA', companyName: 'NVIDIA Corp',
    direction: 'sell', maturity: 'deciding', urgency: 'urgent',
    thesis: 'Position is now the largest in the book on a thesis written when the multiple was half this.',
    createdAt: iso(7),
  }),
  base({
    id: 'i-ko', assetId: 'a-ko', symbol: 'KO', companyName: 'Coca-Cola Co',
    direction: 'buy', maturity: 'researching',
    thesis: 'Pricing power in Latin America is being read as inflation pass-through when it is mix.',
    createdAt: iso(210),
  }),
  base({
    id: 'i-bab', assetId: 'a-bab', symbol: 'BABA', companyName: 'Alibaba Group',
    direction: 'buy', maturity: 'researching', thesis: null, createdAt: iso(320),
  }),
  base({
    id: 'i-tsm', assetId: 'a-tsm', symbol: 'TSM', companyName: 'Taiwan Semiconductor',
    direction: 'buy', maturity: 'thesis_forming',
    thesis: 'N2 pricing holds because there is no second source, and that is a structurally different margin story from N5.',
    createdAt: iso(45),
  }),
  base({
    id: 'i-xom', assetId: 'a-xom', symbol: 'XOM', companyName: 'Exxon Mobil',
    direction: 'hold', maturity: 'researching',
    thesis: 'Guyana breakevens are the whole equity story and they are not disclosed at the asset level.',
    createdAt: iso(160),
  }),
]

/** LLY/DASH get a full ladder (range); PFE a target; others fall further down. */
export const FRAMEWORK: Record<string, ScanFrame> = {
  'a-lly': {
    ladder: [{ name: 'Bear', price: 640 }, { name: 'Base', price: 880 }, { name: 'Bull', price: 1010 }],
    spot: 932.4, target: 880, closes: series(820, 932.4, 40),
    casesNamed: 3, caseNames: ['Bear', 'Base', 'Bull'],
  },
  'a-dash': {
    ladder: [{ name: 'Bear', price: 118 }, { name: 'Base', price: 165 }, { name: 'Bull', price: 205 }],
    spot: 212.8, target: 165, closes: series(180, 212.8, 40),
    casesNamed: 3, caseNames: ['Bear', 'Base', 'Bull'],
  },
  'a-pfe': { target: 32.5, spot: 24.1, closes: series(27.4, 24.1, 70) },
  'a-msft': { spot: 448.2, closes: series(402, 448.2, 40) },
  'a-aapl': { spot: 226.9, closes: series(214, 226.9, 40) },
  'a-nvda': { spot: 141.8, closes: series(118, 141.8, 30) },
  'a-ko': { casesNamed: 2, caseNames: ['Bear', 'Base'] },
  'a-tsm': { spot: 189.4, closes: series(171, 189.4, 40) },
}

/** MSFT/NVDA/AAPL/XOM are held; that is what makes sizing and exposure real. */
export const EXPOSURE: Record<string, ScanExposure> = {
  'a-msft': { pct: 5.8, rank: 2, of: 42, largestPct: 7.4, portfolioId: 'p1' },
  'a-nvda': { pct: 7.4, rank: 1, of: 42, largestPct: 7.4, portfolioId: 'p1' },
  'a-aapl': { pct: 3.1, rank: 8, of: 42, largestPct: 7.4, portfolioId: 'p1' },
  'a-xom': { pct: 1.2, rank: 24, of: 42, largestPct: 7.4, portfolioId: 'p1' },
  'a-dash': { pct: 0.9, rank: 30, of: 42, largestPct: 7.4, portfolioId: 'p1' },
}

/** The price the desk recorded when the idea was written. */
export const OPEN_PRICE: Record<string, number> = {
  'i-msft': 402.1, 'i-aapl': 214.4, 'i-tsm': 171.2,
}
