import { describe, expect, it } from 'vitest'

import { composeFeed, longestRun, type ComposeScope } from '../feed-compose'
import { rankFeed } from '../feed-priority'
import { buildPool, NOW, toInput, type Cand } from './feed-pool.fixture'

/**
 * The rules the composed order has to obey.
 *
 * ── The two halves of the contract ────────────────────────────────────────
 *
 * PRIORITY decides who may compete. REPETITION decides who wins among equals.
 * Everything below is one of those two statements, or the guarantee that the
 * pass changes order and nothing else.
 *
 * Small hand-built pools where the point is a specific interaction; the
 * reconstructed feed-sized pool where the point is that it holds at scale.
 */

const compose = (cands: Cand[], scope: ComposeScope = 'mixed', opts = {}) => composeFeed(
  rankFeed(cands, toInput, NOW),
  {
    familyOf: (c: Cand) => c.family,
    subjectOf: (c: Cand) => c.symbol,
    categoryOf: (c: Cand) => c.category,
    scope,
    trace: true,
    ...opts,
  },
)

const families = (r: ReturnType<typeof compose>) => r.order.map(x => x.item.family)
const ids = (r: ReturnType<typeof compose>) => r.order.map(x => x.item.id)

/** A candidate with everything defaulted, so a case states only what it means. */
const cand = (over: Partial<Cand> & Pick<Cand, 'id' | 'family' | 'symbol'>): Cand => ({
  kind: 'lens', category: 'portfolio', type: 'no_research',
  severity: 'attention', weightPct: null, held: true,
  deviationPct: null, occurredAt: null,
  ...over,
})

// ─────────────────────────────────────────────────────────────────────────────
// §16 — the five cases the brief names
// ─────────────────────────────────────────────────────────────────────────────

describe('CASE A · similar importance interleaves', () => {
  /**
   * Three no-thesis findings and a crowding finding, all within a whisker of
   * each other. Nothing here is dominant, so the reader should meet more than
   * one question.
   */
  const pool = [
    cand({ id: 'nt1', family: 'research:no_case', symbol: 'AAPL', weightPct: 6 }),
    cand({ id: 'nt2', family: 'research:no_case', symbol: 'MSFT', weightPct: 6 }),
    cand({ id: 'nt3', family: 'research:no_case', symbol: 'NVDA', weightPct: 6 }),
    // Two, not one. Three of a family and a single alternative cannot avoid a
    // run of two plus one however the pass behaves; the case is about what
    // happens when a real choice exists, so it has to contain one.
    cand({ id: 'cr1', family: 'crowding', symbol: 'GOOGL', weightPct: 6 }),
    cand({ id: 'cr2', family: 'crowding', symbol: 'AMZN', weightPct: 6 }),
  ]

  it('does not run one question three deep', () => {
    const out = compose(pool)
    expect(longestRun(out.order.map(r => r.item), c => c.family)).toBeLessThanOrEqual(2)
    expect(families(out).slice(0, 3)).toContain('crowding')
  })

  it('still leads with the highest-priority candidate', () => {
    // Diversity may reorder what follows. It may never reorder the first card,
    // because nothing precedes it and nothing can therefore repeat.
    const ranked = rankFeed(pool, toInput, NOW)
    expect(compose(pool).order[0].input.id).toBe(ranked[0].input.id)
  })
})

