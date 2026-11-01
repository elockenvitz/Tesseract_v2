import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildInsightCard, buildTargetHitCard, buildStaleTargetCard } from '../../../lib/signals/builders'
import { researchBaseFor } from '../../../lib/research/case-state'
import { orderAttention, type AttentionEntry } from '../../../hooks/useDesktopAttentionFeed'
import { assetFocusFor } from '../../../lib/desktop-ideas/selection'
import type { CardResult, SignalCard } from '../../../lib/signals/contract'
import type { DerivedInsight } from '../../../hooks/mobile/useDerivedInsights'
import type { CoreSection, ResearchFraming } from '../../../lib/research/case-state'

/**
 * The conditions Today, Research and Decisions each raise on their own screen,
 * arriving in the Dashboard's feed instead.
 *
 * ── What is actually at risk here ─────────────────────────────────────────
 *
 * Not the cards. Every one of these was already a declared signal type with a
 * builder, a tier and a producer the phone has been using all along; the
 * builders are covered by their own suites and are not retested here.
 *
 * What is at risk is ORDER. "No case on file" is the most common research
 * condition in this data, and a feed that admits the family without the tier
 * partition and the composer holding it down buries a rarer, more urgent
 * finding under eight cards that all say the same thing. That is the specific
 * regression this file exists to catch, so it is tested against
 * `orderAttention` — the function the hook calls — and not against a copy of
 * the ranking written out in a test.
 *
 * The second risk is the opt-in. The Ideas tab must not acquire these families
 * by accident, and no render can observe which flags a file passes, so that
 * half is source-pinned.
 */

const src = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

const CORE: CoreSection[] = ['thesis', 'where_different', 'risks_to_thesis']

/**
 * A research finding, shaped as its producer returns it.
 *
 * `framing` is the real axis: five of them, two signal types, one family. The
 * fixture derives the sections and the anchor FROM the framing rather than
 * taking them as arguments, so a fixture cannot describe a case that is both
 * unwritten and 240 days old.
 */
function insight(
  framing: ResearchFraming,
  symbol: string,
  weightPct: number | null = 4.8,
): DerivedInsight {
  const present: CoreSection[] =
    framing === 'no_case' ? [] : framing === 'incomplete_case' ? ['thesis'] : CORE
  const anchor = present.length ? '2026-01-01T00:00:00Z' : null

  return {
    id: `${framing}-${symbol}`,
    kind: framing === 'no_case' || framing === 'incomplete_case' ? 'no_thesis' : 'stale_research',
    headline: `${symbol} has a research finding worth stating plainly`,
    body: 'A body long enough to pass the quality gate without saying anything.',
    prompt: 'Does the case still hold?',
    assetId: `a-${symbol}`,
    symbol,
    companyName: `${symbol} Inc.`,
    portfolioName: 'Core Equity',
    portfolioId: 'p1',
    weightPct,
    held: weightPct != null,
    portfolioCount: 1,
    liveIdeas: [],
    coverageOwners: [],
    evidenceCount: 0,
    issue: {
      framing,
      daysSinceReview: anchor ? 240 : null,
      daysSinceWritten: anchor ? 240 : null,
      anchoredOn: anchor ? ('written' as const) : null,
      present,
      missing: CORE.filter(s => !present.includes(s)),
      supporting: [],
      ...(framing === 'price_move' ? { movePct: -22 } : {}),
      ...(framing === 'new_evidence'
        ? { evidence: [{ id: 'e1', at: '2026-04-01T00:00:00Z', kind: 'note' as const, title: 'Q3 teardown' }] }
        : {}),
    },
    caseWrittenAt: anchor,
    researchReviewAt: null,
    reviewAnchor: anchor,
    anchoredOn: anchor ? ('written' as const) : null,
    daysSinceReview: anchor ? 240 : null,
    daysSinceWritten: anchor ? 240 : null,
    score: 1,
  }
}

/** A research entry exactly as the feed assembles one, `rankBase` included. */
function researchEntry(
  framing: ResearchFraming, symbol: string, weightPct: number | null = 4.8,
): AttentionEntry {
  const row = insight(framing, symbol, weightPct)
  const card = unwrap(buildInsightCard(row))
  return {
    key: card.id, card, item: null, input: null,
    family: 'research', source: null,
    rankBase: researchBaseFor(row.issue),
  }
}

/** The 250-day sell: a target that lapsed half a year ago. Tier 0. */
function lapsedTargetEntry(symbol: string): AttentionEntry {
  const card = unwrap(buildStaleTargetCard({
    assetId: `a-${symbol}`, symbol, companyName: `${symbol} Inc.`,
    target: 245, price: 212, timeframe: '12 months',
    ageMonths: 18, overdueMonths: 6,
    heldIn: ['Core Equity'], heldInIds: ['p1'],
    statedAt: '2025-02-14T00:00:00Z', expiredAt: '2026-02-13T00:00:00Z',
    asOf: new Date().toISOString(),
  }))
  return { key: card.id, card, item: null, input: null, family: 'stale_target', source: null }
}

