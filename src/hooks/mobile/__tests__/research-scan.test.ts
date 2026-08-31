import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { anchorWithJudgment, caseCoverageFrom, researchIssueFor } from '../../../lib/research/case-state'

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
    // looked at.
    expect(SOURCE).toContain("r.metadata?.judgment_intent === 'feed_quality'")
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
