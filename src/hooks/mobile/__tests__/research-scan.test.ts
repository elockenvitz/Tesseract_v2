import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { anchorWithJudgment, caseCoverageFrom, researchIssueFor } from '../../../lib/research/case-state'
import { RESEARCH_CASE_SIGNAL_TYPES, isResearchCaseJudgment } from '../../../lib/signals/judgment-policy'
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
    expect(SOURCE).toContain('if (!isResearchCaseJudgment(r.metadata)) continue')
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

describe('a durable judgment as a review touch', () => {
  const DAY = 86_400_000
  const now = new Date('2026-08-31T00:00:00.000Z').getTime()
  const written = (days: number) => caseCoverageFrom([
    { section: 'thesis', hasContent: true, updated_at: new Date(now - days * DAY).toISOString() },
    { section: 'where_different', hasContent: true, updated_at: new Date(now - days * DAY).toISOString() },
    { section: 'risks_to_thesis', hasContent: true, updated_at: new Date(now - days * DAY).toISOString() },
  ])

  it('moves the anchor forward, so answering a card is not punished', () => {
    const c = anchorWithJudgment(written(200), now - 5 * DAY)
    // 200 days quiet would have been a long-silence card. Five days after a
    // recorded judgment, there is nothing to raise.
    expect(researchIssueFor({ coverage: written(200), evidence: [], movePct: null, now })?.framing)
      .toBe('long_silence')
    expect(researchIssueFor({ coverage: c, evidence: [], movePct: null, now })).toBeNull()
  })

  it('never drags the anchor backwards', () => {
    // A judgment older than the last save must not make a freshly written case
    // look stale.
    const fresh = written(10)
    expect(anchorWithJudgment(fresh, now - 300 * DAY)).toEqual(fresh)
  })

  it('never creates an anchor for a case that was never written', () => {
    /**
     * Tapping "Legacy position" on a name with nothing recorded does not write
     * a thesis. If a judgment could create an anchor, the answer would silence
     * the card that says the case is missing — the product accepting an answer
     * to a question it never asked.
     */
    const empty = caseCoverageFrom([])
    expect(anchorWithJudgment(empty, now - DAY).reviewAnchor).toBeNull()
    expect(researchIssueFor({ coverage: anchorWithJudgment(empty, now - DAY), evidence: [], movePct: null, now })?.framing)
      .toBe('no_case')
  })

  it('ignores an undated or malformed judgment rather than dating it now', () => {
    const c = written(200)
    expect(anchorWithJudgment(c, null)).toEqual(c)
    expect(anchorWithJudgment(c, undefined)).toEqual(c)
    expect(anchorWithJudgment(c, Number.NaN)).toEqual(c)
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
    expect(SOURCE).toContain('if (!isResearchCaseJudgment(r.metadata)) continue')
  })
})

describe('the localStorage path has the same leak, closed the same way', () => {
  const at = '2026-08-26T01:10:57.000Z'

  it('drops a judgment recorded against another card family', () => {
    /**
     * The disposition key is `{signalType}:{entityId}`, and the prefix used to
     * be discarded. So answering a target question on AAPL wrote
     * `target_expired:aapl` and advanced the CASE's anchor — the local mirror
     * of the durable leak, and it has to be closed in both stores or this one
     * simply reintroduces it.
     */
    const store = {
      'target_expired:aapl': { at },
      'scenario_gap:aapl': { at },
      'research_stale:amzn': { at },
      'no_research:msft': { at },
    }
    expect(judgmentTouches(store, RESEARCH_CASE_SIGNAL_TYPES).map(t => t.entityId).sort())
      .toEqual(['amzn', 'msft'])
  })

  it('reads every entry an older build wrote, with the store format untouched', () => {
    // Compatibility: same keys, same values, filtered on READ. Omitting the
    // filter preserves the previous behaviour exactly.
    const store = { 'target_expired:aapl': { at }, 'research_stale:amzn': { at } }
    expect(judgmentTouches(store)).toHaveLength(2)
    expect(judgmentTouches(store, RESEARCH_CASE_SIGNAL_TYPES)).toHaveLength(1)
  })

  it('still keeps a whole entity id when the prefix is not the only colon', () => {
    expect(judgmentTouches({ 'no_research:a:b:c': { at } }, RESEARCH_CASE_SIGNAL_TYPES)[0].entityId)
      .toBe('a:b:c')
  })

  it('is applied at the call site, against the same constant', () => {
    expect(SOURCE).toContain('judgmentTouches(loadDispositions(user.id) as any, RESEARCH_CASE_SIGNAL_TYPES)')
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
    // The whole point of the durable read. Narrowing must not disable it.
    const c = anchorWithJudgment(written(200), now - 5 * DAY)
    expect(researchIssueFor({ coverage: c, evidence: [], movePct: null, now })).toBeNull()
  })

  it('still creates no anchor for a case with no written core section', () => {
    const empty = caseCoverageFrom([])
    expect(anchorWithJudgment(empty, now - DAY).reviewAnchor).toBeNull()
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
    expect(SOURCE).toContain('if (prev == null || t > prev) judgmentTouch.set(assetId, t)')
  })
})