describe('CASE B · a critical cluster stays together', () => {
  /**
   * Three framework breaks that dominate everything else. §9: the feed should
   * be allowed to show them consecutively, and must not insert a weak card to
   * alternate tile types.
   *
   * Note what is NOT here: no threshold, no "importance gap" constant. The
   * minor card is simply never a competitor, because it was never close.
   */
  const pool = [
    cand({ id: 'fb1', family: 'portfolio:framework_break', symbol: 'AAPL',
      type: 'scenario_gap', severity: 'critical', weightPct: 12, deviationPct: 25 }),
    cand({ id: 'fb2', family: 'portfolio:framework_break', symbol: 'NVDA',
      type: 'scenario_gap', severity: 'critical', weightPct: 11, deviationPct: 24 }),
    cand({ id: 'fb3', family: 'portfolio:framework_break', symbol: 'MSFT',
      type: 'scenario_gap', severity: 'critical', weightPct: 10, deviationPct: 23 }),
    cand({ id: 'cr1', family: 'crowding', symbol: 'JNJ',
      type: 'crowding', severity: 'informational', weightPct: 0.4 }),
  ]

  it('shows all three breaks before the minor finding', () => {
    expect(families(compose(pool)).slice(0, 3))
      .toEqual(Array(3).fill('portfolio:framework_break'))
  })

  it('says in the trace that nothing was close enough', () => {
    const out = compose(pool)
    expect(out.trace[2].reason).toBe('no-competitor')
    expect(out.trace[2].competitors).toBe(0)
  })

  it('and takes the alternative the moment one IS close', () => {
    /**
     * The same three breaks, against a target-hit that scores WITH them
     * rather than a rounding-error crowding card. Nothing about the rule
     * changed — the input did, which is the point: the override is not a
     * property of framework breaks, it is a property of the gap.
     *
     * `target_hit` and not another `crowding`: crowding is tier 2 against
     * scenario_gap's tier 0, and a type two tiers down cannot reach a score
     * within 0.15 of a maximal break however severe it is. Something has to
     * be genuinely comparable to be a competitor, which is the whole idea.
     */
    const close = pool.map(c => c.id === 'cr1'
      ? cand({ id: 'th1', family: 'target_hit', symbol: 'JNJ', type: 'target_hit',
          category: 'decisions', severity: 'critical', weightPct: 12, deviationPct: 25 })
      : c)
    expect(families(compose(close)).slice(0, 3)).toContain('target_hit')
  })
})

describe('CASE C · findings on one name are separated', () => {
  /**
   * Four different questions about AAPL, each valid. Four consecutive AAPL
   * cards is not a briefing, and none of them may be dropped to avoid it.
   */
  const pool = [
    cand({ id: 'a1', family: 'portfolio:framework_break', symbol: 'AAPL', type: 'scenario_gap', weightPct: 8 }),
    cand({ id: 'a2', family: 'crowding', symbol: 'AAPL', type: 'crowding', weightPct: 8 }),
    cand({ id: 'a3', family: 'research:no_case', symbol: 'AAPL', type: 'no_research', weightPct: 8 }),
    cand({ id: 'a4', family: 'no_target', symbol: 'AAPL', type: 'no_target', weightPct: 8 }),
    cand({ id: 'b1', family: 'crowding', symbol: 'MSFT', type: 'crowding', weightPct: 8 }),
    cand({ id: 'b2', family: 'no_target', symbol: 'MSFT', type: 'no_target', weightPct: 8 }),
    cand({ id: 'c1', family: 'research:no_case', symbol: 'NVDA', type: 'no_research', weightPct: 8 }),
    cand({ id: 'c2', family: 'portfolio:framework_break', symbol: 'NVDA', type: 'scenario_gap', weightPct: 8 }),
  ]

  it('never puts one ticker on three consecutive screens', () => {
    expect(longestRun(compose(pool).order.map(r => r.item), c => c.symbol))
      .toBeLessThanOrEqual(2)
  })

  it('keeps every AAPL finding — they move, they do not vanish', () => {
    const out = ids(compose(pool))
    for (const id of ['a1', 'a2', 'a3', 'a4']) expect(out).toContain(id)
  })
})

describe('CASE D · an explicit category filter', () => {
  const portfolio = buildPool().filter(c => c.category === 'portfolio')

  it('still varies the question inside the category', () => {
    /**
     * The old rule turned diversity entirely OFF here — `enabled: nothing is
     * filtered` — which is the reported "No Thesis, No Thesis, No Thesis,
     * Crowding, Crowding". It now runs, with the same guarantee as the mixed
     * feed: a family runs past two only where nothing was close enough.
     */
    const out = compose(portfolio, 'category')
    let run = 0
    let prev: string | null = null
    for (const row of out.trace) {
      run = row.family === prev ? run + 1 : 1
      prev = row.family
      if (run > 2) {
        expect(['no-competitor', 'subject-run', 'recent-subject']).toContain(row.reason)
      }
    }
    // And the opening genuinely mixes: more than one question in the first six.
    expect(new Set(out.order.slice(0, 6).map(r => r.item.family)).size)
      .toBeGreaterThan(1)
  })

  it('inserts nothing from outside the category', () => {
    // Trivially true because the pool is pre-filtered — asserted anyway,
    // because "diversity inserted a News card into Portfolio" is exactly the
    // failure a cross-category rule would produce.
    expect(new Set(compose(portfolio, 'category').order.map(r => r.item.category)))
      .toEqual(new Set(['portfolio']))
  })
})

