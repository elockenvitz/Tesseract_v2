/**
 * The embed trap that broke Decision Memory in the authenticated app.
 *
 * ── What happened ────────────────────────────────────────────────────────
 *
 * Increment 2B added two PostgREST embeds:
 *
 *   accepted_by_user:users!accepted_trades_accepted_by_fkey(first_name,last_name)
 *   reviewer:users!decision_reviews_reviewed_by_fkey(first_name,last_name)
 *
 * Both constraint names exist, so they look right. But both foreign keys
 * point at **auth.users**, not `public.users` — and `auth` is not an exposed
 * schema, and `auth.users` has no `first_name` column at all. PostgREST
 * answers:
 *
 *   HTTP 400  Could not find a relationship between 'accepted_trades'
 *             and 'users' in the schema cache
 *
 * A rejected embed fails the WHOLE request. `fetchAcceptedTrades` throws, so
 * `fetchTimeline` throws, so the hook reports `isError` — and both the
 * Snapshot's Decision Memory and the Decisions tab showed "Decision history
 * could not be loaded", because they share this hook.
 *
 * The harness never caught it: the harness STUBS the hook, so no query was
 * ever issued. The unit tests never caught it: they assert on source text.
 * Only the authenticated application showed it.
 *
 * ── Why this test is shaped the way it is ────────────────────────────────
 *
 * It guards the CLASS, not the two instances. Any future embed through a
 * foreign key that targets `auth.users` will fail the same way, and naming
 * only these two would let the next one through.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../..')
const HOOK = fs.readFileSync(path.join(SRC, 'hooks/useAssetDecisionTimeline.ts'), 'utf8')

/**
 * The hook with comments removed.
 *
 * Needed because the fix DOCUMENTS the broken embed verbatim so the next
 * person understands the trap — and a naive search then finds the warning and
 * reports it as the defect. The first draft of this test did exactly that and
 * failed a correct file.
 */
const CODE = HOOK
  .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
  .replace(/^[ \t]*\/\/.*$/gm, '')    // whole-line comments
  .replace(/([^:])\/\/.*$/gm, '$1')   // trailing comments, sparing `://`

/**
 * Foreign keys that point at `auth.users` rather than `public.users`, verified
 * against production on 2026-10-11. An embed through any of these is
 * unresolvable by PostgREST.
 *
 * Add to this list when a new one is found; do not remove one without
 * re-checking `pg_constraint`.
 */
const AUTH_USERS_FKS = [
  'accepted_trades_accepted_by_fkey',
  'accepted_trades_executed_by_fkey',
  'accepted_trades_reverted_by_fkey',
  'decision_reviews_reviewed_by_fkey',
]

/** Foreign keys that DO point at `public.users` and are safe to embed. */
const PUBLIC_USERS_FKS = [
  'decision_requests_requested_by_fkey',
  'decision_requests_reviewed_by_fkey',
  'memory_events_actor_id_fkey',
  'price_target_outcomes_user_id_fkey',
]

describe('no PostgREST embed goes through an auth.users foreign key', () => {
  for (const fk of AUTH_USERS_FKS) {
    it(`does not embed through ${fk}`, () => {
      /*
       * The embed syntax is `alias:table!constraint(cols)`. Finding the
       * constraint name next to a `!` is what makes it an embed rather than
       * a mention in a comment.
       */
      const embedded = new RegExp(`!\\s*${fk}\\s*\\(`).test(CODE)
      expect(embedded).toBe(false)
    })
  }

  it('still embeds through the public.users FKs, which do resolve', () => {
    // Guards the over-correction: ripping out every embed would cost a round
    // trip for no reason on the four that work.
    const used = PUBLIC_USERS_FKS.filter(fk => new RegExp(`!\\s*${fk}\\s*\\(`).test(CODE))
    expect(used).toContain('decision_requests_reviewed_by_fkey')
    expect(used).toContain('price_target_outcomes_user_id_fkey')
  })
})

describe('the actor names are resolved another way', () => {
  it('selects the raw id columns the lookup needs', () => {
    // `accepted_by` and `reviewed_by` must be SELECTed, or there is no id to
    // resolve and every actor renders as unknown.
    expect(HOOK).toMatch(/accepted_by\b/)
    expect(HOOK).toMatch(/reviewed_by\b/)
  })

  it('looks the names up in public.users by id', () => {
    expect(CODE).toContain("from('users')")
    expect(CODE).toContain("select('id, first_name, last_name')")
  })

  it('degrades to unnamed actors rather than throwing', () => {
    /*
     * The name is decoration; the decision is the record. A failed name
     * lookup must not reproduce the outage it replaced.
     */
    expect(HOOK).toContain('[DecisionTimeline] accepted_trades actor lookup failed')
  })

  it('explains the trap in place, next to the code that fell into it', () => {
    // `fetchTradeEvents` already carried this warning one function below and
    // it was not heeded. Saying it where the fix lives is the point.
    expect(HOOK).toContain('auth.users')
    expect(HOOK.replace(/\s+/g, ' ')).toContain('PostgREST cannot embed through it')
  })
})

describe('a rejected embed cannot silently empty the narrative', () => {
  it('the primary reads still throw, so the error state is reachable', () => {
    /*
     * This is deliberate and must stay. If `fetchAcceptedTrades` swallowed
     * its error, the page would have shown an EMPTY history instead of an
     * error — which is the worse failure, and the one 2D fixed. The outage
     * was loud because it was supposed to be.
     */
    const block = CODE.slice(CODE.indexOf('async function fetchAcceptedTrades'))
      .slice(0, 2000)
    expect(block).toContain('if (error) throw error')
  })
})
