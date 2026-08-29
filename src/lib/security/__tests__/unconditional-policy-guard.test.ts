/**
 * Tests for the unconditional-policy guard's classifier.
 *
 * The guard exists because `object_links` and `theme_assets` shipped with
 * `USING (true)` SELECT policies while every other check in the repo passed.
 * These tests pin the judgements that made it able to see that — especially the
 * two that are easy to "simplify" away later:
 *
 *   1. an allowlisted table is still a finding when anon can read it
 *   2. a policy naming postgres/service_role is NOT a finding
 *
 * The classifier is pure, so this needs no database and no credentials.
 *
 * Fixtures use synthetic table names (`fixture_*`) rather than real ones
 * wherever the assertion is about guard BEHAVIOUR. Two tests previously used
 * `object_links` and `theme_assets` as stand-ins for "seeded in the ratchet",
 * and broke the moment C1 remediated them and removed them — a test that fails
 * when the ratchet shrinks punishes the outcome it is supposed to protect. The
 * known-set is injected instead, so this coverage survives future cleanup.
 */
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs script, no type declarations by design
import { classify, resolvedEntries, staleAllowlistEntries } from '../../../../scripts/unconditional-policy-guard.mjs'
// @ts-expect-error — plain .mjs script, no type declarations by design
import { classifyPredicateText } from '../../../../scripts/lib/policy-predicate.mjs'

const inv = (policies: unknown[], tables: unknown[] = []) => ({
  tables, policies,
})
const table = (name: string, anon = '') => ({ name, rls: true, anon, auth: 'SELECT' })
const policy = (over: Record<string, unknown>) => ({
  table: 't', name: 'p', cmd: 'SELECT', roles: 'authenticated',
  permissive: 'PERMISSIVE', unconditional: true, ...over,
})

describe('classify', () => {
  it('flags an unconditional SELECT on a non-allowlisted table', () => {
    const f = classify(inv([policy({ table: 'fixture_tenant_rows' })], [table('fixture_tenant_rows')]))
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('SEV2_CROSS_TENANT_READ')
    expect(f[0].table).toBe('fixture_tenant_rows')
  })

  it('ignores a conditional policy', () => {
    const f = classify(inv([policy({ table: 'coverage', unconditional: false })], [table('coverage')]))
    expect(f).toEqual([])
  })

  it('allows an unconditional SELECT on genuinely global reference data', () => {
    const f = classify(inv([policy({ table: 'assets' })], [table('assets')]))
    expect(f).toEqual([])
  })

  /**
   * The judgement that catches the worst case. `theme_assets` was believed safe
   * because `themes` is scoped; being on a "global" list must not excuse being
   * readable without a login.
   */
  it('flags an allowlisted table that anon can also read', () => {
    const f = classify(inv(
      [policy({ table: 'assets', roles: 'public' })],
      [table('assets', 'SELECT,INSERT')],
    ))
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('SEV1_ANON_READ')
  })

  it('allows anon read only when the table is on BOTH allowlists', () => {
    const f = classify(inv(
      [policy({ table: 'estimate_metrics', roles: 'public' })],
      [table('estimate_metrics', 'SELECT')],
    ))
    expect(f).toEqual([])
  })

  it('does not treat TO public as anon-reachable without the anon SELECT grant', () => {
    const f = classify(inv(
      [policy({ table: 'idea_reactions', roles: 'public' })],
      [table('idea_reactions', 'INSERT')], // no SELECT grant
    ))
    expect(f[0].severity).toBe('SEV2_CROSS_TENANT_READ')
  })

  it('flags unconditional writes, and escalates anon ones', () => {
    const f = classify(inv([
      policy({ table: 'notifications', cmd: 'INSERT' }),
      policy({ table: 'theme_workflow_progress', cmd: 'ALL', roles: 'public' }),
    ], [table('notifications'), table('theme_workflow_progress', 'SELECT')]))
    const bySeverity = Object.fromEntries(f.map((x: any) => [x.table, x.severity]))
    expect(bySeverity.notifications).toBe('SEV2_UNCONDITIONAL_WRITE')
    expect(bySeverity.theme_workflow_progress).toBe('SEV1_ANON_WRITE')
  })

  /**
   * postgres and service_role hold BYPASSRLS, so a policy naming them grants
   * nothing new. Counting them trains readers to skim the report.
   */
  it('ignores policies naming roles that already bypass RLS', () => {
    const f = classify(inv([
      policy({ table: 'asset_workflow_progress', cmd: 'ALL', roles: 'postgres' }),
      policy({ table: 'x', cmd: 'ALL', roles: 'service_role' }),
    ], [table('asset_workflow_progress'), table('x')]))
    expect(f).toEqual([])
  })

  it('marks pre-existing findings as known so the ratchet can distinguish them', () => {
    // The seeded set is injected, so this asserts the known/new SPLIT rather
    // than the current contents of the real ratchet.
    const seeded = new Set(['fixture_seeded_table'])
    const f = classify(inv([
      policy({ table: 'fixture_seeded_table' }),
      policy({ table: 'a_brand_new_table' }),
    ], [table('fixture_seeded_table'), table('a_brand_new_table')]), seeded)
    expect(f.find((x: any) => x.table === 'fixture_seeded_table').known).toBe(true)
    expect(f.find((x: any) => x.table === 'a_brand_new_table').known).toBe(false)
  })

  it('treats every finding as new when nothing is seeded', () => {
    // The end state the ratchet is aiming at: an empty known-set must not make
    // findings vanish, only make them all new.
    const f = classify(inv([policy({ table: 'fixture_tenant_rows' })],
                           [table('fixture_tenant_rows')]), new Set())
    expect(f).toHaveLength(1)
    expect(f[0].known).toBe(false)
  })
})

