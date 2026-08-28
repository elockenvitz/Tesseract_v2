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
 */
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs script, no type declarations by design
import { classify, resolvedEntries, staleAllowlistEntries } from '../../../../scripts/unconditional-policy-guard.mjs'

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
    const f = classify(inv([policy({ table: 'object_links' })], [table('object_links')]))
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('SEV2_CROSS_TENANT_READ')
    expect(f[0].table).toBe('object_links')
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
    const f = classify(inv([
      policy({ table: 'object_links' }),          // seeded in KNOWN_UNRESOLVED
      policy({ table: 'a_brand_new_table' }),
    ], [table('object_links'), table('a_brand_new_table')]))
    expect(f.find((x: any) => x.table === 'object_links').known).toBe(true)
    expect(f.find((x: any) => x.table === 'a_brand_new_table').known).toBe(false)
  })
})

describe('ratchet bookkeeping', () => {
  it('reports a seeded table as resolved once it no longer appears', () => {
    // theme_assets fixed, object_links not yet.
    const resolved = resolvedEntries([{ table: 'object_links' }])
    expect(resolved).toContain('theme_assets')
    expect(resolved).not.toContain('object_links')
  })

  it('reports allowlist entries that no longer carry an unconditional policy', () => {
    const stale = staleAllowlistEntries(inv([policy({ table: 'assets' })]))
    expect(stale).toContain('asset_classes')
    expect(stale).not.toContain('assets')
  })
})
