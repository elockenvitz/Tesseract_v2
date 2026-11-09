import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { recommendationInputFrom } from '../decision-recommendation'
import { buildRecommendationCard } from '../builders/recommendation'
import { primaryForFeed } from '../feed-primary'
import type { DecisionRecord, DecisionStatus } from '../../desktop-decisions/model'

/**
 * A decision waiting on somebody, from the table that holds the rows.
 *
 * ── What this guards, and what it deliberately does not ───────────────────
 *
 * Not the card: `buildRecommendationCard` has its own suite. What is at risk
 * here is the MAPPING, and specifically the numbers in it. `sizing_weight`
 * holds a target weight by design and a hand-typed delta in practice, and
 * "weight inflation silently corrupts card output" is a named defect class in
 * this codebase whose standing instruction is an explicit numeric check. So
 * the cases below run the adapter into the real builder and assert on what
 * comes out, rather than on the shape of the object in between.
 *
 * The second risk is eligibility. A request that has been answered must not
 * appear in an attention feed, and "answered" has to mean the same thing here
 * as it does in the Decisions lens, or one surface will be asking for a
 * decision the other has recorded.
 */

const REQUESTED_AT = '2026-04-12T15:54:33.000Z'

function decision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: 'dr-1',
    ideaId: 'tq-1',
    portfolioId: 'p1',
    portfolioName: 'Large Cap Growth',
    assetId: 'a-aapl',
    symbol: 'AAPL',
    companyName: 'Apple Inc.',
    status: 'pending',
    action: 'buy',
    decidedBy: null,
    decidedByName: null,
    decidedAt: null,
    requestedByName: 'Eric Lockenvitz',
    requestedAt: REQUESTED_AT,
    decisionNote: null,
    contextNote: 'We need to be more concentrated in this name in this portfolio.',
    sizingWeight: 30,
    sizingShares: null,
    baselineWeight: null,
    deferredUntil: null,
    execution: null,
    batch: null,
    ...over,
  }
}

const unwrapCard = (d: DecisionRecord) => {
  const input = recommendationInputFrom(d)
  if (!input) throw new Error('adapter declined the row')
  return buildRecommendationCard(input)
}

