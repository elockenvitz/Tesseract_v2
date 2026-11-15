/**
 * The Large Cap Growth failure, as a regression fixture.
 *
 * ── What happened ───────────────────────────────────────────────────────
 *
 * A reader attached the Large Cap Growth portfolio and asked "what are my
 * active ideas for this portfolio?". ACT AI replied that the portfolio
 * lookup had failed and it could not retrieve holdings or active ideas, and
 * suggested opening the Idea Pipeline by hand.
 *
 * The production log named the cause exactly:
 *
 *     ai-chat tool get_portfolio/holdings failed:
 *     column portfolio_holdings.weight does not exist
 *
 * Four defects, each tested below:
 *
 *   1. `weight` is not a column. The live table holds shares, price, cost
 *      and date; weight is derived, as the frontend has always derived it.
 *   2. A holdings failure returned a flat error, discarding the portfolio
 *      the tool had already resolved — which is why a question about IDEAS
 *      was answered with a failure about HOLDINGS.
 *   3. Holdings were never collapsed to one snapshot, so summing them
 *      double-counts every asset by its number of stored dates.
 *   4. `get_idea_pipeline` had no portfolio scope at all, so the question
 *      was unanswerable even with a perfect portfolio lookup.
 *
 * ── The fixtures are the real rows ──────────────────────────────────────
 *
 * Read from production on 2026-11-13 and pasted verbatim. Five holdings on
 * one snapshot date, three queue items of which exactly ONE is live. The
 * correct answer to the reader's question is one idea, not three and not
 * zero, and that is asserted rather than described.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  currentSnapshot,
  weightHoldings,
  sectorBreakdown,
  categorizeIdeas,
  degradedNote,
  type HoldingRow,
} from '../../../../supabase/functions/_shared/portfolio-ideas'
import { summarizeToolResult, toolOk, isLiveIdeaRow } from '../../../../supabase/functions/_shared/research-results'

/* ── The real portfolio ──────────────────────────────────────────────── */

const LCG = 'a2693ece-cdb7-4f17-a292-7c4a55df8c68'

/** portfolio_holdings for Large Cap Growth, verbatim from production. */
const LCG_HOLDINGS: HoldingRow[] = [
  { asset_id: 'a-msft', portfolio_id: LCG, date: '2025-08-02', shares: '80.0000', price: '385.2000', cost: '350.75', asset: { id: 'a-msft', symbol: 'MSFT', company_name: 'Microsoft', sector: 'Technology' } },
  { asset_id: 'a-aapl', portfolio_id: LCG, date: '2025-08-02', shares: '150.0000', price: '175.5000', cost: '165.20', asset: { id: 'a-aapl', symbol: 'AAPL', company_name: 'Apple', sector: 'Technology' } },
  { asset_id: 'a-googl', portfolio_id: LCG, date: '2025-08-02', shares: '120.0000', price: '142.8000', cost: '135.40', asset: { id: 'a-googl', symbol: 'GOOGL', company_name: 'Alphabet', sector: 'Communication Services' } },
  { asset_id: 'a-tsla', portfolio_id: LCG, date: '2025-08-02', shares: '60.0000', price: '248.9000', cost: '220.15', asset: { id: 'a-tsla', symbol: 'TSLA', company_name: 'Tesla', sector: 'Consumer Discretionary' } },
  { asset_id: 'a-amzn', portfolio_id: LCG, date: '2025-08-02', shares: '95.0000', price: '155.3000', cost: '148.90', asset: { id: 'a-amzn', symbol: 'AMZN', company_name: 'Amazon', sector: 'Consumer Discretionary' } },
]

/** trade_queue_items for Large Cap Growth, verbatim. Two are executed. */
const LCG_IDEAS = [
  { id: 'idea-aapl-live', asset_id: 'a-aapl', portfolio_id: LCG, stage: 'ready_to_recommend', status: 'deciding', outcome: null, visibility_tier: 'active', action: 'buy' },
  { id: 'idea-coin-done', asset_id: 'a-coin', portfolio_id: LCG, stage: 'deciding', status: 'approved', outcome: 'executed', visibility_tier: 'active', action: 'buy' },
  { id: 'idea-aapl-done', asset_id: 'a-aapl', portfolio_id: LCG, stage: 'deciding', status: 'approved', outcome: 'executed', visibility_tier: 'active', action: 'sell' },
]

