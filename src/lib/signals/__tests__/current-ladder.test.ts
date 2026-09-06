import { describe, it, expect, vi } from 'vitest'

import { selectCurrentLadders, type TargetRow } from '../current-ladder'
import { buildScenarioGapCard } from '../builders/scenarioGap'

/**
 * One definition of "the current scenario framework", and it must not move.
 *
 * The feed used to reconstruct this from raw `analyst_price_targets` history:
 * every row was a rung, so three generations of a Bull target were three Bull
 * rungs and the ladder's low and high could be values nobody currently holds.
 * Review Cases meanwhile showed one rung per scenario, newest first. Two
 * experiences, two answers, one table.
 */

let seq = 0
const row = (o: Partial<TargetRow> & { asset_id: string; price: number }): TargetRow => ({
  id: o.id ?? `r${String(++seq).padStart(4, '0')}`,
  scenario_id: o.scenario_id ?? null,
  user_id: o.user_id ?? 'u1',
  probability: o.probability ?? null,
  timeframe: o.timeframe ?? '12 months',
  reasoning: null,
  is_official: o.is_official ?? false,
  created_at: o.created_at ?? '2026-01-01T00:00:00Z',
  updated_at: o.updated_at ?? '2026-01-01T00:00:00Z',
  scenarios: o.scenarios ?? { name: 'Case' },
  assets: o.assets ?? { id: o.asset_id, symbol: 'AMZN', company_name: 'Amazon' },
  ...o,
})

/** AMZN with three generations of each case. Only the newest is current. */
function amznWithHistory(): TargetRow[] {
  const out: TargetRow[] = []
  const gens = [
    { at: '2026-01-01T00:00:00Z', bear: 50, base: 60, bull: 70 },
    { at: '2026-04-01T00:00:00Z', bear: 70, base: 90, bull: 120 },
    { at: '2026-08-01T00:00:00Z', bear: 90, base: 120, bull: 180 },
  ]
  for (const g of gens) {
    out.push(row({ asset_id: 'a-amzn', price: g.bear, scenario_id: 's-bear', updated_at: g.at, scenarios: { name: 'Bear' } }))
    out.push(row({ asset_id: 'a-amzn', price: g.base, scenario_id: 's-base', updated_at: g.at, scenarios: { name: 'Base' } }))
    out.push(row({ asset_id: 'a-amzn', price: g.bull, scenario_id: 's-bull', updated_at: g.at, scenarios: { name: 'Bull' } }))
  }
  return out
}

const amzn = (rows: TargetRow[]) =>
  selectCurrentLadders(rows).find(l => l.assetId === 'a-amzn')!

describe('A. historical rows — only the current framework is evaluated', () => {
  it('takes the newest rung per scenario, not every generation', () => {
    const l = amzn(amznWithHistory())
    expect(l.cases.map(c => c.price)).toEqual([90, 120, 180])
    expect(l.cases.map(c => c.name)).toEqual(['Bear', 'Base', 'Bull'])
  })

  it('reports the newest statement as the ladder date', () => {
    expect(amzn(amznWithHistory()).updatedAt).toBe('2026-08-01T00:00:00Z')
  })

  /** The old path would have produced a 9-rung ladder from 50 to 180. */
  it('never lets a superseded value set the low or the high', () => {
    const l = amzn(amznWithHistory())
    const prices = l.cases.map(c => c.price)
    expect(Math.min(...prices)).toBe(90)
    expect(Math.max(...prices)).toBe(180)
    expect(l.cases).toHaveLength(3)
  })

  it('prefers an official target over a newer personal one', () => {
    const rows = [
      row({ asset_id: 'a-amzn', price: 180, scenario_id: 's-bull', scenarios: { name: 'Bull' },
        is_official: true, updated_at: '2026-01-01T00:00:00Z' }),
      row({ asset_id: 'a-amzn', price: 999, scenario_id: 's-bull', scenarios: { name: 'Bull' },
        is_official: false, updated_at: '2026-08-01T00:00:00Z' }),
      row({ asset_id: 'a-amzn', price: 90, scenario_id: 's-bear', scenarios: { name: 'Bear' } }),
    ]
    expect(amzn(rows).cases.find(c => c.name === 'Bull')!.price).toBe(180)
  })
})