/** The built card, for the cases that need one rather than a result. */
const unwrapOk = (d: DecisionRecord) => {
  const r = unwrapCard(d)
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

describe('only an unanswered request is work', () => {
  it('maps a pending request', () => {
    expect(recommendationInputFrom(decision())).not.toBeNull()
  })

  it('declines every status somebody has already ruled on', () => {
    /*
     * `workOf` is the predicate, shared with the Decisions lens. A resolved
     * row reaching an attention feed would be asking the reader to decide
     * something the record says is decided.
     *
     * `withdrawn` is in this list for its own reason: the requester pulled it
     * before anyone ruled, so there is nothing to answer.
     */
    const settled: DecisionStatus[] = [
      'accepted', 'accepted_with_modification', 'rejected', 'deferred', 'withdrawn',
    ]
    for (const status of settled) {
      expect(recommendationInputFrom(decision({ status }))).toBeNull()
    }
  })

  it('keeps the open statuses that are genuinely still open', () => {
    for (const status of ['pending', 'under_review', 'needs_discussion'] as DecisionStatus[]) {
      expect(recommendationInputFrom(decision({ status }))).not.toBeNull()
    }
  })

  it('declines a request whose idea no longer names an asset', () => {
    /* The card's entity is the name. Without one there is nothing to put in
       it, and nothing for the workspace to open. */
    expect(recommendationInputFrom(decision({ assetId: null }))).toBeNull()
    expect(recommendationInputFrom(decision({ symbol: null }))).toBeNull()
  })

  it('is keyed on the request, not on the idea', () => {
    /*
     * One idea reaching two books is two requests, answered separately. Keyed
     * on `ideaId` they would collide into one card whose approval means
     * nothing in particular.
     */
    const a = recommendationInputFrom(decision({ id: 'dr-a', portfolioId: 'p1' }))
    const b = recommendationInputFrom(decision({ id: 'dr-b', portfolioId: 'p2' }))
    expect(a!.id).not.toBe(b!.id)
  })
})

describe('the numbers are the submitted ones, or there are none', () => {
  it('leads with the proposal alone when no baseline was captured', () => {
    /*
     * The real shape of this organisation's pending rows: every one of the
     * fourteen has a null baseline, because the snapshot key is fragmented
     * across writers. The card must then say what was STATED and not compute
     * a delta against a number nobody recorded.
     */
    const r = unwrapCard(decision({ baselineWeight: null }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.card.metric?.value).toBe('30.0%')
    expect(r.card.metric?.label).toBe('Proposed weight')
    expect(r.card.metric?.source).toBe('stated')
  })

  it('computes the change only when both weights are real', () => {
    const r = unwrapCard(decision({ baselineWeight: 25.3 }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    /* 30 - 25.3. Asserted as a number, not a rendered string shape. */
    expect(r.card.metric?.label).toBe('25.3% → 30.0%')
    expect(r.card.metric?.asOf).toBe(REQUESTED_AT)
  })

  it('dates a decision-time weight at the decision, never at today', () => {
    /*
     * `baselineWeight` is the book AS AT submission. Stamping it with the
     * current date would claim a freshness the number does not have, which is
     * the same mistake the builder's own metric comment warns about.
     */
    const input = recommendationInputFrom(decision({ baselineWeight: 25.3 }))
    expect(input!.currentWeightAsOf).toBe(REQUESTED_AT)
    /* And no date at all when there is no weight to date. */
    expect(recommendationInputFrom(decision({ baselineWeight: null }))!.currentWeightAsOf).toBeNull()
  })

  it('refuses a hand-typed delta rather than guessing what it meant', () => {
    /*
     * ── The weight-inflation check ──────────────────────────────────────
     *
     * Production holds rows a person typed as a CHANGE rather than a target:
     * `sell` with -1 against a book holding none of the name, and `buy` with
     * -1. The tempting repair is to read the sign and convert. That would put
     * a number nobody stated at the loudest size on the card, on a surface
     * whose whole claim is provenance.
     *
     * So the adapter passes the figure through untouched and the builder
     * refuses it. Suppressed is the correct outcome, and this asserts the
     * refusal rather than the absence of a crash.
     */
    for (const sizingWeight of [-1, 101]) {
      const r = unwrapCard(decision({ sizingWeight }))
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.reason).toBe('inconsistent_numbers')
    }
  })

  it('refuses a buy that proposes a cut', () => {
    /* Both numbers known and disagreeing with the verb. Showing it would ask
       somebody to approve a contradiction. */
    const r = unwrapCard(decision({ action: 'buy', sizingWeight: 2, baselineWeight: 8 }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('inconsistent_numbers')
  })
})

describe('the rationale is the requester\'s, not the system\'s', () => {
  it('carries the context note', () => {
    const r = unwrapCard(decision())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.card.body).toContain('more concentrated in this name')
  })

  it('suppresses a request nobody explained', () => {
    /*
     * Four of this organisation's fourteen pending rows have no note at all.
     * A recommendation with no readable reason cannot be approved on its
     * merits, so the card refuses rather than rendering an empty body.
     */
    const r = unwrapCard(decision({ contextNote: null }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('content_quality')
  })

  it('never promotes the decision note into the reason', () => {
    /*
     * `decisionNote` is why it was DECIDED and is usually a provenance string
     * the system wrote about its own plumbing -- 37 of 43 in this org read
     * "Self-proposed via Trade Lab Execute". Falling back to it when the
     * requester wrote nothing would print plumbing as a rationale.
     */
    const input = recommendationInputFrom(decision({
      contextNote: null, decisionNote: 'Self-proposed via Trade Lab Execute',
    }))
    expect(input!.rationale).toBeNull()
  })
})

describe('the producer reads the table that holds the rows', () => {
  const src = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')

  it('does not go back to the status vocabulary nothing writes', () => {
    /*
     * ── Measured, and the reason this adapter exists ────────────────────
     *
     * `useRecommendationCards` filters `trade_queue_items.status` on
     * `pending` / `proposed` / `awaiting_review`. None of those three values
     * occurs in that column anywhere in production: the workflow writes
     * `idea` (99), `executed` (50), `deleted` (49), `deciding` (16),
     * `approved` (11), `discussing` (7), `simulating` (5), `archived` (2),
     * `cancelled` (1), `rejected` (1). `pending` belongs to
     * `decision_requests`, which holds 30 of them.
     *
     * This case fails if the feed is ever pointed back at that producer.
     */
    const hook = src('hooks/useDesktopAttentionFeed.ts')
    /* A CALL, not a mention: the hook's own comment names that producer in
       order to record why it is not used, and banning the word would delete
       the finding to satisfy the test. */
    expect(hook).not.toMatch(/\buseRecommendationCards\s*\(/)
    expect(hook).not.toMatch(/import[^;]*\buseRecommendationCards\b/)
    expect(hook).toContain('useDecisionScan(null, { enabled: !!include?.decisions })')
  })

  it('does not let a commitment verb name a navigation', () => {
    /*
     * The card's primary is `Approve`, and every action on the desktop feed
     * opens the work pane. A reader who presses Approve and lands on a pane
     * either believes they approved something they did not, or presses it
     * again. The label is substituted for this family only; the action id is
     * kept, so routing and analytics are unchanged.
     */
    const entry = { family: 'recommendation', card: unwrapOk(decision()) } as never
    expect(primaryForFeed(entry).label).toBe('Open the decision')
    /* The id is the card's own, so routing and analytics never see this. */
    expect(primaryForFeed(entry).id).toBe('approve')
  })

  it('leaves every other family saying exactly what its builder said', () => {
    const card = { actions: { primary: { id: 'open_cases', label: 'Review cases' } } }
    for (const family of ['post', 'stale_target', 'research', 'conviction'] as const) {
      const e = { family, card } as never
      expect(primaryForFeed(e)).toEqual({ id: 'open_cases', label: 'Review cases' })
    }
  })

  it('is read by BOTH the card footer and the Start here band', () => {
    /*
     * ── The bug this replaces, which shipped for one run ────────────────
     *
     * The substitution first lived inside `IdeasExplore` alone. Live, that
     * put a card footer reading "Open the decision" directly beneath a Start
     * here row reading "Approve · LLY" — one finding, two verbs, one screen.
     *
     * That is exactly the failure the band was built to be incapable of,
     * arriving from the other side: the band faithfully projects the card's
     * primary label, so a renderer holding a PRIVATE opinion about that label
     * is all it takes to make the two disagree. Neither surface may read the
     * raw label while the other reads a substituted one.
     */
    for (const f of [
      'components/ideas-app/IdeasExplore.tsx',
      'components/dashboard-next/StartHereBand.tsx',
    ]) {
      expect(src(f)).toContain('primaryForFeed(')
      expect(src(f)).not.toMatch(/\{\s*card\.actions\.primary\.label\s*\}/)
    }
  })
})