const live = <T extends { outcome?: unknown; status?: unknown; stage?: unknown }>(rows: readonly T[]) =>
  rows.filter(r => isLiveIdeaRow(r as never))

/* ── 1. The column that does not exist ───────────────────────────────── */

describe('weight is derived, because the column never existed', () => {
  it('computes a weight from shares and price', () => {
    const snap = weightHoldings(LCG_HOLDINGS)

    /* MSFT: 80 x 385.20 = 30,816 of a 103,964.50 book. */
    const msft = snap.holdings.find(h => h.symbol === 'MSFT')!
    expect(msft.market_value).toBe(30816)
    expect(msft.weight_pct).toBeCloseTo(29.64, 1)
  })

  it('agrees with the total the portfolio page shows', () => {
    /* `PortfolioTab.tsx:357` sums shares x price over the same snapshot. Two
       numbers for one book is the failure this pins. */
    const expected = LCG_HOLDINGS.reduce(
      (n, h) => n + Number(h.shares) * Number(h.price), 0,
    )
    expect(weightHoldings(LCG_HOLDINGS).total_market_value).toBeCloseTo(expected, 2)
  })

  it('weights sum to 100', () => {
    const total = weightHoldings(LCG_HOLDINGS)
      .holdings.reduce((n, h) => n + (h.weight_pct ?? 0), 0)
    expect(total).toBeCloseTo(100, 1)
  })

  it('states what the weight was derived from', () => {
    /* Provenance is enforced here, not encouraged: a derived figure needs a
       path back to what produced it, and these are stored marks on a date
       fifteen months old. */
    const snap = weightHoldings(LCG_HOLDINGS)
    expect(snap.as_of).toBe('2025-08-02')
    expect(snap.weight_basis).toContain('shares x price')
    expect(snap.weight_basis).toContain('2025-08-02')
    expect(snap.weight_basis).toContain('not live prices')
  })

  it('orders by market value, largest first', () => {
    expect(weightHoldings(LCG_HOLDINGS).holdings.map(h => h.symbol))
      .toEqual(['MSFT', 'AAPL', 'GOOGL', 'TSLA', 'AMZN'])
  })
})

describe('an unpriced holding is kept, not dropped', () => {
  it('keeps the row with a null weight', () => {
    const snap = weightHoldings([
      ...LCG_HOLDINGS,
      { asset_id: 'a-new', portfolio_id: LCG, date: '2025-08-02', shares: '10', price: null, asset: { id: 'a-new', symbol: 'NEW', company_name: 'Newco', sector: 'Technology' } },
    ])

    const newco = snap.holdings.find(h => h.symbol === 'NEW')
    /*
     * Dropping it would make the other five add to 100% of a book that is
     * missing a position the desk owns. Zeroing it would assert a mark of
     * zero. Neither is true, so the weight is null and the count is stated.
     */
    expect(newco).toBeDefined()
    expect(newco!.weight_pct).toBeNull()
    expect(snap.rows_without_price).toBe(1)
  })
})

/* ── 2. Holdings collapse ────────────────────────────────────────────── */