describe('ratchet bookkeeping', () => {
  it('reports a seeded table as resolved once it no longer appears', () => {
    // fixture_fixed no longer has a finding; fixture_open still does.
    const seeded = ['fixture_fixed', 'fixture_open']
    const resolved = resolvedEntries([{ table: 'fixture_open' }], seeded)
    expect(resolved).toContain('fixture_fixed')
    expect(resolved).not.toContain('fixture_open')
  })

  it('reports every seeded entry as resolved when the findings list is empty', () => {
    expect(resolvedEntries([], ['fixture_a', 'fixture_b'])).toEqual(['fixture_a', 'fixture_b'])
  })

  it('reports allowlist entries that no longer carry an unconditional policy', () => {
    const stale = staleAllowlistEntries(inv([policy({ table: 'assets' })]))
    expect(stale).toContain('asset_classes')
    expect(stale).not.toContain('assets')
  })
})

/**
 * Regression fixtures for the shapes the first version of this guard could not
 * see. Each one is a miniature of something that is in production today.
 */
describe('broad permissive siblings', () => {
  const inv2 = (policies: unknown[], tables: unknown[] = []) => ({ tables, policies })
  const t = (name: string, anon = '') => ({ name, rls: true, anon, auth: 'SELECT' })
  const pol = (over: Record<string, unknown>) => ({
    table: 'portfolio_team', name: 'p', cmd: 'SELECT', roles: 'authenticated',
    permissive: 'PERMISSIVE', unconditional: false, ...over,
  })

  /**
   * The escalation this detector was written for. Neither predicate is `true`,
   * so the original guard reported nothing while every authenticated user could
   * read every row.
   */
  it('flags an auth-only sibling that defeats a correctly scoped policy', () => {
    const f = classify(inv2([
      pol({ name: 'Portfolio team: org-scoped read', qual: 'portfolio_in_current_org(portfolio_id)' }),
      pol({ name: 'pt_select_all_authed', qual: '(auth.uid() IS NOT NULL)' }),
    ], [t('portfolio_team')]))
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('SEV2_SIBLING_BYPASS')
    expect(f[0].detail).toContain('pt_select_all_authed')
  })

  it('does not flag a scoped policy standing on its own', () => {
    const f = classify(inv2([
      pol({ qual: 'portfolio_in_current_org(portfolio_id)' }),
    ], [t('portfolio_team')]))
    expect(f).toEqual([])
  })

  /** A legitimate tenant-scoped child. Two scoped siblings are not a bypass. */
  it('does not flag two policies that are both scoped', () => {
    const f = classify(inv2([
      pol({ table: 'fixture_scoped_child', name: 'a', qual: '(EXISTS ( SELECT 1 FROM themes t WHERE ((t.id = fixture_scoped_child.theme_id) AND (t.organization_id = current_org_id()))))' }),
      pol({ table: 'fixture_scoped_child', name: 'b', qual: '(auth.uid() = created_by)' }),
    ], [t('fixture_scoped_child')]))
    expect(f).toEqual([])
  })

  /**
   * `auth.uid() IS NOT NULL` is FALSE without a session, so a `TO public` policy
   * carrying it is not an anonymous hole. Reporting one would be a false alarm.
   */
  it('does not report an anon bypass for a predicate that requires a session', () => {
    const f = classify(inv2([
      pol({ roles: 'public', name: 'view all', qual: '(auth.uid() IS NOT NULL)' }),
      pol({ roles: 'public', name: 'own', qual: '(user_id = auth.uid())' }),
    ], [t('portfolio_team', 'SELECT')]))
    expect(f.map((x: any) => x.severity)).toEqual(['SEV2_SIBLING_BYPASS'])
  })

  /** An unconditional sibling IS reachable by anon, and is a SEV1. */
  it('escalates to SEV1 when the broad sibling is reachable without a login', () => {
    const f = classify(inv2([
      pol({ roles: 'public', name: 'wide open', qual: 'true', unconditional: true }),
      pol({ roles: 'public', name: 'own', qual: '(user_id = auth.uid())' }),
    ], [t('portfolio_team', 'SELECT')]))
    expect(f.some((x: any) => x.severity === 'SEV1_ANON_SIBLING_BYPASS')).toBe(true)
  })

  /** `FOR ALL` is four policies wearing one name, and sits in all four groups. */
  it('expands FOR ALL so it is seen as a sibling of a scoped SELECT', () => {
    const f = classify(inv2([
      pol({ name: 'scoped read', cmd: 'SELECT', qual: 'portfolio_in_current_org(portfolio_id)' }),
      pol({ name: 'manage', cmd: 'ALL', qual: '(auth.uid() IS NOT NULL)' }),
    ], [t('portfolio_team')]))
    expect(f.some((x: any) => x.severity === 'SEV2_SIBLING_BYPASS' && x.cmd === 'SELECT')).toBe(true)
  })

  /** A RESTRICTIVE policy ANDs over the group and may be the real boundary. */
  it('does not claim a bypass it cannot prove when a restrictive policy is present', () => {
    const f = classify(inv2([
      pol({ name: 'scoped', qual: 'portfolio_in_current_org(portfolio_id)' }),
      pol({ name: 'broad', qual: '(auth.uid() IS NOT NULL)' }),
      pol({ name: 'tenant fence', permissive: 'RESTRICTIVE', qual: 'portfolio_in_current_org(portfolio_id)' }),
    ], [t('portfolio_team')]))
    expect(f).toEqual([])
  })
})