describe('C. arbitrary row ordering cannot change the answer', () => {
  it('produces the identical ladder however the rows arrive', () => {
    const base = amzn(amznWithHistory())
    for (let i = 0; i < 40; i++) {
      const shuffled = [...amznWithHistory()]
      for (let j = shuffled.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]]
      }
      const got = amzn(shuffled)
      expect(got.cases.map(c => `${c.name}:${c.price}`))
        .toEqual(base.cases.map(c => `${c.name}:${c.price}`))
    }
  })

  /** Same-timestamp rows are broken by id, so even a tie is stable. */
  it('breaks a same-second tie deterministically', () => {
    const rows = [
      row({ id: 'zzz', asset_id: 'a-amzn', price: 200, scenario_id: 's-bull', scenarios: { name: 'Bull' }, updated_at: '2026-08-01T00:00:00Z' }),
      row({ id: 'aaa', asset_id: 'a-amzn', price: 180, scenario_id: 's-bull', scenarios: { name: 'Bull' }, updated_at: '2026-08-01T00:00:00Z' }),
      row({ asset_id: 'a-amzn', price: 90, scenario_id: 's-bear', scenarios: { name: 'Bear' } }),
    ]
    const a = amzn(rows).cases.find(c => c.name === 'Bull')!.price
    const b = amzn([...rows].reverse()).cases.find(c => c.name === 'Bull')!.price
    expect(a).toBe(b)
    expect(a).toBe(200) // greatest id wins
  })
})

describe('B/D. scale and independence', () => {
  it('is unaffected by the size of the org', () => {
    const noise: TargetRow[] = []
    for (let i = 0; i < 900; i++) {
      noise.push(row({
        asset_id: `a-${i}`, price: 10 + i, scenario_id: `s-${i}`,
        assets: { id: `a-${i}`, symbol: `T${i}`, company_name: null },
      }))
    }
    const all = [...noise, ...amznWithHistory()]
    expect(amzn(all).cases.map(c => c.price)).toEqual([90, 120, 180])
    expect(selectCurrentLadders(all).length).toBeGreaterThan(900)
  })

  it('selects each asset independently', () => {
    const rows = [
      ...amznWithHistory(),
      row({ asset_id: 'a-tsla', price: 200, scenario_id: 't-bear', scenarios: { name: 'Bear' },
        assets: { id: 'a-tsla', symbol: 'TSLA', company_name: 'Tesla' } }),
      row({ asset_id: 'a-tsla', price: 400, scenario_id: 't-bull', scenarios: { name: 'Bull' },
        assets: { id: 'a-tsla', symbol: 'TSLA', company_name: 'Tesla' } }),
    ]
    const out = selectCurrentLadders(rows)
    expect(out.find(l => l.symbol === 'AMZN')!.cases).toHaveLength(3)
    expect(out.find(l => l.symbol === 'TSLA')!.cases.map(c => c.price)).toEqual([200, 400])
  })

  it('returns assets in a stable order', () => {
    const rows = [...amznWithHistory()]
    expect(selectCurrentLadders(rows).map(l => l.assetId))
      .toEqual(selectCurrentLadders([...rows].reverse()).map(l => l.assetId))
  })
})

