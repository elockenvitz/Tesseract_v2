import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * decision_reviews tenant isolation — the half that can be tested here.
 *
 * RLS cannot be exercised in jsdom: these are database predicates, and the
 * only honest test of them runs against Postgres with two real sessions.
 * That suite is `scripts/sql/decision-reviews/verify.sql` §6, which covers
 * same-tenant read, cross-tenant SELECT/INSERT/UPDATE/upsert denial, orphan
 * quarantine, and that the rightful reviewer is not blocked. It is listed in
 * the rollout plan as a gate, not as documentation.
 *
 * What CAN be pinned here is everything that would silently undo the fix
 * from the application side, plus the shape of the migration itself. These
 * are source assertions for the same reason the rest of this repo uses them:
 * the alternative is no test at all.
 */

const ROOT = resolve(__dirname, '../../../..')
const MIGRATION = resolve(
  ROOT, 'supabase/migrations/20261009120000_decision_reviews_tenant_isolation.sql',
)
const sql = existsSync(MIGRATION) ? readFileSync(MIGRATION, 'utf8') : ''
const hook = readFileSync(resolve(ROOT, 'src/hooks/useDecisionReview.ts'), 'utf8')
const guard = readFileSync(resolve(ROOT, 'scripts/unconditional-policy-guard.mjs'), 'utf8')

/** Comments must not satisfy a security assertion. */
const code = (s: string) =>
  s.split('\n').map(l => l.replace(/--.*$/, '').replace(/\/\/.*$/, '')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')

const SQL = code(sql)

describe('the migration exists and replaces the unconditional policy', () => {
  it('is present', () => {
    expect(sql, 'the remediation migration should exist').not.toBe('')
  })

  it('drops the unconditional SELECT policy', () => {
    expect(SQL).toMatch(/DROP POLICY IF EXISTS "decision_reviews_select_authenticated"/)
  })

  it('creates no policy with a `true` predicate', () => {
    // The whole defect in one line: `USING (true)` on a tenant table.
    const policies = SQL.match(/CREATE POLICY[\s\S]*?;/g) ?? []
    for (const p of policies) {
      expect(p, `policy must not be unconditional:\n${p}`).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    }
    expect(policies.length).toBeGreaterThanOrEqual(3)
  })

  it('scopes SELECT on a non-null derived owner', () => {
    expect(SQL).toMatch(/CREATE POLICY decision_reviews_select[\s\S]*?organization_id IS NOT NULL/)
    expect(SQL).toMatch(/CREATE POLICY decision_reviews_select[\s\S]*?is_member_of_org\(organization_id\)/)
  })

  it('validates writes against the decision, not a client-supplied org', () => {
    // The INSERT hole: `WITH CHECK (reviewed_by = auth.uid())` alone let a
    // user squat any decision_id and lock the rightful reviewer out.
    expect(SQL).toMatch(/CREATE POLICY decision_reviews_insert[\s\S]*?can_review_decision\(decision_id\)/)
    expect(SQL).toMatch(/CREATE POLICY decision_reviews_update[\s\S]*?can_review_decision\(decision_id\)/)
  })

  it('derives ownership in a trigger rather than accepting it', () => {
    expect(SQL).toMatch(/CREATE TRIGGER decision_reviews_owner/)
    expect(SQL).toMatch(/BEFORE INSERT OR UPDATE ON public\.decision_reviews/)
    expect(SQL).toMatch(/NEW\.organization_id := v_org/)
  })

  it('refuses a new review whose decision resolves to nothing', () => {
    // Quarantine is for historical rows. A NEW unresolvable row would be
    // invisible to everyone while holding the UNIQUE lock on a decision_id.
    expect(SQL).toMatch(/IF v_portfolio IS NULL THEN[\s\S]*?RAISE EXCEPTION/)
  })
})

describe('history is preserved, not cleaned up', () => {
  it('deletes nothing', () => {
    expect(SQL).not.toMatch(/\bDELETE\s+FROM\s+public\.decision_reviews/i)
    expect(SQL).not.toMatch(/\bTRUNCATE\b/i)
  })

  it('does not force an owner onto rows that have none', () => {
    // A NOT NULL constraint would require either deleting the six orphans or
    // inventing owners for them. Both were refused.
    expect(SQL).not.toMatch(/ALTER COLUMN organization_id SET NOT NULL/i)
  })

  it('backfills only from a resolved decision', () => {
    expect(SQL).toMatch(/SET organization_id = p\.organization_id/)
    expect(SQL).toMatch(/p\.id = public\.decision_review_portfolio\(r\.decision_id\)/)
  })

  it('ships a rollback that is not itself a migration', () => {
    // A down-migration left as .sql in supabase/migrations would be applied
    // forward by filename order.
    const down = resolve(
      ROOT,
      'supabase/migrations/20261009120001_decision_reviews_tenant_isolation_DOWN.sql.rollback',
    )
    expect(existsSync(down)).toBe(true)
    expect(down.endsWith('.sql')).toBe(false)
  })
})

describe('the client cannot re-open the hole', () => {
  it('never sends organization_id on a review write', () => {
    // Trusting a client-supplied org is what makes the squat work.
    const upsert = /const payload = \{[\s\S]*?\}\s*\n\s*const \{ data, error \}/.exec(hook)?.[0] ?? ''
    expect(upsert, 'the review payload should be locatable').toContain('decision_id')
    expect(upsert).not.toMatch(/organization_id/)
  })

  it('still writes the reviewer, which both write policies require', () => {
    expect(hook).toMatch(/reviewed_by: userId/)
  })
})

describe('the guard that should have caught this can run', () => {
  it('no longer carries decision_reviews as an accepted finding', () => {
    const list = code(guard)
    expect(list).not.toMatch(/'decision_reviews'/)
  })

  it('is wired into CI on its own, not behind the credentialed lint', () => {
    const ci = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    expect(ci).toMatch(/policy-guard:/)
    expect(ci).toMatch(/npm run guard:policies/)
  })

  it('still fails closed when it has no inventory', () => {
    // A security gate that skips on missing input is the documented defect
    // class. This asserts the existing behaviour is not softened.
    expect(guard).toMatch(/FAIL: could not read a security inventory/)
    expect(guard).toMatch(/return 2/)
  })
})