describe('UPDATE whose post-image check is broader than its row filter', () => {
  const inv2 = (policies: unknown[], tables: unknown[] = []) => ({ tables, policies })
  const t = (name: string) => ({ name, rls: true, anon: '', auth: 'SELECT' })

  it('flags a scoped USING with an unconditional WITH CHECK', () => {
    const f = classify(inv2([{
      table: 'portfolio_team', name: 'u', cmd: 'UPDATE', roles: 'authenticated',
      permissive: 'PERMISSIVE', unconditional: false,
      qual: 'portfolio_in_current_org(portfolio_id)', with_check: 'true',
    }], [t('portfolio_team')]))
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('SEV2_UPDATE_CHECK_WEAKER')
  })

  /**
   * PostgreSQL reuses USING as the check when WITH CHECK is omitted, so this
   * shape is safe and must not be reported. `Portfolio team: org-scoped update`
   * is exactly this, and its real defect is the sibling, not the omission.
   */
  it('does not flag an omitted WITH CHECK, which falls back to USING', () => {
    const f = classify(inv2([{
      table: 'portfolio_team', name: 'u', cmd: 'UPDATE', roles: 'authenticated',
      permissive: 'PERMISSIVE', unconditional: false,
      qual: 'portfolio_in_current_org(portfolio_id)', with_check: null,
    }], [t('portfolio_team')]))
    expect(f).toEqual([])
  })
})

/**
 * The analyst_performance_snapshots shape, end to end.
 *
 * This is the finding the sibling detector produced on the day it was written,
 * reproduced here from the exact production policies so that the guard's ability
 * to see it cannot regress — and so the proposed replacement is checked to be
 * genuinely narrower rather than merely different.
 */
