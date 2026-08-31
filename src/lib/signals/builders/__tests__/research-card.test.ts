import { describe, expect, it } from 'vitest'

import { buildInsightCard } from '../legacy-kinds'
import { priorityFor } from '../../feed-priority'
import {
  CORE_SECTIONS, RESEARCH_FRAMING_BASE, caseCoverageFrom, researchBaseFor, researchCopy, researchIssueFor,
  researchSignalTypeFor, type ResearchFraming,
} from '../../../research/case-state'
import type { DerivedInsight } from '../../../../hooks/mobile/useDerivedInsights'

/**
 * The Research card, from framing to rendered claim.
 *
 * Composed through the real rule rather than from hand-written insights, so a
 * change to the precedence or the copy fails here too rather than leaving the
 * builder asserting against a shape the hook no longer produces.
 */

const DAY = 86_400_000
const NOW = new Date('2026-08-31T00:00:00.000Z').getTime()
const ago = (d: number) => new Date(NOW - d * DAY).toISOString()

function insightFor(over: {
  symbol: string
  sections?: { section: string; days: number }[]
  evidence?: { days: number; author?: string; title?: string }[]
  movePct?: number | null
  weightPct?: number | null
  held?: boolean
  portfolioName?: string | null
  portfolioId?: string | null
  liveIdeas?: { id: string; action: string | null }[]
  coverageOwners?: string[]
}): DerivedInsight {
  const coverage = caseCoverageFrom(
    (over.sections ?? []).map(s => ({ section: s.section, hasContent: true, updated_at: ago(s.days) })),
  )
  const evidence = (over.evidence ?? []).map((e, i) => ({
    id: `e${i}`, at: ago(e.days), kind: 'note' as const,
    authorName: e.author ?? 'Priya Raman', title: e.title ?? null, preview: 'A preview.',
  }))
  const issue = researchIssueFor({
    coverage, evidence, movePct: over.movePct ?? null, now: NOW,
  })!
  const copy = researchCopy({
    symbol: over.symbol, issue,
    portfolioName: over.portfolioName ?? null,
    weightPct: over.weightPct ?? null,
    held: over.held ?? false,
  })
  return {
    id: `research-${issue.framing}-a1`,
    kind: researchSignalTypeFor(issue.framing) === 'no_research' ? 'no_thesis' : 'stale_research',
    headline: copy.headline,
    body: copy.body,
    prompt: copy.prompt,
    assetId: '9f1c2b7e-0000-4000-8000-000000000001',
    symbol: over.symbol,
    companyName: over.symbol,
    portfolioName: over.portfolioName ?? null,
    portfolioId: over.portfolioId ?? null,
    weightPct: over.weightPct ?? null,
    held: over.held ?? false,
    portfolioCount: over.held ? 1 : 0,
    liveIdeas: over.liveIdeas ?? [],
    coverageOwners: over.coverageOwners ?? [],
    evidenceCount: evidence.length,
    issue,
    reviewAnchor: coverage.reviewAnchor,
    daysSinceReview: issue.daysSinceReview,
    score: RESEARCH_FRAMING_BASE[issue.framing],
  }
}

const built = (i: DerivedInsight) => {
  const r = buildInsightCard(i)
  if (!r.ok) throw new Error(`expected a card, got: ${r.reason}`)
  return r.card
}

const complete = (days: number) => CORE_SECTIONS.map(s => ({ section: s, days }))

// The six production shapes the brief names.
const AMZN = insightFor({ symbol: 'AMZN', sections: complete(283), evidence: [{ days: 260, title: 'PSKY x WBD' }, { days: 250 }], movePct: 20.7, held: true, weightPct: 3.0, portfolioName: 'Vision Fund 10K', portfolioId: 'p1' })
const AAPL = insightFor({ symbol: 'AAPL', sections: complete(149), movePct: 24.9, held: true, weightPct: 5.0, portfolioName: 'Vision Fund 10K', portfolioId: 'p1', liveIdeas: [{ id: 'i1', action: 'buy' }] })
const COIN = insightFor({ symbol: 'COIN', sections: [{ section: 'thesis', days: 225 }], evidence: [{ days: 200 }, { days: 190 }], movePct: null })
const NKE = insightFor({ symbol: 'NKE', sections: [{ section: 'thesis', days: 177 }], movePct: -30.5 })
const TSLA = insightFor({ symbol: 'TSLA', sections: complete(163), movePct: -5.2, held: true, weightPct: 1.8, portfolioName: 'Vision Fund 10K', portfolioId: 'p1' })
const MSFT = insightFor({ symbol: 'MSFT', sections: [], held: true, weightPct: 5.1, portfolioName: 'Vision Fund 10K', portfolioId: 'p1', liveIdeas: [{ id: 'i2', action: 'buy' }], coverageOwners: ['Priya Raman'] })
const ORCL = insightFor({ symbol: 'ORCL', sections: [], held: false, coverageOwners: ['Priya Raman'] })

