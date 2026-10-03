/**
 * Who may read a frozen recommendation version.
 *
 * ── The defect this pins ─────────────────────────────────────────────────
 *
 * A frozen version is not read on its own. It is EMBEDDED in the accepted
 * trade (`accepted-trade-service.ts` selects
 * `proposal_version:proposal_version_id(...)`) and in the decision request.
 * Those two parents are gated on DIFFERENT membership tables:
 *
 *   accepted_trades    -> user_is_portfolio_member()  -> portfolio_memberships
 *   decision_requests  -> portfolio_team
 *
 * PostgREST does not error when RLS hides an embedded row; it returns the
 * parent with the embed set to null. So if this table admitted only one of
 * the two populations, a reader authorised to see the trade would get the
 * trade back with a silently missing recommendation — the single failure
 * mode a frozen record exists to prevent, and one that looks like "the
 * analyst didn't write a thesis" rather than like a bug.
 *
 * SELECT therefore admits both memberships. INSERT must NOT: submitting a
 * recommendation also writes a `decision_requests` row, whose INSERT policy
 * is `portfolio_team`-only, so widening the write here would admit nobody
 * new in practice while creating a second inconsistency.
 *
 * ── Why this is a static test ────────────────────────────────────────────
 *
 * The subject is the MIGRATION TEXT. There is no local Postgres in this
 * worktree, and a test asserting against a database it cannot reach asserts
 * nothing. Comments are stripped before every assertion so that prose ABOUT
 * the policy — including the rationale comment directly above it in the
 * migration — can neither satisfy nor break a check.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATION = resolve(
  __dirname,
  '../../../../supabase/migrations/20260930170100_recommendation_version_freeze.sql',
)

const RAW = readFileSync(MIGRATION, 'utf8')

/** Executable SQL only: `--` comments carry the rationale, not the contract. */
const codeOf = (sql: string) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')

const SQL = codeOf(RAW)

/**
 * The text of one `create policy <name> ... ;` statement, comments stripped.
 * Anchored on the statement terminator so the two policies cannot bleed into
 * each other — which would let the SELECT policy's predicate satisfy an
 * assertion aimed at INSERT.
 */
const policy = (name: string): string => {
  const start = SQL.indexOf(`create policy ${name}`)
  expect(start, `policy ${name} is not created by this migration`).toBeGreaterThan(-1)
  const end = SQL.indexOf(';', start)
  expect(end, `policy ${name} has no statement terminator`).toBeGreaterThan(start)
  return SQL.slice(start, end + 1)
}

describe('trade_proposal_versions RLS contract', () => {
  it('strips comments, so prose about the policy cannot satisfy a check', () => {
    // The migration's own rationale comment names the function. If the
    // stripper regressed, every assertion below would pass on prose alone.
    expect(RAW).toContain('-- ')
    const commentary = RAW.split('\n').filter((l) => l.trim().startsWith('--')).join('\n')
    expect(commentary).toContain('user_is_portfolio_member')
    expect(codeOf(commentary).trim()).toBe('')
  })

  describe('SELECT — both membership populations, because the version is embedded', () => {
    const select = policy('trade_proposal_versions_select')

    it('is org-scoped', () => {
      expect(select).toContain('public.portfolio_in_current_org(portfolio_id)')
    })

    it('admits the version author', () => {
      expect(select).toContain('created_by = auth.uid()')
    })

    it('admits portfolio_team, matching decision_requests', () => {
      expect(select).toMatch(/from\s+public\.portfolio_team\s+pt/)
      expect(select).toContain('pt.user_id = auth.uid()')
    })

    it('admits user_is_portfolio_member, matching accepted_trades', () => {
      expect(select).toContain('public.user_is_portfolio_member(portfolio_id)')
    })

    it('reaches the three branches by OR, not AND — any one of them suffices', () => {
      // An `and` between the branches would make the policy the INTERSECTION
      // of the two membership tables, which is strictly narrower than either
      // parent and the opposite of the intent.
      const inner = select.slice(select.indexOf('created_by = auth.uid()'))
      expect(inner).toMatch(/created_by = auth\.uid\(\)\s*or\s+public\.user_is_portfolio_member/)
      expect(inner).toMatch(/user_is_portfolio_member\(portfolio_id\)\s*or\s+exists/)
    })
  })

  describe('INSERT — portfolio_team only, matching decision_requests_insert', () => {
    const insert = policy('trade_proposal_versions_insert')

    it('does NOT admit user_is_portfolio_member', () => {
      expect(insert).not.toContain('user_is_portfolio_member')
    })

    it('requires org scope, unforgeable authorship, and portfolio_team together', () => {
      expect(insert).toContain('created_by = auth.uid()')
      expect(insert).toContain('public.portfolio_in_current_org(portfolio_id)')
      expect(insert).toMatch(/from\s+public\.portfolio_team\s+pt/)
      // All three are conjuncts: authorship alone must never be enough.
      expect(insert).toMatch(/created_by = auth\.uid\(\)\s*and\s+public\.portfolio_in_current_org/)
      expect(insert).toMatch(/portfolio_in_current_org\(portfolio_id\)\s*and\s+exists/)
    })
  })

  describe('append-only is preserved', () => {
    it('creates no UPDATE or DELETE policy for any client role', () => {
      expect(SQL).not.toMatch(/create policy[\s\S]*?for\s+update/)
      expect(SQL).not.toMatch(/create policy[\s\S]*?for\s+delete/)
    })

    it('leaves authenticated with select and insert only, and anon with nothing', () => {
      expect(SQL).toContain('revoke all on public.trade_proposal_versions from anon')
      expect(SQL).toContain('revoke all on public.trade_proposal_versions from authenticated')
      expect(SQL).toContain('grant select, insert on public.trade_proposal_versions to authenticated')
      expect(SQL).not.toMatch(/grant[^;]*update[^;]*on public\.trade_proposal_versions/)
      expect(SQL).not.toMatch(/grant[^;]*delete[^;]*on public\.trade_proposal_versions/)
    })

    it('drops both pre-existing policy names before creating replacements', () => {
      // CREATE POLICY has no IF NOT EXISTS; the drops are what make this
      // migration re-runnable.
      expect(SQL).toContain('drop policy if exists "Users can view versions of accessible proposals"')
      expect(SQL).toContain('drop policy if exists "Users can create versions for their proposals"')
      expect(SQL).toContain('drop policy if exists trade_proposal_versions_select')
      expect(SQL).toContain('drop policy if exists trade_proposal_versions_insert')
    })
  })
})
