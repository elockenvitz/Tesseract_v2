/**
 * The Portfolio lens, with a book behind it.
 *
 * Without this the harness resolved no portfolio and the lens rendered a blank
 * page -- exactly the trap `stub-research` was written to close, and exactly
 * why two rounds of "apply this to the other lenses" shipped changes to
 * Portfolio that nobody had looked at.
 *
 * The book is built from the SAME fixtures the Ideas field uses, so a name
 * carries one price, one weight and one framework wherever it appears. A
 * harness whose lenses disagree about NVDA is worse than no harness.
 */
import type { Book, Position } from '../src/lib/portfolio/holdings'
import type { PositionFrame } from '../src/lib/desktop-portfolio/model'
import { FRAMEWORK, EXPOSURE } from './fixtures'

interface Row {
  assetId: string; symbol: string; name: string; sector: string
  weightPct: number; price: number; days: number | null
  evidence: number; newEvidence: number; ladder: boolean
}

/*
 * Twenty-two lines, because the shape of a book is part of what the lens is
 * for. Six names would make every distribution look flat and every "against
 * the whole book" comparison meaningless.
 */
const ROWS: Row[] = [
  { assetId: 'a-nvda', symbol: 'NVDA', name: 'NVIDIA Corp', sector: 'Information Technology', weightPct: 7.4, price: 141.8, days: 214, evidence: 2, newEvidence: 0, ladder: false },
  { assetId: 'a-msft', symbol: 'MSFT', name: 'Microsoft Corp', sector: 'Information Technology', weightPct: 5.8, price: 448.2, days: 12, evidence: 6, newEvidence: 1, ladder: false },
  { assetId: 'a-lly', symbol: 'LLY', name: 'Eli Lilly & Co', sector: 'Health Care', weightPct: 4.9, price: 932.4, days: 38, evidence: 5, newEvidence: 0, ladder: true },
  { assetId: 'a-aapl', symbol: 'AAPL', name: 'Apple Inc', sector: 'Information Technology', weightPct: 3.1, price: 226.9, days: 152, evidence: 4, newEvidence: 2, ladder: false },
  { assetId: 'a-tsm', symbol: 'TSM', name: 'Taiwan Semiconductor', sector: 'Information Technology', weightPct: 2.8, price: 189.4, days: 21, evidence: 4, newEvidence: 0, ladder: false },
  { assetId: 'a-pfe', symbol: 'PFE', name: 'Pfizer Inc', sector: 'Health Care', weightPct: 2.1, price: 24.1, days: 140, evidence: 3, newEvidence: 1, ladder: false },
  { assetId: 'a-xom', symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy', weightPct: 1.9, price: 118.2, days: 168, evidence: 2, newEvidence: 0, ladder: false },
  { assetId: 'a-jpm', symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financials', weightPct: 1.7, price: 214.6, days: 44, evidence: 3, newEvidence: 0, ladder: false },
  { assetId: 'a-baba', symbol: 'BABA', name: 'Alibaba Group', sector: 'Consumer Discretionary', weightPct: 1.6, price: 84.3, days: null, evidence: 1, newEvidence: 0, ladder: false },
  { assetId: 'a-dash', symbol: 'DASH', name: 'DoorDash Inc', sector: 'Consumer Discretionary', weightPct: 1.4, price: 212.8, days: 64, evidence: 6, newEvidence: 2, ladder: true },
  { assetId: 'a-ko', symbol: 'KO', name: 'Coca-Cola Co', sector: 'Consumer Staples', weightPct: 1.3, price: 71.2, days: 212, evidence: 2, newEvidence: 0, ladder: false },
  { assetId: 'a-unh', symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Health Care', weightPct: 1.2, price: 512.4, days: 71, evidence: 3, newEvidence: 0, ladder: false },
  { assetId: 'a-cat', symbol: 'CAT', name: 'Caterpillar Inc', sector: 'Industrials', weightPct: 1.1, price: 348.9, days: 96, evidence: 2, newEvidence: 1, ladder: false },
  { assetId: 'a-nee', symbol: 'NEE', name: 'NextEra Energy', sector: 'Utilities', weightPct: 0.9, price: 78.5, days: 133, evidence: 1, newEvidence: 0, ladder: false },
  { assetId: 'a-lin', symbol: 'LIN', name: 'Linde plc', sector: 'Materials', weightPct: 0.8, price: 462.1, days: 58, evidence: 2, newEvidence: 0, ladder: false },
  { assetId: 'a-amt', symbol: 'AMT', name: 'American Tower', sector: 'Real Estate', weightPct: 0.7, price: 198.3, days: 187, evidence: 1, newEvidence: 0, ladder: false },
  { assetId: 'a-vz', symbol: 'VZ', name: 'Verizon', sector: 'Communication Services', weightPct: 0.6, price: 41.7, days: 204, evidence: 1, newEvidence: 0, ladder: false },
  { assetId: 'a-cost', symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer Staples', weightPct: 0.6, price: 894.2, days: 33, evidence: 2, newEvidence: 0, ladder: false },
  { assetId: 'a-adbe', symbol: 'ADBE', name: 'Adobe Inc', sector: 'Information Technology', weightPct: 0.5, price: 512.8, days: 119, evidence: 1, newEvidence: 0, ladder: false },
  { assetId: 'a-nke', symbol: 'NKE', name: 'Nike Inc', sector: 'Consumer Discretionary', weightPct: 0.4, price: 72.4, days: 241, evidence: 1, newEvidence: 0, ladder: false },
  { assetId: 'a-mrk', symbol: 'MRK', name: 'Merck & Co', sector: 'Health Care', weightPct: 0.3, price: 108.9, days: 88, evidence: 1, newEvidence: 0, ladder: false },
  { assetId: 'a-tel', symbol: 'TEL', name: 'TE Connectivity', sector: 'Information Technology', weightPct: 0.2, price: 152.1, days: 266, evidence: 0, newEvidence: 0, ladder: false },
]

const TOTAL = 4_820_000_000
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

const position = (r: Row): Position => ({
  portfolioId: 'p1',
  assetId: r.assetId,
  symbol: r.symbol,
  companyName: r.name,
  sector: r.sector,
  shares: Math.round((TOTAL * (r.weightPct / 100)) / r.price),
  price: r.price,
  avgCost: +(r.price * 0.86).toFixed(2),
  marketValue: TOTAL * (r.weightPct / 100),
  weightPct: r.weightPct,
  asOf: ago(1).slice(0, 10),
  isCash: false,
})

const cash: Position = {
  portfolioId: 'p1', assetId: 'a-cash', symbol: 'CASH', companyName: 'Cash',
  sector: null, shares: 0, price: 1, avgCost: null,
  marketValue: TOTAL * 0.575, weightPct: 57.5, asOf: ago(1).slice(0, 10), isCash: true,
}

const BOOK = {
  portfolioId: 'p1',
  positions: [...ROWS.map(position), cash],
  totalValue: TOTAL,
  cashValue: cash.marketValue,
  cashPct: 57.5,
} as unknown as Book

const FRAMES: Record<string, PositionFrame> = Object.fromEntries(ROWS.map(r => {
  const f = FRAMEWORK[r.assetId] as { ladder?: unknown } | undefined
  return [r.assetId, {
    thesisUpdatedAt: r.days == null ? null : ago(r.days),
    daysSinceReview: r.days,
    newEvidence: r.newEvidence,
    evidenceCount: r.evidence,
    // Only where the fixture genuinely has priced rungs. A ladder invented for
    // the harness would make tiles draw a scale the real lens cannot.
    ladder: r.ladder && f?.ladder
      ? ({
          assetId: r.assetId, symbol: r.symbol, companyName: r.name,
          cases: f.ladder, updatedAt: ago(r.days ?? 30), valid: true, reason: '',
        } as never)
      : null,
    liveIdea: r.symbol === 'LLY'
      ? ({ id: 'i-lly', action: 'buy', stage: 'decision_ready', createdAt: ago(38) } as never)
      : null,
  } satisfies PositionFrame]
}))

export const usePortfolioList = () => ({
  portfolios: [
    { id: 'p1', name: 'Global Equity', role: 'pm', positionCount: ROWS.length },
    { id: 'p2', name: 'Income', role: 'analyst', positionCount: 14 },
  ] as never,
  isLoading: false,
})

export const useBook = (portfolioId: string | null) =>
  ({ book: portfolioId ? BOOK : null, isLoading: false })

export const useBookFrames = (_book: Book | null) => FRAMES

export const usePositionDetail = (p: Position | null) => {
  if (!p) return { detail: undefined, isLoading: false }
  const f = FRAMEWORK[p.assetId] as
    { closes?: unknown; spot?: number; target?: number } | undefined
  const e = EXPOSURE[p.assetId]
  return {
    detail: {
      history: f?.closes ?? [],
      spot: f?.spot ?? p.price,
      target: f?.target ?? null,
      evidenceCount: FRAMES[p.assetId]?.evidenceCount ?? 0,
      sectionCount: 3,
      rank: e?.rank ?? null,
      of: e?.of ?? ROWS.length,
    } as never,
    isLoading: false,
  }
}