describe('framing, on the real production shapes', () => {
  it('classifies each of the representative names as the brief expects', () => {
    expect(AMZN.issue.framing).toBe('new_evidence')
    expect(AAPL.issue.framing).toBe('price_move')
    expect(COIN.issue.framing).toBe('new_evidence')
    expect(NKE.issue.framing).toBe('price_move')
    expect(TSLA.issue.framing).toBe('long_silence')
    expect(MSFT.issue.framing).toBe('no_case')
    expect(ORCL.issue.framing).toBe('no_case')
  })

  it('produces one card per case, never two', () => {
    // AMZN has evidence AND a 20.7% move; NKE has a thin case AND a 30.5% move.
    // Each yields exactly one insight and therefore exactly one card.
    for (const i of [AMZN, NKE]) expect(buildInsightCard(i).ok).toBe(true)
    expect(AMZN.id).toBe(built(AMZN).id.replace(/^insight:/, ''))
  })
})

describe('severity and colour', () => {
  it('is never critical, however old or however large', () => {
    /**
     * A case nobody has revisited is work that is owed, not capital that is
     * breaking. `critical` drives the rose accent reserved for a position that
     * has left its framework, and the moment "old" renders the same as "broken"
     * the reader loses the distinction the accent exists to carry.
     */
    const huge = insightFor({ symbol: 'WMT', sections: [{ section: 'thesis', days: 900 }], held: true, weightPct: 22, portfolioName: 'Core' })
    for (const i of [AMZN, AAPL, COIN, NKE, TSLA, MSFT, ORCL, huge]) {
      expect(built(i).severity).toBe('attention')
    }
  })

  it('grades neither direction of a price move', () => {
    // NKE −30.5% and PLTR +37.7% are the same finding: the case has not
    // accounted for the move.
    const up = built(AAPL).metric
    const down = built(NKE).metric
    expect(up?.direction).toBe('neutral')
    expect(down?.direction).toBe('neutral')
    expect(up?.label).toBe(down?.label)
    // The sign is carried in the value and nowhere else.
    expect(up?.value).toBe('+24.9%')
    expect(down?.value).toBe('−30.5%')
  })

  it('never grades an evidence count either', () => {
    // Nothing records whether evidence helps or hurts, so a count cannot be
    // good or bad news.
    expect(built(AMZN).metric?.direction).toBe('neutral')
  })
})

describe('the metric each framing leads with', () => {
  it('leads a new-evidence card with the count', () => {
    expect(built(AMZN).metric).toMatchObject({ value: '2', label: 'New items since' })
    expect(built(COIN).metric?.label).toBe('New items since')
  })

  it('leads an incomplete card with sections written, never a percentage', () => {
    const thin = insightFor({ symbol: 'LLY', sections: [{ section: 'thesis', days: 261 }], movePct: 14.3 })
    expect(thin.issue.framing).toBe('incomplete_case')
    expect(built(thin).metric).toMatchObject({ value: '1/3', label: 'Core sections written' })
    // Presence is not quality: 1/3 must never be rendered as 33%.
    expect(built(thin).metric?.value).not.toMatch(/%/)
  })

  it('gives a no-case card no metric at all', () => {
    // "0/3" at the loudest size on the card is a score, and the reader would
    // read it as one. The absence is already the headline.
    expect(built(MSFT).metric).toBeNull()
    expect(built(ORCL).metric).toBeNull()
  })

  it('leads a long silence with the age of the case', () => {
    expect(built(TSLA).metric).toMatchObject({ value: '163d', label: 'Since case written' })
  })

  it('dates the card from the anchor, not from now', () => {
    expect(built(TSLA).provenance.occurredAt).toBe(TSLA.reviewAnchor)
  })
})