describe('CASE E · an explicit signal-type filter', () => {
  const noThesis = buildPool().filter(c => c.family === 'research:no_case')

  it('does not alternate families, because there is only one', () => {
    const out = compose(noThesis, 'type')
    // Every card is the same family and the pass leaves that alone.
    expect(new Set(families(out)).size).toBe(1)
  })

  it('is exactly the ranked order when one asset carries one card', () => {
    /**
     * The strong claim about `scope: 'type'`: with the family rule off and no
     * duplicate tickers, nothing can move anything, so the reader gets pure
     * priority order — capital, magnitude and recency — which is what they
     * asked for.
     */
    const unique = noThesis.filter((c, i, all) =>
      all.findIndex(x => x.symbol === c.symbol) === i)
    const ranked = rankFeed(unique, toInput, NOW).map(r => r.input.id)
    expect(ids(compose(unique, 'type'))).toEqual(ranked)
  })

  it('still separates two cards about one name inside the type', () => {
    // Same type, same asset, three books. The reader asked for the type, not
    // for three consecutive screens about one holding.
    const dupes = [
      cand({ id: 'x1', family: 'research:no_case', symbol: 'AAPL', weightPct: 9 }),
      cand({ id: 'x2', family: 'research:no_case', symbol: 'AAPL', weightPct: 8 }),
      cand({ id: 'x3', family: 'research:no_case', symbol: 'AAPL', weightPct: 7 }),
      cand({ id: 'y1', family: 'research:no_case', symbol: 'MSFT', weightPct: 9 }),
      cand({ id: 'y2', family: 'research:no_case', symbol: 'MSFT', weightPct: 8 }),
    ]
    expect(longestRun(compose(dupes, 'type').order.map(r => r.item), c => c.symbol))
      .toBeLessThanOrEqual(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §13 — order changes, truth does not
// ─────────────────────────────────────────────────────────────────────────────

describe('the pass changes order and nothing else', () => {
  const pool = buildPool()

  for (const scope of ['mixed', 'category', 'type'] as ComposeScope[]) {
    it(`keeps every candidate under scope=${scope}`, () => {
      const ranked = rankFeed(pool, toInput, NOW)
      const out = compose(pool, scope)
      expect(out.order).toHaveLength(ranked.length)
      expect(new Set(out.order.map(r => r.input.id)))
        .toEqual(new Set(ranked.map(r => r.input.id)))
    })
  }

  it('emits no card twice', () => {
    const out = ids(compose(pool))
    expect(new Set(out).size).toBe(out.length)
  })

  it('is deterministic — same input, same order, every time', () => {
    // The property the seeded interleaver did not have. A PM opening the feed
    // twice must meet the same most-important thing both times.
    expect(ids(compose(pool))).toEqual(ids(compose(pool)))
    expect(ids(compose([...pool]))).toEqual(ids(compose(pool)))
  })

  it('does not reach past two tiers for a substitute', () => {
    // The guarantee that survives everything: a news story cannot interrupt a
    // decision, however monotonous the decisions get.
    const out = compose(pool)
    for (let i = 1; i < out.trace.length; i++) {
      const prev = out.order[i - 1].priority.tier
      const here = out.order[i].priority.tier
      if (here < prev) expect(prev - here).toBeLessThanOrEqual(2)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §20 — the tie-break invariant
// ─────────────────────────────────────────────────────────────────────────────

describe('equal scores do not fall back to producer order', () => {
  /**
   * ── Why this needs an invariant of its own ────────────────────────────────
   *
   * The candidate list is built by concatenating producers — attention, then
   * ideas, then signals, then insights, then news, then templates, then
   * lenses, then scenarios. `Array.prototype.sort` is stable, so any group of
   * candidates with an identical score comes out in producer order, which is
   * "all the lenses, then all the scenarios" — a grouped feed produced by the
   * sort rather than by the ranking.
   *
   * `compareRanked` already breaks those ties on `occurredAt` and then on id,
   * so the ranking itself is a total order. This asserts that the composed
   * feed does not reintroduce the grouping, which it could if the pass ever
   * became order-preserving among equals.
   */
  const tied = [
    ...Array.from({ length: 4 }, (_, i) => cand({
      id: `lensA-${i}`, family: 'crowding', symbol: `AA${i}`, weightPct: 6,
    })),
    ...Array.from({ length: 4 }, (_, i) => cand({
      id: `lensB-${i}`, family: 'no_target', symbol: `BB${i}`, weightPct: 6,
    })),
  ]

  it('does not emit one producer block then the other', () => {
    const out = families(compose(tied))
    expect(longestRun(out, f => f)).toBeLessThanOrEqual(2)
  })

  it('is unchanged by the order the producers happened to append in', () => {
    // Reversing the concatenation must not change the composed sequence, or
    // the feed's order is a fact about hook resolution rather than about the
    // book.
    expect(ids(compose(tied))).toEqual(ids(compose([...tied].reverse())))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §17 — cycles
// ─────────────────────────────────────────────────────────────────────────────

describe('a second round does not regroup', () => {
  /**
   * `cycle` re-presents the derived insights further down the feed, appending
   * a whole round of them. Composed as one list — which is what the dashboard
   * now does — the run state carries across the boundary, so round two cannot
   * open with the block round one ended on.
   */
  const round = (n: number) => buildPool()
    .filter(c => c.kind === 'insight')
    .map(c => ({ ...c, id: `${c.id}-r${n}` }))
  const twoRounds = [...round(0), ...round(1),
    ...buildPool().filter(c => c.kind !== 'insight')]

  it('holds the family rule across the round boundary', () => {
    const out = compose(twoRounds)
    // Same claim as the single-round feed, asserted on the doubled pool: a run
    // past two only where nothing was close enough to substitute.
    let run = 0
    let prev: string | null = null
    for (const row of out.trace) {
      run = row.family === prev ? run + 1 : 1
      prev = row.family
      if (run > 2) {
        expect(['no-competitor', 'subject-run', 'recent-subject']).toContain(row.reason)
      }
    }
  })

  it('keeps both rounds whole', () => {
    expect(compose(twoRounds).order).toHaveLength(twoRounds.length)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §18 — cost
// ─────────────────────────────────────────────────────────────────────────────

describe('the pass is cheap and bounded', () => {
  it('never scans past the lookahead window', () => {
    /**
     * The complexity claim, asserted rather than described. With a lookahead
     * of 12 the pass is O(n · 12); the naive version is O(n²), which on a
     * 1,300-candidate feed is a hundred times the work for the same answer.
     *
     * Measured by counting how often the family accessor is called — the
     * per-candidate work — and comparing it against the quadratic bound.
     */
    const pool = buildPool()
    let calls = 0
    composeFeed(rankFeed(pool, toInput, NOW), {
      familyOf: (c: Cand) => { calls += 1; return c.family },
      subjectOf: (c: Cand) => c.symbol,
      categoryOf: (c: Cand) => c.category,
    })
    // Each step costs at most (1 head + lookahead) cost evaluations, and each
    // cost evaluation reads the family once, plus one read when emitting.
    expect(calls).toBeLessThanOrEqual(pool.length * (12 + 2))
    expect(calls).toBeLessThan(pool.length * pool.length)
  })

  it('leaves a short list alone entirely', () => {
    const two = [cand({ id: 'a', family: 'crowding', symbol: 'AAPL' })]
    const ranked = rankFeed(two, toInput, NOW)
    expect(composeFeed(ranked, {
      familyOf: c => (c as Cand).family, subjectOf: c => (c as Cand).symbol,
    }).order).toBe(ranked)
  })
})