describe('analyst_performance_snapshots (found by the sibling detector)', () => {
  const inv2 = (policies: unknown[], tables: unknown[] = []) => ({ tables, policies })
  const t = (name: string, anon = '') => ({ name, rls: true, anon, auth: 'SELECT' })

  // Verbatim from prod-pre-deploy-20260826-234204.json.
  const LIVE = [
    {
      table: 'analyst_performance_snapshots', name: 'Users can manage their own snapshots',
      cmd: 'ALL', roles: 'public', permissive: 'PERMISSIVE', unconditional: false,
      qual: '(user_id = auth.uid())', with_check: null,
    },
    {
      table: 'analyst_performance_snapshots', name: 'Users can view all performance snapshots',
      cmd: 'SELECT', roles: 'public', permissive: 'PERMISSIVE', unconditional: false,
      qual: '(auth.uid() IS NOT NULL)', with_check: null,
    },
  ]

  /** Test 14. */
  it('identifies the broad authenticated sibling', () => {
    const f = classify(inv2(LIVE, [t('analyst_performance_snapshots', 'SELECT')]))
    const bypass = f.filter((x: any) => x.severity === 'SEV2_SIBLING_BYPASS')
    expect(bypass).toHaveLength(1)
    expect(bypass[0].cmd).toBe('SELECT')
    expect(bypass[0].roles).toBe('authenticated')
    expect(bypass[0].detail).toContain('Users can view all performance snapshots')
    expect(bypass[0].detail).toContain('AUTH_ONLY')
  })

  /**
   * It is NOT an anonymous hole: `auth.uid() IS NOT NULL` is false without a
   * session, even though the policy is `TO public` and anon holds SELECT.
   * Reporting SEV1 here would be a false alarm.
   */
  it('does not escalate it to an anonymous bypass', () => {
    const f = classify(inv2(LIVE, [t('analyst_performance_snapshots', 'SELECT')]))
    expect(f.some((x: any) => x.severity === 'SEV1_ANON_SIBLING_BYPASS')).toBe(false)
  })

  /** Test 16: the old shape must still be caught from a sanitized inventory. */
  it('still catches the old shape from hashes alone, with no predicate text', () => {
    const hashed = LIVE.map(p => ({
      table: p.table, name: p.name, cmd: p.cmd, roles: p.roles, permissive: p.permissive,
      unconditional: false,
      // left(sha256(...),16) of the predicates above — what the inventory stores.
      qual_hash: p.name.includes('manage') ? 'd234b2aea4e8dd40' : '9e9d875f1a56f557',
      check_hash: 'e3b0c44298fc1c14',
    }))
    const f = classify(inv2(hashed, [t('analyst_performance_snapshots', 'SELECT')]))
    expect(f.some((x: any) => x.severity === 'SEV2_SIBLING_BYPASS')).toBe(true)
  })

  /** Test 15: the proposed replacement is clean, and stays clean as a pair. */
  it('reports nothing for the proposed org-scoped replacement', () => {
    const FIXED = [
      {
        table: 'analyst_performance_snapshots', name: 'analyst_performance_snapshots_write',
        cmd: 'ALL', roles: 'authenticated', permissive: 'PERMISSIVE', unconditional: false,
        qual: '(user_id = auth.uid())', with_check: '(user_id = auth.uid())',
      },
      {
        table: 'analyst_performance_snapshots', name: 'analyst_performance_snapshots_select',
        cmd: 'SELECT', roles: 'authenticated', permissive: 'PERMISSIVE', unconditional: false,
        qual: '((user_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM organization_memberships m ' +
              'WHERE ((m.user_id = analyst_performance_snapshots.user_id) ' +
              'AND (m.organization_id = current_org_id()) AND (m.status = \'active\'::text)))))',
        with_check: null,
      },
    ]
    expect(classify(inv2(FIXED, [t('analyst_performance_snapshots')]))).toEqual([])
  })

  /**
   * The replacement's SELECT predicate contains a top-level OR, which is the
   * exact syntax of the defect. It is fine here because BOTH branches are
   * scoped — one to the caller, one to the caller's org. This pins the
   * distinction, so "it has an OR" is never mistaken for "it is broken".
   */
  it('treats the replacement OR as scoped because every branch is scoped', () => {
    const both = '((user_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM organization_memberships m ' +
                 'WHERE ((m.organization_id = current_org_id())))))'
    expect(classifyPredicateText(both)).toBe('SCOPED')

    // ...and the moment one branch stops being scoped, it is AUTH_ONLY again.
    const regressed = '((user_id = auth.uid()) OR (auth.uid() IS NOT NULL))'
    expect(classifyPredicateText(regressed)).toBe('AUTH_ONLY')
  })
})
