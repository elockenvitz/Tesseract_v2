// =============================================================================
// Portfolio Fundamentals — types and placeholder helper
//
// When real fundamentals data is available, swap getPlaceholderFundamentals()
// for a real implementation that populates before/after/delta/coverageCount.
// The UI (PortfolioFundamentalsCard) uses the same PortfolioFundamentalMetric[]
// shape regardless.
// =============================================================================

export type PortfolioFundamentalKey =
  | 'forward_pe'
  | 'ev_ebitda'
  | 'dividend_yield'
  | 'rev_growth'
  | 'eps_growth'
  | 'roe'
  // Secondary (shown behind "Show more")
  | 'price_book'
  | 'fcf_yield'
  | 'net_debt_ebitda'
  | 'gross_margin'

export type FundamentalFormat = 'percent' | 'multiple' | 'number'

export type FundamentalGroup = 'valuation' | 'income' | 'growth' | 'quality'

export interface PortfolioFundamentalMetric {
  key: PortfolioFundamentalKey
  label: string
  group: FundamentalGroup
  format: FundamentalFormat
  before: number | null
  after: number | null
  delta: number | null
  coverageCount: number
  coverageTotal: number
  isPlaceholder: boolean
  /** Secondary metrics are hidden behind "Show more" */
  isSecondary?: boolean
}

/** Metric definitions — order determines display order within each group */
const METRIC_DEFS: {
  key: PortfolioFundamentalKey
  label: string
  group: FundamentalGroup
  format: FundamentalFormat
  isSecondary?: boolean
}[] = [
  // Primary
  { key: 'forward_pe',    label: 'Forward P/E',    group: 'valuation', format: 'multiple' },
  { key: 'ev_ebitda',     label: 'EV/EBITDA',      group: 'valuation', format: 'multiple' },
  { key: 'dividend_yield', label: 'Dividend Yield', group: 'income',    format: 'percent' },
  { key: 'rev_growth',    label: 'Revenue Growth',  group: 'growth',    format: 'percent' },
  { key: 'eps_growth',    label: 'EPS Growth',      group: 'growth',    format: 'percent' },
  { key: 'roe',           label: 'ROE',             group: 'quality',   format: 'percent' },
  // Secondary
  { key: 'price_book',    label: 'Price/Book',      group: 'valuation', format: 'multiple', isSecondary: true },
  { key: 'fcf_yield',     label: 'FCF Yield',       group: 'income',    format: 'percent',  isSecondary: true },
  { key: 'net_debt_ebitda', label: 'Net Debt/EBITDA', group: 'quality', format: 'multiple', isSecondary: true },
  { key: 'gross_margin',  label: 'Gross Margin',    group: 'growth',    format: 'percent',  isSecondary: true },
]

/** Group display config */
export const FUNDAMENTAL_GROUPS: { key: FundamentalGroup; label: string }[] = [
  { key: 'valuation', label: 'Valuation' },
  { key: 'income',    label: 'Income' },
  { key: 'growth',    label: 'Growth' },
  { key: 'quality',   label: 'Quality' },
]

/**
 * Returns placeholder fundamentals metrics.
 * All values are null, coverage is 0/holdingsAfterCount.
 *
 * When real data is wired up, replace this with a function that
 * computes portfolio-weighted fundamentals from per-holding data.
 */
export function getPlaceholderFundamentals(
  holdingsAfterCount: number,
): PortfolioFundamentalMetric[] {
  return METRIC_DEFS.map(def => ({
    key: def.key,
    label: def.label,
    group: def.group,
    format: def.format,
    before: null,
    after: null,
    delta: null,
    coverageCount: 0,
    coverageTotal: holdingsAfterCount,
    isPlaceholder: true,
    isSecondary: def.isSecondary ?? false,
  }))
}