describe('one snapshot, not every date ever stored', () => {
  const TWO_DATES: HoldingRow[] = [
    { asset_id: 'a-aapl', date: '2025-08-02', shares: '150', price: '175.50', asset: { symbol: 'AAPL' } },
    { asset_id: 'a-aapl', date: '2025-07-01', shares: '100', price: '170.00', asset: { symbol: 'AAPL' } },
    { asset_id: 'a-msft', date: '2025-08-02', shares: '80', price: '385.20', asset: { symbol: 'MSFT' } },
  ]

  it('keeps the newest row per asset', () => {
    const { kept, superseded } = currentSnapshot(TWO_DATES)
    expect(kept).toHaveLength(2)
    expect(superseded).toBe(1)
    expect(kept.find(k => k.asset_id === 'a-aapl')!.shares).toBe('150')
  })

  it('does not double-count an asset across its snapshots', () => {
    /* Both AAPL rows summed is 150x175.50 + 100x170 = 43,325, against the
       true 26,325. The documented "portfolio holdings collapse" defect. */
    const snap = weightHoldings(TWO_DATES)
    expect(snap.holdings).toHaveLength(2)
    expect(snap.total_market_value).toBeCloseTo(26325 + 30816, 2)
    expect(snap.superseded_rows).toBe(1)
  })

  it('does not trust the caller to have ordered the rows', () => {
    /* The query that fed this ordered by a column that does not exist, so
       the comparison happens where a test can see it. */
    const reversed = [...TWO_DATES].reverse()
    expect(currentSnapshot(reversed).kept.find(k => k.asset_id === 'a-aapl')!.shares)
      .toBe('150')
  })

  it('prefers any dated row over an undated one', () => {
    const { kept } = currentSnapshot([
      { asset_id: 'a-aapl', date: null, shares: '1' },
      { asset_id: 'a-aapl', date: '2025-01-01', shares: '150' },
    ])
    expect(kept[0].shares).toBe('150')
  })

  it('counts rows carrying no asset rather than guessing at them', () => {
    const { withoutAsset, kept } = currentSnapshot([
      ...TWO_DATES,
      { asset_id: null, date: '2025-08-02', shares: '5', price: '1' },
    ])
    expect(withoutAsset).toBe(1)
    expect(kept).toHaveLength(2)
  })
})

describe('sector weights come off the same snapshot as the holdings', () => {
  it('cannot disagree with the holding weights', () => {
    const snap = weightHoldings(LCG_HOLDINGS)
    const sectors = sectorBreakdown(snap.holdings)
    const sum = sectors.reduce((n, s) => n + s.weight_pct, 0)
    expect(sum).toBeCloseTo(100, 1)
    expect(sectors[0].sector).toBe('Technology')
  })
})

/* ── 3. The three relationships, kept apart ──────────────────────────── */

describe('a portfolio has ideas; the names it holds are not the same thing', () => {
  const OTHER_BOOK = 'p-other'

  const MIXED = [
    ...LCG_IDEAS,
    /* About AAPL, which LCG holds, but recorded against another book. */
    { id: 'idea-aapl-other', asset_id: 'a-aapl', portfolio_id: OTHER_BOOK, stage: 'researching', status: 'active', outcome: null, visibility_tier: 'active' },
    /* About MSFT, which LCG holds, recorded against no book. */
    { id: 'idea-msft-none', asset_id: 'a-msft', portfolio_id: null, stage: 'exploring', status: 'active', outcome: null, visibility_tier: 'active' },
    /* Nothing to do with LCG. */
    { id: 'idea-nvda', asset_id: 'a-nvda', portfolio_id: OTHER_BOOK, stage: 'developing', status: 'active', outcome: null, visibility_tier: 'active' },
  ]

  const heldIds = () => weightHoldings(LCG_HOLDINGS, 1000)
    .holdings.map(h => h.asset_id!).filter(Boolean)

  it('answers the reader with one live associated idea, not three', () => {
    /*
     * The real answer. Three rows carry this portfolio_id, but two are
     * executed and therefore history. A reader told "three" would be told
     * their book has two live ideas it does not have.
     */
    const split = categorizeIdeas(live(LCG_IDEAS), LCG, heldIds())
    expect(split.associated.map(i => i.id)).toEqual(['idea-aapl-live'])
  })

  it('does not call an idea on a held name an idea for the portfolio', () => {
    const split = categorizeIdeas(live(MIXED), LCG, heldIds())
    expect(split.associated.map(i => i.id)).toEqual(['idea-aapl-live'])
    expect(split.held.map(i => i.id).sort()).toEqual(['idea-aapl-other', 'idea-msft-none'])
    expect(split.elsewhere.map(i => i.id)).toEqual(['idea-nvda'])
  })

  it('never puts one idea in two groups', () => {
    const split = categorizeIdeas(live(MIXED), LCG, heldIds())
    const all = [...split.associated, ...split.held, ...split.elsewhere].map(i => i.id)
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(live(MIXED).length)
  })

  it('treats an unresolved portfolio as no association rather than all of them', () => {
    /* The failure mode worth guarding: a null portfolio id must not make
       every idea "associated" by vacuous equality. */
    const split = categorizeIdeas(live(MIXED), null, heldIds())
    expect(split.associated).toHaveLength(0)
  })

  it('uses the current snapshot for held names, not every row ever stored', () => {
    /* An asset sold out of the book two snapshots ago must not make an
       unrelated idea look like a position. */
    const sold = [
      ...LCG_HOLDINGS,
      { asset_id: 'a-nvda', portfolio_id: LCG, date: '2024-01-01', shares: '10', price: '100', asset: { id: 'a-nvda', symbol: 'NVDA' } },
    ]
    /* NVDA is present on an OLDER date only, so it is still in the newest
       row per asset -- it has only one row. Remove it by superseding. */
    const superseded = [
      ...sold,
      { asset_id: 'a-nvda', portfolio_id: LCG, date: '2025-08-02', shares: '0', price: '100', asset: { id: 'a-nvda', symbol: 'NVDA' } },
    ]
    const snap = weightHoldings(superseded, 1000)
    const nvda = snap.holdings.find(h => h.symbol === 'NVDA')!
    expect(nvda.shares).toBe(0)
    expect(nvda.market_value).toBe(0)
  })
})