describe('exposure and context chips', () => {
  const labels = (i: DerivedInsight) => built(i).context.map(c => c.label)

  it('never prints 0.0% for an absent weight', () => {
    const noWeight = insightFor({ symbol: 'NVDA', sections: [], held: true, portfolioName: 'Vision Fund 10K', portfolioId: 'p1' })
    expect(labels(noWeight)).toContain('Held in Vision Fund 10K')
    expect(labels(noWeight).join(' ')).not.toMatch(/0\.0%/)
  })

  it('claims no exposure at all for a covered but unheld name', () => {
    // ORCL and the twelve like it: coverage put them in the universe, and a
    // book chip would be a claim the data does not support.
    expect(labels(ORCL).join(' ')).not.toMatch(/%|Held/)
  })

  it('names the current weight when there is one', () => {
    expect(labels(MSFT)).toContain('5.1% of Vision Fund 10K')
  })

  it('shows a single live idea quietly, and counts several', () => {
    expect(labels(AAPL)).toContain('Live idea · BUY')
    const many = insightFor({ symbol: 'X', sections: [], liveIdeas: [{ id: 'a', action: 'buy' }, { id: 'b', action: 'sell' }] })
    expect(labels(many)).toContain('2 live ideas')
    // And it is never the headline.
    expect(built(AAPL).headline).not.toMatch(/idea/i)
  })
})

describe('actions', () => {
  const primary = (i: DerivedInsight) => built(i).actions.primary

  it('names the reader\'s actual task per framing', () => {
    expect(primary(MSFT)).toMatchObject({ id: 'add_rationale', label: 'Write the case' })
    const thin = insightFor({ symbol: 'LLY', sections: [{ section: 'thesis', days: 261 }] })
    expect(primary(thin)).toMatchObject({ id: 'add_rationale', label: 'Finish the case' })
    expect(primary(AMZN)).toMatchObject({ id: 'update_thesis', label: 'Review the evidence' })
    expect(primary(AAPL)).toMatchObject({ id: 'update_thesis', label: 'Review the case' })
    expect(primary(TSLA)).toMatchObject({ id: 'update_thesis', label: 'Review the case' })
  })

  it('never offers a bare "Open" as the primary', () => {
    for (const i of [AMZN, AAPL, COIN, NKE, TSLA, MSFT, ORCL]) {
      expect(primary(i).label).not.toMatch(/^(Open|View|Review item)$/)
    }
  })
})

describe('honesty', () => {
  it('never claims a stance for the evidence', () => {
    for (const i of [AMZN, COIN]) {
      const c = built(i)
      expect(`${c.headline} ${c.body}`).not.toMatch(/supports the|challenges the|contradicts|confirms the/i)
    }
  })

  it('never says the reader looked at anything', () => {
    for (const i of [AMZN, AAPL, COIN, NKE, TSLA]) {
      const c = built(i)
      expect(`${c.headline} ${c.body} ${c.provenance.reason}`)
        .not.toMatch(/last looked|since you|last reviewed/i)
    }
  })

  it('explains itself with the ingredients that fired', () => {
    expect(built(AAPL).provenance.reason).toContain('24.9% price move')
    expect(built(AMZN).provenance.reason).toContain('2 evidence item')
    expect(built(MSFT).provenance.reason).toContain('no core section written')
  })
})

