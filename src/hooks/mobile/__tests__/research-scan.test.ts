import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  anchorVerb, caseCoverageFrom, researchCopy, researchIssueFor, researchReason, reviewClocks,
} from '../../../lib/research/case-state'
import {
  RESEARCH_CASE_SIGNAL_TYPES, completesResearchReview, isCompletedResearchReview,
  isResearchCaseJudgment, policyForJudgment,
} from '../../../lib/signals/judgment-policy'
import { judgmentTouches } from '../../../lib/signals/stale-signal'

/**
 * The candidate scan's contract with production.
 *
 * ── Why this greps the source ─────────────────────────────────────────────
 *
 * The properties that matter here are properties of the QUERIES — which
 * columns are selected, in what order the requests are issued, what is
 * narrowed before the expensive one runs. Mounting the hook to assert them
 * would need the org context, the auth hook, a stubbed PostgREST builder and a
 * fake clock, and would mostly be testing those. The same technique is used by
 * `scenario-cards-lifecycle.test.ts` for the same reason.
 *
 * These are not style checks. Each one pins a specific way this scan can hurt
 * production: a 2 MB note body pulled for every candidate, a price history
 * fetched for a hundred names before anything is ranked, an audit query with
 * no filters, a weight read from a superseded snapshot.
 */

const SOURCE = readFileSync(
  resolve(__dirname, '../useDerivedInsights.ts'),
  'utf8',
)

/**
 * One `supabase.from('x')` chain, up to whatever comes next.
 *
 * Bounded by the following `.from(` rather than by a bracket, because the
 * chains span several lines and a naive `),` lands in the middle of one.
 */
function queryFor(table: string): string {
  const start = SOURCE.indexOf(`.from('${table}')`)
  expect(start, `no query against ${table}`).toBeGreaterThan(-1)
  const next = SOURCE.indexOf(".from('", start + 8)
  return SOURCE.slice(start, next > -1 ? next : SOURCE.length)
}

describe('what the scan is allowed to transfer', () => {
  it('never selects a note body', () => {
    /**
     * Production holds one `asset_notes` row with 2,020,708 characters of
     * content. Selecting `content` here would pull it — and every other body —
     * for every candidate, before a single card had been ranked or cut.
     * `content_preview` is populated on all 22 live rows and capped at 150
     * characters, which is exactly the bounded projection this needs.
     */
    const notes = queryFor('asset_notes')
    expect(notes).toContain('content_preview')
    expect(notes).not.toMatch(/select\([^)]*\bcontent\b(?!_preview)/)
  })

  it('never selects contribution prose', () => {
    /**
     * The scan needs to know THAT a section is written, not what it says. The
     * two filters do that server-side, so a case's thesis never crosses the
     * wire to decide whether a thesis exists.
     */
    const contribs = queryFor('asset_contributions')
    expect(contribs).not.toMatch(/select\([^)]*\bcontent\b/)
    expect(contribs).toContain(".not('content', 'is', null)")
    expect(contribs).toContain(".neq('content', '')")
  })

  it('cuts the one body it has no preview column for', () => {
    // `quick_thoughts` has no `content_preview`. The body is read and cut on
    // receipt rather than trusted to be short, because nothing in the schema
    // says it is.
    expect(SOURCE).toContain('PREVIEW_CHARS')
    expect(SOURCE).toMatch(/r\.content\.slice\(0, PREVIEW_CHARS\)/)
  })
})