/** A target the price has reached. Tier 0, and not a research finding. */
function targetHitEntry(symbol: string): AttentionEntry {
  const card = unwrap(buildTargetHitCard({
    assetId: `a-${symbol}`, symbol, companyName: `${symbol} Inc.`,
    price: 200, target: 180, caseName: 'Base', cases: [], overshootPct: 0.11,
    conviction: null, heldIn: ['Core Equity'], heldInIds: ['p1'],
    statedAt: '2025-06-01T00:00:00Z', asOf: new Date().toISOString(),
  }))
  return { key: card.id, card, item: null, input: null, family: 'target_hit', source: null }
}

const NOW = Date.parse('2026-11-01T12:00:00Z')

describe('the four conditions reach the feed', () => {
  it('arrive as the signal types the product already declares', () => {
    /*
     * The point of the whole change: nothing new was invented. Each condition
     * becomes a type that `reader-question`, `brief-class` and the tier table
     * already have an entry for, which is why none of those files needed
     * touching. A builder quietly emitting a type outside that vocabulary
     * would rank last and compose against nothing.
     */
    expect(researchEntry('no_case', 'NVDA').card.type).toBe('no_research')
    expect(researchEntry('incomplete_case', 'NVDA').card.type).toBe('no_research')
    expect(researchEntry('long_silence', 'AMZN').card.type).toBe('research_stale')
    expect(researchEntry('new_evidence', 'AMZN').card.type).toBe('research_stale')
    expect(researchEntry('price_move', 'AMZN').card.type).toBe('research_stale')
  })

  it('open the part of the workspace the finding is about', () => {
    /*
     * `assetFocusFor` falls back to `overview` for an unmapped family, which
     * is a silent failure: the reader lands on a name rather than on the thing
     * the card was about, and nothing errors. So the new family is asserted,
     * and asserted to differ from that fallback.
     */
    expect(assetFocusFor('research')).toBe('research')
    expect(assetFocusFor('research')).not.toBe(assetFocusFor('post'))
  })
})

describe('the most common reason does not bury the rarest', () => {
  /*
   * Eight names with no case on file, which is what this data actually looks
   * like, against one lapsed target. The lapsed target is the finding a reader
   * would be angry to have missed.
   */
  const CROWD = ['NVDA', 'MSFT', 'JNJ', 'AAPL', 'CEG', 'LLY', 'XOM', 'PG']
  const pool = [
    ...CROWD.map(s => researchEntry('no_case', s)),
    lapsedTargetEntry('NKE'),
    targetHitEntry('AMZN'),
  ]

  it('leads with a position that has left its framework, not with a missing case', () => {
    /*
     * The first version of this case named NKE, and it was asserting the
     * wrong thing. Both scarce findings are tier 0, and within that tier
     * `target_hit` (0.85) is specified to sit above `target_expired` (0.80) —
     * a target the price has REACHED is a live question, a target that merely
     * lapsed is an overdue one. So AMZN leading is the tier table working,
     * not a regression, and pinning a ticker would have made this case fail
     * the next time that ordering was legitimately revisited.
     *
     * What matters, and what is asserted, is that eight cards saying "no case
     * on file" do not take the opening from a position that has left the
     * framework somebody wrote for it — however many of them there are.
     *
     * Two mechanisms hold that, and the gate was proven against both: the
     * tier partition (`no_research` is tier 1) and the framing's own base
     * (`no_case` is 0.55, and `PriorityInput.base` REPLACES the type's). The
     * first injection moved only the tier and this case still passed, because
     * the base was still deciding — so the comment that named the tier alone
     * was wrong, and is corrected here. Moving both is what fails it.
     */
    const order = orderAttention(pool, NOW)
    expect(order[0].card.type).not.toBe('no_research')
    expect(['target_hit', 'target_expired']).toContain(order[0].card.type)
  })

  it('spends every alternative it has at the top of the feed', () => {
    /*
     * ── The guarantee a composer can actually make, and the one it cannot ──
     *
     * The first version of this case asserted no three consecutive cards of
     * one type ANYWHERE in the order, and it failed — correctly. Eight of
     * these ten candidates are `no_research`. Two separators cannot break up
     * eight repeats, so a run is arithmetic and no ordering pass can remove
     * it. An assertion that demands one is asking the composer to drop cards,
     * which is filtering, not composing.
     *
     * What the composer CAN guarantee, and does, is where it spends what it
     * has: both alternatives land in the top three, so the reader's opening is
     * three different findings rather than two identical ones followed later
     * by a surprise. A composer that scattered the recommendation to position
     * seven would satisfy a run rule just as well and would be worse, because
     * the repetition would then be the part the reader sees first.
     *
     * Recorded rather than quietly rewritten: the burying risk is real, it is
     * a property of a thin corpus, and this is the half of it that ordering
     * owns. See `project_ideas_field_data_thinness`.
     */
    const order = orderAttention(pool, NOW)
    const openingTypes = order.slice(0, 3).map(e => e.card.type)
    expect(new Set(openingTypes).size).toBe(3)

    /* Both scarce findings are in that opening, not merely some variety. */
    expect(openingTypes).toContain('target_expired')
    expect(openingTypes).toContain('target_hit')
  })

  it('keeps every candidate: this is ordering, not filtering', () => {
    /* A composer that dropped the surplus would pass the run test above by
       deleting the problem, which is not what the reader asked for. */
    expect(orderAttention(pool, NOW)).toHaveLength(pool.length)
  })
})