describe('ranking', () => {
  /** Exactly what `rankInputFor` builds for an insight entry. */
  const rank = (i: DerivedInsight, over: Partial<Parameters<typeof priorityFor>[0]> = {}) =>
    priorityFor({
      id: i.id,
      type: researchSignalTypeFor(i.issue.framing),
      severity: 'attention',
      occurredAt: i.reviewAnchor,
      weightPct: i.weightPct ?? null,
      held: i.held,
      base: researchBaseFor(i.issue),
      // Null, and asserted below. The move is already inside the base.
      deviationPct: null,
      ...over,
    }, NOW)

  it('keeps the family in its existing tiers and never promotes it', () => {
    // A missing case is a framework gap (1); a case that has not kept up is a
    // look (2). Neither may reach tier 0, where a position has left its
    // framework.
    expect(rank(MSFT).tier).toBe(1)
    expect(rank(ORCL).tier).toBe(1)
    for (const i of [AMZN, AAPL, COIN, NKE, TSLA]) expect(rank(i).tier).toBe(2)
  })

  it('orders the stale framings by the strength of the reason', () => {
    // All three at the same weight and heldness, so only the framing differs.
    const flat = { weightPct: 3, held: true }
    expect(rank(AMZN, flat).total).toBeGreaterThan(rank(AAPL, flat).total)
    expect(rank(AAPL, flat).total).toBeGreaterThan(rank(TSLA, flat).total)
  })

  it('holds that order however large the move gets', () => {
    /**
     * The regression this file caught. Passing the move as `deviationPct` gave
     * it a 0.18-weighted component against a 0.13 total spread between the
     * framing bases, so a 25% move on AAPL outranked two unanswered arrivals on
     * AMZN — inverting the order the family is specified to have. The magnitude
     * now lives inside the base, bounded, so it can never cross the framing.
     */
    const flat = { weightPct: 3, held: true }
    const huge = insightFor({ symbol: 'X', sections: complete(200), movePct: 140 })
    expect(rank(huge, flat).total).toBeLessThan(rank(AMZN, flat).total)
    // And a bigger move still leads a smaller one within its own framing.
    expect(rank(huge, flat).total).toBeGreaterThan(rank(AAPL, flat).total)
  })

  it('lets weight order cards, within a framing and across one', () => {
    /**
     * The severity/importance split, asserted in both directions.
     *
     * Weight orders within a framing, obviously. It is also ALLOWED to cross
     * one: a 22% case nobody has revisited in six months genuinely is more
     * worth a screen than a 0.2% watchlist name with one new note, and
     * `materialityBand` is the component that says so. What weight may never do
     * is change the tier or the severity — those are asserted above and in the
     * severity block.
     */
    const big = rank(TSLA, { weightPct: 22, held: true })
    const small = rank(TSLA, { weightPct: 0.2, held: true })
    expect(big.total).toBeGreaterThan(small.total)
    expect(big.total).toBeGreaterThan(rank(AMZN, { weightPct: 0.2, held: true }).total)
    // But it does not promote it out of its tier.
    expect(big.tier).toBe(rank(TSLA, { weightPct: 0.2, held: true }).tier)
  })

  it('does not penalise a covered but unheld name into invisibility', () => {
    // Coverage is what put ORCL in the universe. It must still be rankable.
    expect(rank(ORCL).total).toBeGreaterThan(0)
  })

  it('leaves every other signal type on the score it already had', () => {
    // `base` is optional, and absent for every pre-existing caller.
    const withoutBase = priorityFor({ id: 'x', type: 'scenario_gap', severity: 'critical', deviationPct: 20 }, NOW)
    const withNull = priorityFor({ id: 'x', type: 'scenario_gap', severity: 'critical', deviationPct: 20, base: null }, NOW)
    expect(withNull.total).toBe(withoutBase.total)
  })

  it('clamps a declared base into the component\'s range', () => {
    const over = priorityFor({ id: 'x', type: 'research_stale', severity: 'attention', base: 99 }, NOW)
    const one = priorityFor({ id: 'x', type: 'research_stale', severity: 'attention', base: 1 }, NOW)
    expect(over.total).toBe(one.total)
  })
})

describe('every framing builds a card', () => {
  it('emits rather than suppressing, for all five', () => {
    const seen = new Set<ResearchFraming>()
    for (const i of [AMZN, AAPL, NKE, TSLA, MSFT, insightFor({ symbol: 'LLY', sections: [{ section: 'thesis', days: 261 }] })]) {
      seen.add(i.issue.framing)
      expect(buildInsightCard(i).ok).toBe(true)
    }
    expect(seen).toEqual(new Set(['new_evidence', 'price_move', 'long_silence', 'no_case', 'incomplete_case']))
  })
})