describe('what the scan reads', () => {
  it('seeds the universe from coverage, not only from holdings', () => {
    /**
     * The blind spot this closes. Starting from `portfolio_holdings_positions`
     * meant thirteen covered-but-unheld names with nothing written produced no
     * card at all — the largest real research gap in the product, invisible
     * because the query began in the wrong place.
     */
    expect(SOURCE).toContain(".from('coverage')")
    const universeSeed = SOURCE.indexOf('universe.add(r.asset_id)')
    expect(universeSeed).toBeGreaterThan(-1)
    // And holdings adds to it rather than bounding it.
    expect(SOURCE).toContain('for (const assetId of exposure.keys()) universe.add(assetId)')
  })

  it('resolves exposure through the latest-snapshot helper', () => {
    // Never by ordering all history by weight and deduping, which returns the
    // largest weight a name ever had. See `holdings-context.ts`.
    expect(SOURCE).toContain('exposureByAsset(positions, latestSnapshotIds(snapshots, positions))')
    expect(SOURCE).not.toMatch(/order\('weight_pct'/)
  })

  it('reads durable judgments with every filter that makes it cheap', () => {
    // An unfiltered `audit_events` scan is the expensive query the brief
    // forbids. Four equality filters plus an `in` over the candidate list.
    const audit = queryFor('audit_events')
    for (const filter of [
      ".eq('org_id', currentOrgId)",
      ".eq('actor_id', user.id)",
      ".eq('action_type', 'record_judgment')",
      ".eq('entity_type', 'asset')",
      ".in('entity_id', universeIds)",
    ]) expect(audit).toContain(filter)
  })

  it('excludes feed-quality taps from counting as a review', () => {
    // Telling the product its card was bad must not silently mark the case as
    // looked at. The exclusion moved INTO `isResearchCaseJudgment`, which the
    // hook applies to every durable row — asserted here, proved there.
    expect(SOURCE).toContain('if (!isCompletedResearchReview(r.metadata)) continue')
  })

  it('scopes every research read to the organisation', () => {
    for (const table of ['coverage', 'asset_contributions', 'asset_notes', 'quick_thoughts', 'trade_queue_items']) {
      expect(queryFor(table), table).toMatch(/organization_id', currentOrgId/)
    }
  })
})

describe('when the expensive query runs', () => {
  it('fetches price only after the candidates are narrowed', () => {
    /**
     * `priceCandidates` is built from names that already have an anchor and no
     * unanswered evidence, and is capped. The price query is issued strictly
     * afterwards and only when that list is non-empty — so a hundred covered
     * names never become a hundred symbols of history.
     */
    const narrowed = SOURCE.indexOf('const priceCandidates')
    const guarded = SOURCE.indexOf('if (priceCandidates.length) {')
    const fetched = SOURCE.indexOf(".from('price_history_cache')")
    expect(narrowed).toBeGreaterThan(-1)
    expect(guarded).toBeGreaterThan(narrowed)
    expect(fetched).toBeGreaterThan(guarded)
    expect(SOURCE).toContain('MAX_PRICE_SYMBOLS')
  })

  it('skips a baseline for a name whose evidence already explains the card', () => {
    // Unanswered evidence outranks a move, so the move need not be computed.
    expect(SOURCE).toContain('if (hasNewEvidence) continue')
  })

  it('bounds the candidate list itself', () => {
    expect(SOURCE).toContain('MAX_CANDIDATES')
    expect(SOURCE).toContain('.slice(0, MAX_CANDIDATES)')
  })

  it('issues no query inside the classification loop', () => {
    /**
     * The N+1 guard. Everything the loop reads is already in a Map built from
     * a batched request; a `supabase` call between the loop header and the end
     * of the function would be one request per candidate.
     */
    const loop = SOURCE.slice(SOURCE.indexOf('for (const assetId of universeIds) {\n        const asset'))
    expect(loop).not.toContain('supabase.')
    expect(loop).not.toContain('await ')
  })
})

describe('no schema', () => {
  it('adds no migration and no new table', () => {
    // Every field the family needs is derived. The only writes are the ones
    // `judgment-log` already made.
    expect(SOURCE).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/)
  })
})

describe('only a CASE judgment may advance the review touch', () => {
  /**
   * The cross-family leak, and its proof.
   *
   * `action_type='record_judgment'` + `entity_type='asset'` names a WRITER, not
   * a family. `applyVerdict` is the single writer for the whole mobile feed and
   * `isDurableEntity` admits any card whose entity is an asset — 22 of the
   * registered types. The one `record_judgment` row in production today is a
   * `target_expired` judgment on GOOGL, by the same user, in the same
   * organisation, with `judgment_intent: 'judgment'`: a real row that satisfied
   * the un-narrowed query exactly.
   */

  const meta = (over: Record<string, unknown> = {}) => ({
    ui_source: 'mobile_feed',
    judgment_intent: 'judgment',
    judgment_key: 'change_accounted_for',
    signal_type: 'research_stale',
    card_surface: 'research',
    ...over,
  })

  it('admits the two Research card types and nothing else', () => {
    expect(isResearchCaseJudgment(meta({ signal_type: 'research_stale' }))).toBe(true)
    expect(isResearchCaseJudgment(meta({ signal_type: 'no_research' }))).toBe(true)
    expect(RESEARCH_CASE_SIGNAL_TYPES).toEqual(['research_stale', 'no_research'])
  })

  it('rejects the exact production row that would otherwise have counted', () => {
    // GOOGL, target_expired, intent 'judgment', surface 'research'. Every
    // filter the query had before this one passes; only signal_type excludes it.
    expect(isResearchCaseJudgment({
      ui_source: 'mobile_feed', signal_type: 'target_expired', card_surface: 'research',
      judgment_intent: 'judgment', judgment_key: 'target_needs_review',
      judgment_label: 'Needs review', feed_disposition: 'flagged',
    })).toBe(false)
  })

  it('rejects every other asset-entity family that shares the writer', () => {
    for (const type of [
      'target_hit', 'target_expired', 'no_target', 'scenario_gap', 'recommendation',
      'active_risk', 'crowding', 'conviction_oversized', 'conviction_undersized',
      'thesis_conflict', 'team_focus', 'catalyst_ahead', 'trade_idea', 'pair_trade',
      'thought', 'research_note', 'thesis_update', 'unusual_move', 'earnings_ahead',
      'earnings_result', 'corporate_action', 'news',
    ]) {
      expect(isResearchCaseJudgment(meta({ signal_type: type })), type).toBe(false)
    }
  })

  it('does not trust card_surface, which reads "research" for target cards too', () => {
    /**
     * The trap. `card_surface` is the contract's `Surface` — the accent rail —
     * and `research` there covers `scenario_gap`, `target_expired` and
     * `recommendation` as well. A filter on it would look correct and admit
     * exactly the rows this exists to exclude.
     */
    expect(isResearchCaseJudgment(meta({ signal_type: 'scenario_gap', card_surface: 'research' }))).toBe(false)
    expect(isResearchCaseJudgment(meta({ signal_type: 'recommendation', card_surface: 'research' }))).toBe(false)
    // And a Research judgment is admitted whatever the surface says.
    expect(isResearchCaseJudgment(meta({ signal_type: 'no_research', card_surface: 'risk' }))).toBe(true)
  })

  it('still excludes a feed-quality tap', () => {
    // Telling the product its card was bad is a claim about the CARD.
    expect(isResearchCaseJudgment(meta({ judgment_intent: 'feed_quality' }))).toBe(false)
    // An absent intent predates the field and was a judgment.
    const noIntent = meta()
    delete (noIntent as Record<string, unknown>).judgment_intent
    expect(isResearchCaseJudgment(noIntent)).toBe(true)
  })

  it('fails closed on anything it cannot identify', () => {
    // A false positive suppresses a real card for 90 days; a false negative
    // costs one repeated card.
    for (const bad of [null, undefined, {}, 'research_stale', 42, { signal_type: null }, { signal_type: '' }]) {
      expect(isResearchCaseJudgment(bad)).toBe(false)
    }
  })

  it('narrows the query server-side as well, on signal_type not card_surface', () => {
    const audit = queryFor('audit_events')
    expect(audit).toContain(".in('metadata->>signal_type', RESEARCH_CASE_SIGNAL_TYPES")
    // The word appears in the comment explaining why it is NOT used; what must
    // not exist is a FILTER on it.
    expect(audit).not.toMatch(/\.(eq|in|filter)\([^)]*card_surface/)
    // And re-checks in the client, because the server filter is a jsonb path
    // written as a string and a typo there widens rather than fails.
    expect(SOURCE).toContain('if (!isCompletedResearchReview(r.metadata)) continue')
  })
})

describe('what the narrowing must not break', () => {
  const DAY = 86_400_000
  const now = new Date('2026-08-31T00:00:00.000Z').getTime()
  const written = (days: number) => caseCoverageFrom(
    ['thesis', 'where_different', 'risks_to_thesis'].map(section => ({
      section, hasContent: true, updated_at: new Date(now - days * DAY).toISOString(),
    })),
  )

  it('a genuine Research judgment still counts as a review', () => {
    // The whole point of the durable read. Two rounds of narrowing — family,
    // then outcome — must not disable the thing they exist to protect.
    const coverage = written(200)
    const clocks = reviewClocks(coverage, new Date(now - 5 * DAY).toISOString())
    expect(researchIssueFor({ clocks, coverage, evidence: [], movePct: null, now })).toBeNull()
  })

  it('still creates no anchor for a case with no written core section', () => {
    const empty = caseCoverageFrom([])
    expect(reviewClocks(empty, new Date(now - DAY).toISOString()).effectiveAnchor).toBeNull()
  })

  it('still scopes the durable read to this user and this organisation', () => {
    const audit = queryFor('audit_events')
    expect(audit).toContain(".eq('org_id', currentOrgId)")
    expect(audit).toContain(".eq('actor_id', user.id)")
  })

  it('still takes the latest valid event', () => {
    // Ordered newest-first, and `noteTouch` keeps the maximum regardless.
    const audit = queryFor('audit_events')
    expect(audit).toContain("order('occurred_at', { ascending: false })")
    expect(SOURCE).toContain('if (prev == null || t > prev) reviewTouch.set(assetId, t)')
  })
})

describe('the two clocks', () => {
  const DAY = 86_400_000
  const now = new Date('2026-08-31T00:00:00.000Z').getTime()
  const at = (days: number) => new Date(now - days * DAY).toISOString()
  const written = (days: number) => caseCoverageFrom(
    ['thesis', 'where_different', 'risks_to_thesis'].map(section => ({
      section, hasContent: true, updated_at: at(days),
    })),
  )

  it('a Research judgment never moves caseWrittenAt', () => {
    /**
     * The whole point of separating them. A judgment proves the reader looked;
     * it proves nothing was written. Before the split, tapping "Case holds"
     * produced a card reading "case last written 5 days ago" about a case last
     * edited in November — a false statement of fact at the loudest size on the
     * tile.
     */
    const c = written(200)
    expect(reviewClocks(c, at(5)).caseWrittenAt).toBe(at(200))
    expect(reviewClocks(c, null).caseWrittenAt).toBe(at(200))
  })

  it('records the review on its own clock', () => {
    const k = reviewClocks(written(200), at(5))
    expect(k.researchReviewAt).toBe(at(5))
    expect(k.effectiveAnchor).toBe(at(5))
    expect(k.anchoredOn).toBe('reviewed')
  })

  it('takes the max, so a stale judgment cannot drag the anchor backwards', () => {
    // A judgment older than the last save must not make a freshly written case
    // look stale.
    const k = reviewClocks(written(10), at(300))
    expect(k.effectiveAnchor).toBe(at(10))
    expect(k.anchoredOn).toBe('written')
    // The review still happened and is still reported.
    expect(k.researchReviewAt).toBe(at(300))
  })

  it('invents no anchor for a case that was never written', () => {
    /**
     * Tapping "Legacy position" on a name with nothing recorded does not write
     * a thesis. If a judgment could create an anchor, the answer would silence
     * the card that says the case is missing.
     */
    const k = reviewClocks(caseCoverageFrom([]), at(1))
    expect(k.caseWrittenAt).toBeNull()
    expect(k.effectiveAnchor).toBeNull()
    expect(k.anchoredOn).toBeNull()
    // Still reported, because it happened.
    expect(k.researchReviewAt).toBe(at(1))
    expect(researchIssueFor({
      clocks: k, coverage: caseCoverageFrom([]), evidence: [], movePct: null, now,
    })?.framing).toBe('no_case')
  })

  it('ignores an undated or malformed review rather than dating it now', () => {
    for (const bad of [null, undefined, 'not a date']) {
      const k = reviewClocks(written(200), bad)
      expect(k.researchReviewAt).toBeNull()
      expect(k.effectiveAnchor).toBe(at(200))
      expect(k.anchoredOn).toBe('written')
    }
  })

  it('measures the conditions from the effective anchor', () => {
    // §8: a genuine review with no change means the case was reconsidered, so
    // the stale clock restarts from it.
    const stale = researchIssueFor({
      clocks: reviewClocks(written(200), null), coverage: written(200),
      evidence: [], movePct: null, now,
    })
    expect(stale?.framing).toBe('long_silence')

    const reviewed = researchIssueFor({
      clocks: reviewClocks(written(200), at(5)), coverage: written(200),
      evidence: [], movePct: null, now,
    })
    expect(reviewed).toBeNull()
  })

  it('keeps both counts available, so nothing has to be recomputed to be honest', () => {
    const r = researchIssueFor({
      clocks: reviewClocks(written(300), at(95)), coverage: written(300),
      evidence: [], movePct: null, now,
    })!
    expect(r.framing).toBe('long_silence')
    expect(r.daysSinceReview).toBe(95)     // from the review
    expect(r.daysSinceWritten).toBe(300)   // from the edit
    expect(r.anchoredOn).toBe('reviewed')
  })
})

describe('evidence against the effective anchor', () => {
  const DAY = 86_400_000
  const now = new Date('2026-08-31T00:00:00.000Z').getTime()
  const at = (days: number) => new Date(now - days * DAY).toISOString()
  const written = (days: number) => caseCoverageFrom(
    ['thesis', 'where_different', 'risks_to_thesis'].map(section => ({
      section, hasContent: true, updated_at: at(days),
    })),
  )
  const ev = (days: number) => ({ id: `e${days}`, at: at(days), kind: 'note' as const })

  it('evidence after the effective anchor is new', () => {
    const r = researchIssueFor({
      clocks: reviewClocks(written(300), at(100)), coverage: written(300),
      evidence: [ev(50)], movePct: null, now,
    })
    expect(r?.framing).toBe('new_evidence')
    expect(r?.evidence).toHaveLength(1)
  })

  it('evidence answered by a completed review is not resurfaced afterwards', () => {
    /**
     * The reader read the note, concluded the case holds, and said so. Raising
     * the same note at them tomorrow would make answering worthless — and it is
     * exactly what a single write-only anchor did, because the judgment moved
     * nothing.
     */
    const r = researchIssueFor({
      clocks: reviewClocks(written(300), at(20)), coverage: written(300),
      evidence: [ev(100), ev(50)], movePct: null, now,
    })
    expect(r).toBeNull()
  })

  it('a pending judgment leaves the evidence unanswered', () => {
    // "Need to review properly" never reaches the review clock, so the
    // effective anchor is still the write date and the arrivals still count.
    const r = researchIssueFor({
      clocks: reviewClocks(written(300), null), coverage: written(300),
      evidence: [ev(100), ev(50)], movePct: null, now,
    })
    expect(r?.framing).toBe('new_evidence')
    expect(r?.evidence).toHaveLength(2)
  })
})

describe('which judgments actually mean "reviewed"', () => {
  /**
   * Family scope is not enough. `isResearchCaseJudgment` answers "was this
   * about the case"; it does not answer "did the reader finish looking". The
   * classification is read off the categories `judgment-policy` already
   * declares rather than restated, so an option added to a Research card gets
   * the right treatment from the category its author must declare.
   */

  const meta = (key: string, over: Record<string, unknown> = {}) => ({
    ui_source: 'mobile_feed', judgment_intent: 'judgment',
    signal_type: 'research_stale', card_surface: 'research',
    judgment_key: key, ...over,
  })

  it('admits "Case holds" and "Already accounted for" — the reviewed-unchanged case', () => {
    // Both labels write `change_accounted_for`, category `confirmed`: "the
    // reader reviewed the issue and says the recorded view stands". This is the
    // one event the product could never record, and the reason the durable read
    // exists at all.
    expect(policyForJudgment('change_accounted_for').category).toBe('confirmed')
    expect(isCompletedResearchReview(meta('change_accounted_for'))).toBe(true)
    expect(completesResearchReview('research_stale', 'change_accounted_for')).toBe(true)
  })

  it('admits "Active thesis" on a no_research card, for the same reason', () => {
    expect(policyForJudgment('active_thesis').category).toBe('confirmed')
    expect(isCompletedResearchReview(meta('active_thesis', { signal_type: 'no_research' }))).toBe(true)
  })

  it('REJECTS "Need to review properly" — the response says the review has not happened', () => {
    /**
     * The hard rule. This answer's entire content is that the reader still
     * needs to look. Advancing the clock on it would let them silence the card
     * by saying they had not dealt with it, reset the stale timing, mark the
     * evidence answered, and suppress the tile — all on a non-answer.
     */
    expect(policyForJudgment('needs_review').category).toBe('needs_review')
    expect(isCompletedResearchReview(meta('needs_review'))).toBe(false)
    expect(completesResearchReview('no_research', 'needs_review')).toBe(false)
  })

  it('REJECTS "Case needs updating" — the work is outstanding until the case is edited', () => {
    /**
     * The closest call, and its own `nextAction` settles it: `update_thesis`.
     * Marking it reviewed would hide a card whose stated next step is "update
     * the case", and it would return after its seven quiet days stripped of its
     * reason — evidence counted as answered, the move measured from the
     * judgment. A card that comes back saying less than it did is worse than
     * one that comes back saying the same thing.
     */
    expect(policyForJudgment('view_needs_update').category).toBe('action_needed')
    expect(isCompletedResearchReview(meta('view_needs_update'))).toBe(false)
  })

  it('REJECTS the not-applicable answers, which are about coverage rather than the case', () => {
    // "The card asked the wrong question, or the wrong person." Not a judgment
    // about the investment, so it cannot be a review of one — and they already
    // buy 180 days of quiet through `acknowledgmentFor`, so nothing regresses.
    for (const key of ['legacy_position', 'owned_elsewhere', 'no_longer_covered']) {
      expect(policyForJudgment(key).category, key).toBe('not_applicable')
      expect(isCompletedResearchReview(meta(key)), key).toBe(false)
    }
  })

  it('keeps the cross-family narrowing on top of the outcome narrowing', () => {
    // Both must be true. A `confirmed` judgment from another family is still
    // rejected — including the exact production row's neighbours.
    expect(completesResearchReview('target_expired', 'change_accounted_for')).toBe(false)
    expect(completesResearchReview('scenario_gap', 'scenario_thesis_intact')).toBe(false)
    expect(isCompletedResearchReview({
      signal_type: 'target_expired', card_surface: 'research',
      judgment_intent: 'judgment', judgment_key: 'target_still_valid',
    })).toBe(false)
  })

  it('still rejects a feed-quality tap whatever its key says', () => {
    expect(isCompletedResearchReview(meta('change_accounted_for', { judgment_intent: 'feed_quality' }))).toBe(false)
  })

  it('fails closed on an unknown or absent key', () => {
    expect(policyForJudgment('a_key_nobody_declared').category).toBe('unknown')
    expect(isCompletedResearchReview(meta('a_key_nobody_declared'))).toBe(false)
    expect(completesResearchReview('research_stale', null)).toBe(false)
    expect(completesResearchReview(null, 'change_accounted_for')).toBe(false)
  })
})

describe('durable and localStorage apply the same predicate', () => {
  const at = '2026-08-26T01:10:57.000Z'
  const accept = (e: { signalType: string; key: string | null }) =>
    completesResearchReview(e.signalType, e.key)

  it('agrees key by key across both stores', () => {
    /**
     * §10. One rule, two stores. If they diverged, a card would be quiet on the
     * phone that answered it and loud on the laptop — worse than either store
     * being wrong, because the reader cannot tell which one to believe.
     */
    const cases: [string, string, boolean][] = [
      ['research_stale', 'change_accounted_for', true],
      ['no_research', 'active_thesis', true],
      ['research_stale', 'needs_review', false],
      ['research_stale', 'view_needs_update', false],
      ['no_research', 'legacy_position', false],
      ['target_expired', 'change_accounted_for', false],
      ['scenario_gap', 'scenario_thesis_intact', false],
    ]
    for (const [signalType, key, expected] of cases) {
      const durable = isCompletedResearchReview({
        signal_type: signalType, judgment_key: key, judgment_intent: 'judgment',
      })
      const local = judgmentTouches({ [`${signalType}:a1`]: { at, key } }, accept).length > 0
      expect(durable, `${signalType}/${key} durable`).toBe(expected)
      expect(local, `${signalType}/${key} local`).toBe(expected)
      expect(local).toBe(durable)
    }
  })

  it('drops a needs_review entry the old filter would have admitted', () => {
    // The previous pass narrowed on family alone, so this entry counted.
    const store = {
      'research_stale:amzn': { at, key: 'needs_review' },
      'research_stale:aapl': { at, key: 'change_accounted_for' },
    }
    expect(judgmentTouches(store, accept).map(t => t.entityId)).toEqual(['aapl'])
  })

  it('reads every entry an older build wrote, with the store format untouched', () => {
    const store = { 'target_expired:aapl': { at }, 'research_stale:amzn': { at, key: 'change_accounted_for' } }
    // Unfiltered: original behaviour, both entries.
    expect(judgmentTouches(store)).toHaveLength(2)
    // Filtered: only the completed Research review. A legacy entry with no key
    // recorded fails closed rather than being assumed to be an answer.
    expect(judgmentTouches(store, accept).map(t => t.entityId)).toEqual(['amzn'])
  })

  it('still keeps a whole entity id when the prefix is not the only colon', () => {
    expect(judgmentTouches({ 'no_research:a:b:c': { at, key: 'active_thesis' } }, accept)[0].entityId)
      .toBe('a:b:c')
  })
})

describe('copy and labels name the event that happened', () => {
  const DAY = 86_400_000
  const now = new Date('2026-08-31T00:00:00.000Z').getTime()
  const at = (days: number) => new Date(now - days * DAY).toISOString()
  const written = (days: number) => caseCoverageFrom(
    ['thesis', 'where_different', 'risks_to_thesis'].map(section => ({
      section, hasContent: true, updated_at: at(days),
    })),
  )
  const build = (writtenDays: number, reviewedDays: number | null, over: {
    evidence?: { id: string; at: string; kind: 'note' }[]
    movePct?: number | null
  } = {}) => {
    const coverage = written(writtenDays)
    const clocks = reviewClocks(coverage, reviewedDays == null ? null : at(reviewedDays))
    const issue = researchIssueFor({
      clocks, coverage, evidence: over.evidence ?? [], movePct: over.movePct ?? null, now,
    })!
    return { clocks, issue, copy: researchCopy({ symbol: 'AAPL', issue }) }
  }

  it('says "written" when the anchor is an edit', () => {
    const { copy } = build(200, null, { movePct: 24.9 })
    expect(copy.headline).toContain('since its case was last written')
    expect(copy.headline).not.toMatch(/reviewed/)
  })

  it('says "reviewed" when the anchor is a completed review', () => {
    // §6. Never "written", "edited" or "updated" — no contribution changed.
    const { copy } = build(300, 100, { movePct: 24.9 })
    expect(copy.headline).toContain('since its case was last reviewed')
    expect(copy.headline).not.toMatch(/written/)
    // And the body still tells the reader how old the PROSE is, because that
    // is what they will find when they open the case.
    expect(copy.body).toContain('The case itself was last written 300 days ago.')
  })

  it('says "reviewed" on a new-evidence headline too', () => {
    const evidence = [{ id: 'e1', at: at(40), kind: 'note' as const }]
    expect(build(300, 100, { evidence }).copy.headline)
      .toBe("New evidence since AAPL's case was last reviewed")
    expect(build(300, null, { evidence }).copy.headline)
      .toBe("New evidence since AAPL's case was last written")
  })

  it('never calls a judgment written, edited or updated', () => {
    const { copy } = build(300, 100)
    expect(copy.headline).toMatch(/last reviewed/)
    // The only occurrence of "written" is the explicit second clause about the
    // prose, which is a true statement about a different date.
    expect(copy.body.match(/written/g) ?? []).toHaveLength(1)
    expect(copy.body).toContain('last written 300 days ago')
  })

  it('adds no second clause when the two clocks are the same event', () => {
    const { copy } = build(200, null, { movePct: 24.9 })
    expect(copy.body).not.toMatch(/The case itself/)
  })

  it('explains itself with both dates when they differ', () => {
    const { issue } = build(300, 100)
    const reason = researchReason(issue, 'AAPL')
    expect(reason).toContain('case last written 300 days ago')
    expect(reason).toContain('reviewed unchanged 100 days ago')
  })

  it('anchorVerb is the single source of the word', () => {
    expect(anchorVerb('written')).toBe('written')
    expect(anchorVerb('reviewed')).toBe('reviewed')
    // Null anchors have no review to name, so they read as written.
    expect(anchorVerb(null)).toBe('written')
  })
})