/* ── 4. A half-answer stays an answer ────────────────────────────────── */

describe('a failed sub-lookup does not discard the part that worked', () => {
  it('names what failed and says the rest is usable', () => {
    const note = degradedNote(["the portfolio's holdings"])
    expect(note).toContain("the portfolio's holdings")
    expect(note).toContain('The rest of this result is complete')
    expect(note).toContain('do not describe the missing part as empty')
  })

  it('is empty when nothing failed, so the key can be omitted', () => {
    expect(degradedNote([])).toBe('')
  })

  it('stays an ok result, because "partial" is read as an error', () => {
    /*
     * The contract here is three states. `summarizeToolResult` treats an
     * unrecognised status -- "partial" included -- AS AN ERROR, and there is
     * a test on that in research-results.test.ts. So a degraded result must
     * be `ok` carrying its gap in the payload. Any other shape would send
     * the model back to "the lookup failed", which is the sentence this
     * whole change exists to stop.
     */
    const degraded = toolOk('get_portfolio', {
      portfolio_id: LCG,
      name: 'Large Cap Growth',
      holdings_returned: 0,
      holdings_unavailable: true,
      degraded: degradedNote(["the portfolio's holdings"]),
    })

    const summary = summarizeToolResult('get_portfolio', degraded, () => {})
    expect(summary.status).toBe('ok')
    expect(summary.status).not.toBe('error')

    const payload = JSON.parse(degraded)
    expect(payload.name).toBe('Large Cap Growth')
    expect(payload.portfolio_id).toBe(LCG)
  })

  it('the old shape told the model the whole lookup had failed', () => {
    /*
     * What the reader actually got. Kept as a test so the regression has a
     * shape, not just a description: a flat error carries no portfolio id,
     * no name, and an instruction to report failure.
     */
    const old = JSON.stringify({
      tool: 'get_portfolio',
      status: 'error',
      stage: 'holdings',
      note: 'This lookup FAILED. You do not know whether matching records exist. Say the lookup failed; do not say none were found.',
    })
    const summary = summarizeToolResult('get_portfolio', old, () => {})
    expect(summary.status).toBe('error')
    expect(JSON.parse(old).name).toBeUndefined()
  })
})

/* ── Edge cases the brief names ──────────────────────────────────────── */

