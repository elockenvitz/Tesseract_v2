import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM helper, intentionally untyped
import { scanTree, ORG_SCOPED_TABLES } from '../org-scope-scan.mjs'
import baseline from '../known-unscoped-queries.json'

/**
 * Guards against new organisation-scoping holes.
 *
 * Several feed sources were querying organisation-scoped tables with no
 * organization_id filter, so one workspace showed another's decisions, ideas
 * and notes. Those are fixed, but the same mistake is easy to repeat: the
 * filter is invisible by omission, and nothing fails when it is missing.
 *
 * It matters more than a normal lint because RLS does not cover it. Policies
 * on trade_queue_items, quick_thoughts, asset_notes and asset_lists are not
 * organisation-aware, so for those tables the client-side filter is the only
 * thing separating workspaces.
 *
 * This test does not demand the existing 110 files be fixed at once — that is
 * a separate piece of work. It fails when a file *not already known to be
 * unscoped* introduces an unscoped query, so the problem cannot grow.
 *
 * To fix a file: add `.eq('organization_id', orgId)`, then remove it from
 * known-unscoped-queries.json so it can never regress. If a query genuinely
 * must span organisations, put `org-scope-exempt: <reason>` in a comment
 * directly above it.
 */
describe('organisation scoping', () => {
  const known = new Set(baseline as string[])

  it('introduces no new unscoped queries against org-scoped tables', () => {
    const violations = scanTree('src') as Array<{ file: string; line: number; table: string }>
    const offenders = violations.filter(v => !known.has(v.file))

    const report = offenders
      .map(v => `  ${v.file}:${v.line} queries ${v.table} without an organization_id filter`)
      .join('\n')

    expect(offenders, offenders.length ? `\n${report}\n` : undefined).toHaveLength(0)
  })

  it('keeps the baseline honest — no stale entries', () => {
    const violations = scanTree('src') as Array<{ file: string }>
    const stillUnscoped = new Set(violations.map(v => v.file))
    // A file listed as unscoped that no longer is should be removed from the
    // baseline, otherwise it silently regains permission to regress.
    const stale = [...known].filter(f => !stillUnscoped.has(f))

    expect(stale, stale.length ? `\nFixed — remove from known-unscoped-queries.json:\n${stale.map(f => '  ' + f).join('\n')}\n` : undefined).toHaveLength(0)
  })

  it('watches the tables that actually carry workspace data', () => {
    // A reminder to extend the list when a new org-scoped table appears.
    expect(ORG_SCOPED_TABLES).toContain('trade_queue_items')
    expect(ORG_SCOPED_TABLES).toContain('quick_thoughts')
    expect(ORG_SCOPED_TABLES).toContain('asset_notes')
  })
})