describe('a research framing ranks on its own strength', () => {
  it('puts unanswered evidence above a case that is merely quiet', () => {
    /*
     * Both are `research_stale`, so the TIER TABLE gives them one base of
     * 0.70 and cannot tell them apart. The framing's own base does:
     * `new_evidence` 0.78, `long_silence` 0.45.
     *
     * The quiet case is deliberately given the LARGER position, so
     * materiality argues for the wrong answer. If `rankBase` ever stops
     * reaching the ranker, weight decides and this inverts — which is exactly
     * how the defect would reach a reader, as a card about nothing having
     * happened sitting above a colleague's unread teardown.
     */
    const evidence = researchEntry('new_evidence', 'AMZN', 2.0)
    const quiet = researchEntry('long_silence', 'MSFT', 12.0)
    const order = orderAttention([quiet, evidence], NOW)
    expect(order.map(e => e.card.entity?.ticker)).toEqual(['AMZN', 'MSFT'])
  })
})

describe('the families are opt-in', () => {
  it('is the Dashboard trial that asks for them, from one constant', () => {
    const next = src('components/dashboard-next/DashboardNext.tsx')
    /*
     * One constant, two call sites: the feed and the Explore resolver. Asked
     * with different sets, Explore would fail to resolve exactly the previews
     * the feed has just started carding and would open the asset cold
     * instead.
     */
    expect(next).toContain('const INCLUDE: AttentionInclude = { research: true, decisions: true }')
    expect(next.match(/include[:=]\{?\s*INCLUDE/g)).toHaveLength(2)
  })

  it('leaves the Ideas application asking for nothing', () => {
    /*
     * The whole safety claim. `IdeasApp` renders the same `IdeasExplore`, so
     * the only thing standing between the Ideas tab and these families is that
     * it passes no `include` — and the hook's own guards.
     */
    expect(src('components/ideas-app/IdeasApp.tsx')).not.toContain('include')
  })

  it('guards the producer on the flag, not on the data', () => {
    /*
     * Source-pinned because the alternative is worse than it looks. The rows
     * are in `pool.insights` whether or not anybody asked for them, so an
     * unguarded loop would put the research family straight into the Ideas
     * tab. The flag is the only thing standing there.
     */
    const hook = src('hooks/useDesktopAttentionFeed.ts')
    expect(hook).toContain('if (include?.research) {')
  })

  it('asks for the decision family too, now that it has a live producer', () => {
    /*
     * This case previously asserted the OPPOSITE, and the reason is worth
     * keeping rather than deleting. The decision family was held back in the
     * change before this one because its producer,
     * `useRecommendationCards`, filters `trade_queue_items.status` on three
     * values production never writes — so wiring it would have shipped a
     * flag, a family and a card type that silently produce nothing and read
     * as finished.
     *
     * It now has a producer that reads `decision_requests`, where the rows
     * actually are. The guard that replaces this one lives beside that
     * adapter, in `signals/__tests__/decision-recommendation`, and still
     * fails if the feed is pointed back at the dead vocabulary.
     */
    expect(src('components/dashboard-next/DashboardNext.tsx')).toContain('decisions: true')
    expect(src('hooks/useDesktopAttentionFeed.ts')).toContain('if (include?.decisions) {')
  })

  it('reuses the pool for research rather than opening a second scan', () => {
    /*
     * `useDesktopCandidates` has been fetching `useDerivedInsights` all along
     * and waits for it in its boot latch. A second call here would have been a
     * second cache entry's worth of nothing and, worse, would have arrived
     * outside that latch and reshuffled the feed under the reader.
     */
    const hook = src('hooks/useDesktopAttentionFeed.ts')
    expect(hook).toContain('pool.insights as DerivedInsight[]')
    expect(hook).not.toMatch(/\buseDerivedInsights\s*\(/)
  })
})
