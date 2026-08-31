import { describe, expect, it } from 'vitest'

import POPULATION from './research-population.json'
import {
  RESEARCH_PILL, caseCoverageFrom, researchBaseFor, researchIssueFor,
  researchSignalTypeFor, reviewClocks, type ResearchFraming,
} from '../case-state'
import { researchBand, researchScopedOrder } from '../research-order'
import { LEAD_TIER, priorityFor } from '../../signals/feed-priority'

/**
 * The Research-scoped feed, ordered against the real book.
 *
 * `research-population.json` is the production candidate set for the one
 * organisation that has any research, read read-only: 54 names, 9 with a
 * written case and 45 without. It is vendored rather than fetched so the
 * ordering is asserted against real proportions without a network call — the
 * proportions are the whole point, since the failure this fixes only appears
 * when 45 of one framing sit above 9 of another.
 */

type Row = {
  symbol: string; core_n: number; written_at: string | null
  held: boolean; weight: number | null; ev_after: number; move: number | null; ideas: number
}

const NOW = new Date('2026-08-31T00:00:00.000Z').getTime()

/** One candidate, built through the real rule rather than assumed. */
function candidate(row: Row) {
  const coverage = caseCoverageFrom(
    row.written_at && row.core_n > 0
      ? ['thesis', 'where_different', 'risks_to_thesis']
          .slice(0, row.core_n)
          .map(section => ({ section, hasContent: true, updated_at: row.written_at! }))
      : [],
  )
  const clocks = reviewClocks(coverage, null)
  const evidence = Array.from({ length: row.ev_after }, (_, i) => ({
    id: `${row.symbol}-e${i}`,
    // Anything after the anchor; the rule only reads the ordering.
    at: new Date(NOW - 10 * 86_400_000).toISOString(),
    kind: 'note' as const,
  }))
  const issue = researchIssueFor({ clocks, coverage, evidence, movePct: row.move, now: NOW })
  if (!issue) return null

  const type = researchSignalTypeFor(issue.framing)
  const priority = priorityFor({
    id: row.symbol,
    type,
    severity: 'attention',
    occurredAt: clocks.effectiveAnchor,
    weightPct: row.weight,
    held: row.held,
    base: researchBaseFor(issue),
    deviationPct: null,
  }, NOW)

  return {
    symbol: row.symbol,
    framing: issue.framing,
    held: row.held,
    type,
    tier: priority.tier,
    total: priority.total,
    id: row.symbol,
  }
}

const CANDIDATES = (POPULATION as Row[]).map(candidate).filter((c): c is NonNullable<typeof c> => !!c)

/** What the feed did before: tier partition first, score within it. */
const beforeOrder = [...CANDIDATES].sort((a, b) => {
  const leadA = a.tier <= LEAD_TIER ? 0 : 1
  const leadB = b.tier <= LEAD_TIER ? 0 : 1
  if (leadA !== leadB) return leadA - leadB
  if (a.tier !== b.tier) return a.tier - b.tier
  return b.total - a.total
})

const afterOrder = researchScopedOrder(CANDIDATES)

describe('the population this is ordering', () => {
  it('is dominated by names with no written case', () => {
    // The proportion that makes the tier partition unusable when scoped.
    expect(CANDIDATES.length).toBe(54)
    expect(CANDIDATES.filter(c => c.framing === 'no_case').length).toBe(45)
    expect(CANDIDATES.filter(c => c.framing === 'new_evidence').length).toBe(3)
    expect(CANDIDATES.filter(c => c.framing === 'price_move').length).toBe(2)
    expect(CANDIDATES.filter(c => c.framing === 'long_silence').length).toBe(1)
    expect(CANDIDATES.filter(c => c.framing === 'incomplete_case').length).toBe(3)
  })
})

describe('before: the tier partition buries everything that happened', () => {
  it('puts 45 no-case cards ahead of the first real event', () => {
    /**
     * The bug, measured. `no_research` is tier 1 and `research_stale` is tier
     * 2, and the mixed feed leads with every tier ≤ LEAD_TIER — so the first
     * evidence card sat behind every single case gap in the book.
     */
    const firstEvent = beforeOrder.findIndex(c => c.framing === 'new_evidence' || c.framing === 'price_move')
    expect(firstEvent).toBe(48)
    // And the first five screens are one word, repeated.
    expect(beforeOrder.slice(0, 5).every(c => c.framing === 'no_case')).toBe(true)
  })
})

