/**
 * ACT AI could not see a review of a decision the PM PASSED on.
 *
 * ── The gap ──────────────────────────────────────────────────────────────
 *
 * `decision_reviews.decision_id` is polymorphic. It holds a
 * `trade_queue_items` id when the PM acted on an idea, a `decision_requests`
 * id when the PM passed, and a `portfolio_trade_events` id for a
 * discretionary trade -- `DecisionAccountabilityPage` derives the kind from
 * (source, category) and writes whichever one the open row used.
 *
 * `get_decisions` fetched reviews with `.in("decision_id", recIds)`, where
 * `recIds` are `trade_queue_items` ids ONLY. So the "why did we not buy it"
 * half of the record -- the half this tool's own instructions tell the model
 * never to merge with the others -- was unreachable, and the model reported
 * that no review existed.
 *
 * It looked like it worked because both `decision_reviews` rows in production
 * on 2026-11-15 name a `trade_queue_items` row. The one subject kind that was
 * covered is the one the data happened to contain.
 *
 * ── Why this test is shaped like this ───────────────────────────────────
 *
 * `supabase/functions/ai-chat/index.ts` is a Deno entrypoint: importing it
 * here fails on its top-level Deno imports, so the running tool cannot be
 * driven directly. Rather than assert on the source TEXT -- which passes for
 * a comment and fails for a reformat -- this extracts the real id-union
 * expression from the real file and EXECUTES it. A change that drops the
 * ruling ids produces the wrong set and fails here.
 *
 * What it therefore does NOT prove: that the deployed function behaves this
 * way. ai-chat is at v30 in production and this change is not deployed.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const FN = path.join(process.cwd(), 'supabase', 'functions', 'ai-chat', 'index.ts')
const src = readFileSync(FN, 'utf8')

/**
 * Pull `const reviewSubjectIds = <expr>;` out of the edge function and make
 * it callable, so the assertions below run the shipped expression rather than
 * a copy of it.
 */
function loadReviewSubjectIds(): (recIds: string[], rulingIds: string[]) => string[] {
  const m = src.match(/const\s+reviewSubjectIds\s*=\s*([\s\S]*?);\n/)
  if (!m) throw new Error('get_decisions no longer computes `reviewSubjectIds`')
  return new Function('recIds', 'rulingIds', `return ${m[1]}`) as never
}

/**
 * The third-pass fetch, from `reviewSubjectIds` to the error roll-up that
 * follows it.
 *
 * `badStage` is located FROM the start of the block, not from the start of
 * the file: `get_decisions` is not the only tool that rolls up a failed
 * stage, and searching from zero found an earlier one and returned an empty
 * slice -- which made every assertion over the block pass vacuously.
 */
function reviewFetchBlock(): string {
  const start = src.indexOf('const reviewSubjectIds')
  if (start < 0) throw new Error('get_decisions no longer computes `reviewSubjectIds`')
  const end = src.indexOf('const badStage', start)
  if (end < 0) throw new Error('no stage roll-up follows the review fetch')
  return src.slice(start, end)
}

describe('get_decisions offers every id a review can be keyed by', () => {
  const reviewSubjectIds = loadReviewSubjectIds()

  it('includes the PM ruling ids, not only the recommendation ids', () => {
    // THE case. `dr-1` is a decision the PM passed on; its review is keyed by
    // the decision_requests id and nothing else.
    const ids = reviewSubjectIds(['tqi-1', 'tqi-2'], ['dr-1'])
    expect(ids).toContain('dr-1')
  })

  it('still includes the recommendation ids', () => {
    // The kind that already worked, and the kind both production rows use.
    // A fix that swapped one blind spot for another would pass the test above
    // and fail this one.
    const ids = reviewSubjectIds(['tqi-1', 'tqi-2'], ['dr-1'])
    expect(ids).toEqual(expect.arrayContaining(['tqi-1', 'tqi-2']))
  })

  it('offers each id once', () => {
    // `.in()` with a duplicated id is harmless but the list is capped at a
    // limit, so duplicates would quietly cost coverage.
    const ids = reviewSubjectIds(['a', 'b', 'a'], ['b', 'c'])
    expect(ids).toEqual([...new Set(ids)])
    expect([...ids].sort()).toEqual(['a', 'b', 'c'])
  })

  it('is empty when the asset has no recommendations and no rulings', () => {
    // The guard that skips the query entirely; an empty `.in()` list would
    // otherwise be a request for everything the caller can read.
    expect(reviewSubjectIds([], [])).toEqual([])
  })

  it('is the list actually handed to the decision_reviews query', () => {
    /* The expression above is only worth testing if it is the one used. This
     * is structural on purpose and it is the single structural assertion
     * here: it pins the wiring, not the logic. */
    const block = reviewFetchBlock()
    expect(block).toContain('from("decision_reviews")')
    expect(block).toMatch(/\.in\("decision_id",\s*reviewSubjectIds\)/)
  })

  it('does not select subject_type, which production does not have yet', () => {
    /* PostgREST fails the WHOLE query with 42703 on an unknown column, so
     * naming `decision_reviews.subject_type` before 20261115120000 is applied
     * would take `get_decisions` out entirely. This fix must stay
     * independently deployable. */
    const select = reviewFetchBlock().match(/\.select\(([\s\S]*?)\)\n/)?.[1] ?? ''
    expect(select).not.toMatch(/["']\s*subject_type|subject_type\s*,/)
  })
})
