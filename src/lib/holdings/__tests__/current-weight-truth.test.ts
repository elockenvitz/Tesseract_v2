/**
 * Current-weight truth: the baseline a decision is sized against.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `DecisionInbox` read `submission_snapshot.baseline_weight ?? 0`. Nothing
 * writes that path — the one writer nests it at
 * `submission_snapshot.sizing_context.baseline_weight` — so the lookup always
 * missed and the `?? 0` turned "we could not find out" into the factual claim
 * "we hold none of this name". Measured against production: 16 of 30 pending
 * requests rendered 0.00%, and 0 rows carried the nested path either.
 *
 * It is not cosmetic. Every delta framework computes
 * `target = current + delta`, so a wrong `current` yields a wrong target and
 * a wrong share count. `assertSizingAgreesWithInput` cannot catch it: for a
 * delta input the computed delta IS the input, so it agrees with itself no
 * matter which baseline it was added to.
 *
 * These tests pin the three states and the arithmetic that depends on them.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { currentBook, type HoldingRow } from '../portfolio-context'
import { weightOf } from '../../../hooks/useCurrentBook'

const SRC = resolve(__dirname, '../../..')
const codeOf = (s: string) =>
  s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')

const row = (
  portfolio_id: string,
  asset_id: string,
  shares: number,
  price: number,
  date = '2026-10-01',
): HoldingRow =>
  ({ portfolio_id, asset_id, shares, price, date } as unknown as HoldingRow)

/** A book big enough that a percentage is meaningful (MIN_POSITIONS_FOR_WEIGHT = 5). */
const bigBook = (): HoldingRow[] => [
  row('p1', 'a1', 100, 10), // 1000
  row('p1', 'a2', 100, 10), // 1000
  row('p1', 'a3', 100, 10), // 1000
  row('p1', 'a4', 100, 10), // 1000
  row('p1', 'a5', 600, 10), // 6000
]

describe('the three states of a current weight', () => {
  const book = currentBook(bigBook())

  it('a held position returns its measured share of the book', () => {
    // 1000 of 10000.
    expect(weightOf(book, 'p1', 'a1')).toBeCloseTo(10, 6)
    expect(weightOf(book, 'p1', 'a5')).toBeCloseTo(60, 6)
  })

  it('an asset ABSENT from the book is zero — we genuinely hold none', () => {
    expect(weightOf(book, 'p1', 'not-held')).toBe(0)
  })

  it('a book that has not loaded yet is undefined, never zero', () => {
    // The whole defect in one line: before the answer is known, the surface
    // must not assert "we hold none".
    expect(weightOf(undefined, 'p1', 'a1')).toBeUndefined()
    expect(weightOf(undefined, 'p1', 'a1')).not.toBe(0)
  })

  it('a held position whose share is unknowable is null, never zero', () => {
    // Too few positions for a percentage to mean anything.
    const thin = currentBook([row('p9', 'a1', 100, 10), row('p9', 'a2', 100, 10)])
    const w = weightOf(thin, 'p9', 'a1')
    expect(w).toBeNull()
    expect(w).not.toBe(0)
  })

  it('a held position with no price is null, never zero', () => {
    const noPrice = currentBook([
      ...bigBook(),
      ({ portfolio_id: 'p1', asset_id: 'a6', shares: 100, price: null, date: '2026-10-01' } as unknown as HoldingRow),
    ])
    expect(weightOf(noPrice, 'p1', 'a6')).toBeNull()
  })

  it('distinguishes not-held from unknowable — they are different answers', () => {
    const thin = currentBook([row('p9', 'a1', 100, 10), row('p9', 'a2', 100, 10)])
    expect(weightOf(thin, 'p9', 'a1')).toBeNull() // held, unknowable
    expect(weightOf(thin, 'p9', 'nope')).toBe(0) // not held
  })

  it('a missing portfolio or asset id is unknown, not zero', () => {
    expect(weightOf(book, null, 'a1')).toBeNull()
    expect(weightOf(book, 'p1', null)).toBeNull()
  })
})

