/**
 * No surface that sizes a trade may invent a price.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * Every price expression in Trade Lab ended in `|| 100`. It reads as a
 * harmless display default and it is not one: `normalize-sizing` divides the
 * portfolio value by the price to get a share count, the result is persisted
 * as `accepted_trades.price_at_acceptance`, and `apply_trade_to_holdings`
 * then applies it to `portfolio_holdings.price`, `.cost` and the portfolio's
 * CASH balance.
 *
 * It reached production. `accepted_trades` carries `price_at_acceptance = 100`
 * for META (real close 682.31), V (369.93), PLTR (176.24) and LLY (1152.44).
 * META's share count is inflated 6.82x, and `useScorecards` reports an
 * instant -85% from the same number.
 *
 * The trigger was ordinary: `baseline?.price || 100` has no baseline holding
 * for a NEW position, and a circuit breaker disables the live-quote chain for
 * the rest of the session after one all-fail pass -- so after a single
 * provider outage, every trade booked in that session took the literal.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * A price is a live quote, a stored close, or the book's own last price.
 * Where none exists the answer is zero, which the sizing guard and the RPC
 * both reject loudly, so the trade is BLOCKED rather than booked wrong.
 *
 * This reads the source because the rule is about what the code may contain,
 * not about what one function returns: the defect was nineteen copies of the
 * same literal, and a behavioural test on any one of them would have passed
 * while the other eighteen shipped.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..', '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

/**
 * The file with its prose removed.
 *
 * These files carry comments that discuss the old literal by name -- that is
 * how the defect stays explained -- so the rule is about executable code, and
 * the comments must come out before it is applied.
 */
const codeOf = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(l => !l.trim().startsWith('//'))
  .join('\n')

/**
 * Every surface that builds a price which is then sized or booked against.
 *
 * `proposal-sizing.ts` was added after the fact. It held
 * `price > 0 ? price : 100` the whole time the other nineteen sites were
 * being cleaned up, and this list did not include it -- so the guard passed
 * while a placeholder shipped. Two lessons are encoded below: the list has to
 * name every sizing surface, and the pattern has to match the TERNARY form,
 * not just `||` and `??`.
 */
const SIZING_SURFACES = [
  'src/pages/SimulationPage.tsx',
  'src/components/trading/SuggestionReviewPanel.tsx',
  'src/components/trading/RecommendationEditorModal.tsx',
  'src/lib/trade-lab/proposal-sizing.ts',
  'src/lib/trade-lab/variant-price.ts',
]

describe('no sizing surface falls back to a fabricated price', () => {
  for (const rel of SIZING_SURFACES) {
    it(`${rel} has no literal price placeholder`, () => {
      // Three fallback spellings, all seen in this codebase:
      //   `|| 100`      the original nineteen
      //   `?? 100`      the same thing, nullish
      //   `: 100`       the ternary in `proposal-sizing.ts`, which the
      //                 first two patterns walked straight past
      // `\s*` spans newlines on purpose: one site was wrapped across four
      // lines and a line-oriented search missed it.
      const placeholders = codeOf(read(rel)).match(/(\|\||\?\?|:)\s*100\b/g) ?? []
      expect(placeholders).toEqual([])
    })
  }

  it('sizes only against a real observed price, and zero otherwise', () => {
    const src = read('src/pages/SimulationPage.tsx')
    // The ladder: live quote, then the stored close, then the book's price.
    expect(src).toContain('fetchLatestCloses')
    /*
     * An unknown price is an ABSENT key, never a value.
     *
     * This used to pin the exact line `if (r.price != null) prices[r.assetId]
     * = r.price`. The ladder now also records WHICH rung answered, so that
     * one statement became a block and the old pattern no longer matched.
     * Rewritten rather than dropped: the rule being guarded is unchanged, and
     * it is now expressed as "the write is conditional on a non-null price"
     * instead of as one exact line, so adding to the block does not break it
     * again.
     */
    expect(src).toMatch(/if \(r\.price != null\) \{[\s\S]{0,200}?prices\[r\.assetId\] = r\.price/)
    // The sentinel is zero, which the guards reject.
    expect(src).toMatch(/const NO_PRICE = 0\b/)
  })

  it('never sizes against a target price', () => {
    /*
     * A target price is an opinion about future value, not an observation of
     * what the instrument costs. Three rungs of the Trade Lab ladder ended in
     * `target_price`, which sized trades at the number the thesis implied
     * rather than the number the money buys -- and it is undated, so it could
     * not even be judged stale.
     */
    const src = codeOf(read('src/pages/SimulationPage.tsx'))
    expect(src).not.toMatch(/\|\|\s*(\(idea as any\)\.|tradeIdea\.|leg\.)?target_price/)
  })
})

describe('the stored-close fallback never invents a value', () => {
  it('omits a symbol it has no close for, rather than defaulting it', () => {
    const src = read('src/lib/market-data/latest-closes.ts')
    // Non-positive and non-finite closes are skipped, not coerced.
    expect(src).toMatch(/if \(!Number\.isFinite\(close\) \|\| close <= 0\) continue/)
    // A failed read returns an empty map -- not a map of guesses.
    expect(src).toMatch(/return out/)
    expect(codeOf(src)).not.toMatch(/(\|\||\?\?)\s*100\b/)
  })
})