describe('the cases a portfolio question can land in', () => {
  it('an empty associated pipeline is empty, not "the firm has no ideas"', () => {
    const split = categorizeIdeas(
      [{ id: 'i1', asset_id: 'a-nvda', portfolio_id: 'p-other' }],
      LCG,
      ['a-aapl'],
    )
    expect(split.associated).toHaveLength(0)
    /* And the others are still reported, so "none on this book" cannot be
       rendered as "none anywhere". */
    expect(split.elsewhere).toHaveLength(1)
  })

  it('a portfolio with no holdings still reports its associated ideas', () => {
    const split = categorizeIdeas(live(LCG_IDEAS), LCG, [])
    expect(split.associated.map(i => i.id)).toEqual(['idea-aapl-live'])
  })

  it('a portfolio whose holdings failed still reports its associated ideas', () => {
    /* The brief's case: "portfolio lookup failure with successful
       independent idea retrieval". Holdings only decide the `held` group. */
    const split = categorizeIdeas(live(LCG_IDEAS), LCG, null)
    expect(split.associated).toHaveLength(1)
    expect(split.held).toHaveLength(0)
  })

  it('switching portfolios changes the answer', () => {
    const a = categorizeIdeas(live(LCG_IDEAS), LCG, [])
    const b = categorizeIdeas(live(LCG_IDEAS), 'p-other', [])
    expect(a.associated).toHaveLength(1)
    expect(b.associated).toHaveLength(0)
    expect(b.elsewhere).toHaveLength(1)
  })

  it('no holdings and no ideas is an honest nothing', () => {
    const snap = weightHoldings([])
    expect(snap.holdings).toHaveLength(0)
    expect(snap.total_market_value).toBeNull()
    expect(snap.weight_basis).toBeNull()
    const split = categorizeIdeas([], LCG, [])
    expect(split.associated).toHaveLength(0)
  })

  it('survives null and undefined everywhere', () => {
    expect(weightHoldings(null).holdings).toEqual([])
    expect(weightHoldings(undefined).holdings).toEqual([])
    expect(currentSnapshot(null).kept).toEqual([])
    expect(categorizeIdeas(null, LCG, null).associated).toEqual([])
    expect(categorizeIdeas(undefined, null, undefined).elsewhere).toEqual([])
  })
})

/* ── The column names, read off the function that uses them ──────────── */

describe('the tool asks for columns the table actually has', () => {
  const edge = readFileSync(
    join(process.cwd(), 'supabase/functions/ai-chat/index.ts'),
    'utf8',
  )

  /** Every `portfolio_holdings` select in the edge function. */
  const selects = () => [...edge.matchAll(
    /from\("portfolio_holdings"\)\s*\n?\s*\.select\(([\s\S]{0,400}?)\)\s*\n/g,
  )].map(m => m[1])

  it('selects no column called weight, anywhere', () => {
    /*
     * The literal defect, guarded at the source. `portfolio_holdings` holds
     * id, portfolio_id, asset_id, shares, price, cost, created_at,
     * updated_at, created_by, date -- verified against production on
     * 2026-11-13. A select naming `weight` is rejected by Postgres, and a
     * rejected sub-query is what produced the reported answer.
     *
     * This reads source text, which is normally the wrong kind of test. It
     * is the right kind here: the failure was a STRING sent to Postgres, and
     * no amount of behavioural testing against a mock can catch a column
     * name that is wrong only against the live schema.
     */
    const found = selects()
    expect(found.length).toBeGreaterThan(0)
    for (const sel of found) {
      expect(sel, sel).not.toMatch(/\bweight\b/)
    }
  })

  it('never orders holdings by weight either', () => {
    /* The context prompt ordered by it too, which is why an attached
       portfolio's top holdings were arbitrary. */
    const ordered = [...edge.matchAll(/\.order\("weight"/g)]
    expect(ordered).toHaveLength(0)
  })
})

/* ── Drift against the frontend's own snapshot rule ──────────────────── */

describe('the snapshot rule matches the one the UI uses', () => {
  it('is the same newest-row-per-asset rule as currentHoldings', () => {
    /*
     * Two implementations of one rule, joined by a test rather than by
     * hope. `currentHoldings` cannot be imported into a Deno edge function,
     * so the behaviour is compared on a shared case instead of the source.
     */
    const rows = [
      { asset_id: 'a', portfolio_id: 'p', date: '2025-02-01' },
      { asset_id: 'a', portfolio_id: 'p', date: '2025-01-01' },
      { asset_id: 'b', portfolio_id: 'p', date: '2025-01-01' },
    ]
    const mine = currentSnapshot(rows).kept
    expect(mine).toHaveLength(2)
    expect(mine.find(r => r.asset_id === 'a')!.date).toBe('2025-02-01')

    /* And the frontend helper still exists to agree with. */
    const src = readFileSync(
      join(process.cwd(), 'src/lib/portfolio/currentHoldings.ts'),
      'utf8',
    )
    expect(src).toContain('export function currentHoldings')
  })
})