describe('the baseline is the CURRENT book, not a frozen snapshot', () => {
  it('only the newest snapshot counts toward the weight', () => {
    // Same position on two dates. Counting both halves every weight — the
    // 36x inflation this module was extracted to prevent.
    const twoDates = currentBook([
      ...bigBook(),
      row('p1', 'a1', 100, 10, '2026-09-01'),
      row('p1', 'a2', 100, 10, '2026-09-01'),
      row('p1', 'a3', 100, 10, '2026-09-01'),
      row('p1', 'a4', 100, 10, '2026-09-01'),
      row('p1', 'a5', 600, 10, '2026-09-01'),
    ])
    expect(weightOf(twoDates, 'p1', 'a1')).toBeCloseTo(10, 6)
  })

  it('a later snapshot moves the baseline, so the same recommendation resizes', () => {
    const before = currentBook(bigBook())
    const after = currentBook([
      row('p1', 'a1', 300, 10, '2026-10-02'), // 3000
      row('p1', 'a2', 100, 10, '2026-10-02'),
      row('p1', 'a3', 100, 10, '2026-10-02'),
      row('p1', 'a4', 100, 10, '2026-10-02'),
      row('p1', 'a5', 600, 10, '2026-10-02'),
    ])
    // Buying 200 more shares of a1 grows the position AND the denominator:
    // 3000 of 12000, not 3000 of the old 10000. A baseline frozen at
    // submission would still say 10%.
    expect(weightOf(before, 'p1', 'a1')).toBeCloseTo(10, 6)
    expect(weightOf(after, 'p1', 'a1')).toBeCloseTo(25, 6)
  })
})

describe('target = current + delta, against the live baseline', () => {
  const book = currentBook(bigBook())
  const target = (portfolioId: string, assetId: string, delta: number) => {
    const current = weightOf(book, portfolioId, assetId)
    return typeof current === 'number' ? current + delta : null
  }

  it('an add resolves against the real holding, not zero', () => {
    // The defect produced 0 + 2 = 2%. The truth is 10 + 2 = 12%.
    expect(target('p1', 'a1', 2)).toBeCloseTo(12, 6)
    expect(target('p1', 'a1', 2)).not.toBeCloseTo(2, 6)
  })

  it('a trim is signed and resolves against the real holding', () => {
    expect(target('p1', 'a5', -10)).toBeCloseTo(50, 6)
  })

  it('a trim against a stale zero would have produced a negative target', () => {
    // 0 + (-10) = -10%: a short the PM never asked for. This is the concrete
    // harm of the fallback, and why an unknown baseline must refuse to size.
    const staleZero = 0
    expect(staleZero + -10).toBeLessThan(0)
    expect(target('p1', 'a5', -10)).toBeGreaterThan(0)
  })

  it('an unknown baseline refuses to produce a target at all', () => {
    const thin = currentBook([row('p9', 'a1', 100, 10), row('p9', 'a2', 100, 10)])
    const current = weightOf(thin, 'p9', 'a1')
    expect(current).toBeNull()
    expect(typeof current === 'number' ? current + 2 : null).toBeNull()
  })

  it('a not-held add starts from zero, which is correct here', () => {
    expect(target('p1', 'not-held', 2)).toBeCloseTo(2, 6)
  })
})

describe('the Decision Inbox reads the live book', () => {
  const inbox = codeOf(readFileSync(resolve(SRC, 'components/trading/DecisionInbox.tsx'), 'utf8'))

  it('no longer reads the baseline the writer never wrote', () => {
    expect(inbox).not.toContain('snapshot?.baseline_weight as number) ?? 0')
  })

  it('resolves the current weight through the shared book', () => {
    expect(inbox).toContain('useCurrentBook()')
    expect(inbox).toContain('weightOf(')
  })

  it('does not classify or compute a delta against an unknown baseline', () => {
    expect(inbox).toContain('currentWeightKnown')
    expect(inbox).toMatch(/const delta = targetWeight != null && currentWeightKnown/)
    expect(inbox).toMatch(/const tc = targetWeight != null && currentWeightKnown/)
  })

  it('never formats an unknown weight as a number', () => {
    // `currentWeight.toFixed(2)` unguarded is the render half of the defect.
    expect(inbox).not.toMatch(/\{currentWeight\.toFixed\(2\)\}% →/)
    expect(inbox).toContain('currentWeightKnown ? (')
  })
})

describe('one shared query, so N rows do not cost N fetches', () => {
  const hook = codeOf(readFileSync(resolve(SRC, 'hooks/useCurrentBook.ts'), 'utf8'))

  it('keys the book by org alone, so every caller shares one cache entry', () => {
    expect(hook).toContain("queryKey: ['current-book', currentOrgId]")
  })

  it('reads portfolio_holdings exactly once', () => {
    expect(hook.match(/\.from\('portfolio_holdings'\)/g) ?? []).toHaveLength(1)
  })

  it('orders newest-first so a truncating limit drops the oldest rows', () => {
    expect(hook).toContain("order('date', { ascending: false, nullsFirst: false })")
  })

  it('applies the date rule inside currentBook rather than trusting the caller', () => {
    expect(hook).toContain('currentBook(')
    expect(hook).not.toContain('latestSnapshotRows')
  })
})