describe('after: the scoped order leads with what happened', () => {
  it('opens with evidence and moves, not with case gaps', () => {
    const first = afterOrder.slice(0, 5).map(c => c.framing)
    expect(first.filter(f => f === 'new_evidence' || f === 'price_move').length).toBe(5)
  })

  it('surfaces all five framings inside the first dozen', () => {
    /**
     * §20: the reader should meet the SHAPE of their research load rather than
     * one abundant framing forty-five times. Real order, real book:
     *
     *   AMZN PLTR  new evidence      AAPL  material move
     *   COIN       new evidence      NKE   material move
     *   GOOGL META no written case   TSLA  case not revisited
     *   MSFT NVDA  no written case   LLY   incomplete case
     */
    const seen = new Set(afterOrder.slice(0, 12).map(c => c.framing))
    expect(seen).toEqual(new Set(['new_evidence', 'price_move', 'no_case', 'long_silence', 'incomplete_case']))
  })

  it('never runs one framing past two WHILE another is still waiting', () => {
    /**
     * The precise invariant, and the reason it is not simply "never three".
     *
     * Once every other framing is exhausted — which happens here at index 17,
     * with 37 no-case cards left and nothing else in the pool — a long run is
     * not a diversity failure, it is the only honest thing left to show. The
     * cap exists to stop an abundant framing MONOPOLISING the reader's first
     * screens, not to interleave a list with itself.
     */
    let run = 1
    for (let i = 1; i < afterOrder.length; i++) {
      run = afterOrder[i].framing === afterOrder[i - 1].framing ? run + 1 : 1
      if (run <= 2) continue
      const somethingElseLeft = afterOrder
        .slice(i)
        .some(c => c.framing !== afterOrder[i].framing)
      expect(somethingElseLeft, `run of ${afterOrder[i].framing} at ${i} with an alternative available`)
        .toBe(false)
    }
  })

  it('caps the run while alternatives exist — the first screens are mixed', () => {
    // The head is where monopolisation is felt, and where the cap always bites.
    let run = 1
    for (let i = 1; i < 17; i++) {
      run = afterOrder[i].framing === afterOrder[i - 1].framing ? run + 1 : 1
      expect(run, `run at ${i}`).toBeLessThanOrEqual(2)
    }
  })

  it('keeps covered-but-unheld names in the feed, behind the held ones', () => {
    // §3: presence in the universe is not priority, and it is not exclusion
    // either. All 13 are still here.
    const unheldGaps = afterOrder.filter(c => c.framing === 'no_case' && !c.held)
    expect(unheldGaps.length).toBe(13)
    const firstUnheld = afterOrder.findIndex(c => c.framing === 'no_case' && !c.held)
    const lastHeld = afterOrder.map(c => c.framing === 'no_case' && c.held).lastIndexOf(true)
    expect(firstUnheld).toBeGreaterThan(lastHeld - unheldGaps.length)
  })

  it('is deterministic — the same pool gives the same order every time', () => {
    // No seed, no sampling, no clock. `feed-priority` argues for this at
    // length and it must hold under the scoped policy too.
    expect(researchScopedOrder(CANDIDATES).map(c => c.symbol))
      .toEqual(researchScopedOrder(CANDIDATES).map(c => c.symbol))
    // And it does not depend on the order it was handed.
    expect(researchScopedOrder([...CANDIDATES].reverse()).map(c => c.symbol))
      .toEqual(afterOrder.map(c => c.symbol))
  })

  it('does not mutate the pool it was given', () => {
    const before = CANDIDATES.map(c => c.symbol)
    researchScopedOrder(CANDIDATES)
    expect(CANDIDATES.map(c => c.symbol)).toEqual(before)
  })

  it('names the real assets the brief asked about', () => {
    const at = (s: string) => afterOrder.findIndex(c => c.symbol === s)
    // The eventful ones lead.
    for (const s of ['AMZN', 'PLTR', 'COIN', 'AAPL', 'NKE']) {
      expect(at(s), s).toBeLessThan(6)
    }
    // TSLA's single long-silence card is reachable rather than buried at 48.
    expect(at('TSLA')).toBeLessThan(10)
    // MSFT is a held case gap; the unheld ones sit behind it.
    expect(at('MSFT')).toBeLessThan(at('ORCL'))
    expect(at('MSFT')).toBeLessThan(at('ABNB'))
  })
})

describe('the banding rule', () => {
  it('splits case gaps on exposure, not on which gap they are', () => {
    // Half a case on a held name is more urgent research work than no case on
    // a watchlist name; the reverse reads as busywork.
    expect(researchBand('no_case', true)).toBe(2)
    expect(researchBand('incomplete_case', true)).toBe(2)
    expect(researchBand('no_case', false)).toBe(4)
    expect(researchBand('incomplete_case', false)).toBe(4)
  })

  it('puts events above every gap, and silence between the two kinds of gap', () => {
    expect(researchBand('new_evidence', false)).toBeLessThan(researchBand('price_move', false))
    expect(researchBand('price_move', false)).toBeLessThan(researchBand('no_case', true))
    expect(researchBand('no_case', true)).toBeLessThan(researchBand('long_silence', true))
    expect(researchBand('long_silence', true)).toBeLessThan(researchBand('no_case', false))
  })
})

describe('the general mixed feed is untouched', () => {
  it('still tiers Research the way it always did', () => {
    /**
     * The scoped policy is a separate function applied only when the pool is
     * entirely Research. `feed-priority` itself is unchanged, so a mixed feed
     * still leads with tier 1 — a missing framework really does outrank a look
     * when the reader is being shown everything at once.
     */
    const noCase = CANDIDATES.find(c => c.framing === 'no_case')!
    const evidence = CANDIDATES.find(c => c.framing === 'new_evidence')!
    expect(noCase.tier).toBe(1)
    expect(evidence.tier).toBe(2)
    expect(noCase.tier).toBeLessThanOrEqual(LEAD_TIER)
  })
})

describe('the pill says which of the five it is', () => {
  it('never claims a change on a card where nothing changed', () => {
    // TSLA: −5.2% and 163 days. "Unreviewed change" asserted an event.
    expect(RESEARCH_PILL.long_silence).toBe('Case not revisited')
    expect(RESEARCH_PILL.long_silence).not.toMatch(/change/i)
  })

  it('never says "no thesis" about a case whose thesis is written', () => {
    // LLY, TGT, WMT: thesis written, other two sections blank.
    expect(RESEARCH_PILL.incomplete_case).toBe('Incomplete case')
    expect(RESEARCH_PILL.incomplete_case).not.toMatch(/no thesis/i)
  })

  it('gives every framing a distinct, truthful pill', () => {
    const pills = Object.values(RESEARCH_PILL)
    expect(new Set(pills).size).toBe(pills.length)
    for (const f of ['new_evidence', 'price_move', 'long_silence', 'no_case', 'incomplete_case'] as ResearchFraming[]) {
      expect(RESEARCH_PILL[f], f).toBeTruthy()
    }
  })
})