describe('validity', () => {
  it('rejects a single case', () => {
    const l = amzn([row({ asset_id: 'a-amzn', price: 90, scenario_id: 's-bear' })])
    expect(l.valid).toBe(false)
    expect(l.reason).toContain('needs 2+')
  })

  /**
   * Two generations of ONE case at one price is not a range. The row-driven
   * path counted them as two rungs and emitted a card about a framework that
   * describes nothing.
   */
  it('rejects two rungs that sit at the same price', () => {
    const l = amzn([
      row({ asset_id: 'a-amzn', price: 90, scenario_id: 's-bear', scenarios: { name: 'Bear' } }),
      row({ asset_id: 'a-amzn', price: 90, scenario_id: 's-base', scenarios: { name: 'Base' } }),
    ])
    expect(l.valid).toBe(false)
    expect(l.reason).toContain('one price')
  })

  it('ignores rows with no price, and rows with no ticker', () => {
    const l = amzn([
      ...amznWithHistory(),
      row({ asset_id: 'a-amzn', price: 0, scenario_id: 's-null', scenarios: { name: 'Unset' } }),
    ])
    expect(l.cases).toHaveLength(3)
    expect(selectCurrentLadders([
      row({ asset_id: 'a-x', price: 5, assets: { id: 'a-x', symbol: null, company_name: null } }),
    ])).toHaveLength(0)
  })

  /** A target with no scenario cannot be a newer version of anything. */
  it('keeps targets with no scenario as separate rungs', () => {
    const l = amzn([
      row({ asset_id: 'a-amzn', price: 90, scenario_id: null }),
      row({ asset_id: 'a-amzn', price: 180, scenario_id: null }),
    ])
    expect(l.cases).toHaveLength(2)
    expect(l.valid).toBe(true)
  })
})

describe('F. a valid AMZN ladder always produces the card', () => {
  const CURRENT_QUOTE = 232.99

  it('emits scenario_gap when the quote is above every current case', () => {
    const l = amzn(amznWithHistory())
    const r = buildScenarioGapCard({
      assetId: l.assetId, symbol: l.symbol, companyName: l.companyName,
      price: CURRENT_QUOTE, priceAsOf: new Date().toISOString(),
      cases: l.cases, heldIn: [], statedAt: l.updatedAt,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.card.type).toBe('scenario_gap')
      expect(r.card.headline).toContain('above every case')
      expect(r.card.id).toBe('scenario_gap:a-amzn')
    }
  })

  /** Same inputs, same card id — across a login and a reload alike. */
  it('H. recomposes to the same candidate every time', () => {
    /**
     * The clock is pinned to the fixture, not the fixture to the clock.
     *
     * `priceAsOf` below is a literal, and `buildScenarioGapCard` reads
     * `Date.now()` against a four-day freshness limit — so this passed until
     * the real date walked past 2026-09-02 and then failed as
     * `suppressed:quote_stale`, four days after it was written. The third
     * suite to do this; see `quote-freshness.test.ts` for the rule itself.
     *
     * Determinism is what this test is about, so the literal date stays and
     * the clock moves to meet it.
     */
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T13:00:00Z'))
    try {
    const ids = [0, 1, 2].map(() => {
      const l = amzn(amznWithHistory())
      const r = buildScenarioGapCard({
        assetId: l.assetId, symbol: l.symbol, companyName: l.companyName,
        price: CURRENT_QUOTE, priceAsOf: '2026-08-29T12:00:00Z',
        cases: l.cases, heldIn: [], statedAt: l.updatedAt,
      })
      return r.ok ? `${r.card.id}|${r.card.headline}` : `suppressed:${r.reason}`
    })
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toContain('scenario_gap:a-amzn')
    } finally { vi.useRealTimers() }
  })

  /**
   * And the SUPERSEDED generation is not merely a different answer — it is a
   * broken one.
   *
   * January's ladder was Bear $50 / Bull $70. Against today's $232.99 that is
   * 3.3x the nearest rung, past `IMPLAUSIBLE_MULTIPLE`, so the builder refuses
   * it as `inconsistent_numbers`. A row-driven path that mixed generations
   * could reach exactly this state — a ladder spanning every value ever
   * recorded — and the card would vanish with a data-fault suppression rather
   * than a wrong number. Which is the failure mode we were chasing.
   */
  it('rejects the stale generation as implausible against today', () => {
    const stale = buildScenarioGapCard({
      assetId: 'a-amzn', symbol: 'AMZN', companyName: 'Amazon',
      price: CURRENT_QUOTE, priceAsOf: new Date().toISOString(),
      cases: [
        { name: 'Bear', price: 50, probability: null, timeframe: '12 months' },
        { name: 'Bull', price: 70, probability: null, timeframe: '12 months' },
      ],
      heldIn: [], statedAt: '2026-01-01T00:00:00Z',
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.reason).toBe('inconsistent_numbers')
  })
})
