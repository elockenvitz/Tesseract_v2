import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error — plain ESM helper, intentionally untyped
import { scanFile, ORG_SCOPED_TABLES } from '../org-scope-scan.mjs'
import baseline from '../known-unscoped-queries.json'

/**
 * The six Desktop hooks that reached the release reading across workspaces.
 *
 * Integration verification found 21 unscoped queries against organisation-
 * scoped tables in these files. RLS does not close them: policies on
 * `asset_notes`, `asset_contributions`, `analyst_price_targets` and
 * `trade_queue_items` are not organisation-aware, so the client-side filter is
 * the entire boundary.
 *
 * Two shapes, both real:
 *
 *   - filtered by `asset_id` only. An asset is SHARED across organisations;
 *     the thesis, evidence, ladders and ideas recorded against it are not. So
 *     an asset filter selects the right name and the wrong workspace.
 *   - not filtered at all. `useResearchScan` read whole tables, and
 *     `useIdeaScan` read the entire idea queue, both across every organisation.
 *
 * These tests are the thing that would have caught it. They are source-level
 * because there is no live database here, and the property is a property of
 * the query, not of a fixture.
 */

const HOOKS = [
  'useAssetWorkspace.ts',
  'useDesktopDecisions.ts',
  'useDesktopIdeas.ts',
  'useDesktopPortfolio.ts',
  'useDesktopResearch.ts',
  'useTodayEnrichment.ts',
] as const

const read = (f: string) => readFileSync(join(process.cwd(), 'src', 'hooks', f), 'utf8')

describe('the Desktop hooks cannot read another workspace', () => {
  it.each(HOOKS)('%s scopes every org-scoped read', file => {
    const violations = scanFile(`src/hooks/${file}`, read(file)) as Array<{
      line: number; table: string
    }>
    const report = violations.map(v => `  line ${v.line}: ${v.table}`).join('\n')
    expect(violations, violations.length ? `\n${file} reads across organisations:\n${report}\n` : undefined)
      .toHaveLength(0)
  })

  it.each(HOOKS)('%s gates its query on a known organisation', file => {
    /*
     * The filter alone is not enough. Without `enabled`, the query runs while
     * the organisation is still resolving and `.eq('organization_id', null)`
     * decides the result -- a blank surface that looks like "no data" rather
     * than "not loaded yet". Gating also keeps the id in the query key, so
     * switching workspace refetches instead of serving the previous one's
     * cache.
     */
    const body = read(file)
    expect(body, `${file} never reads the active organisation`).toMatch(/useOrganization\(\)/)
    expect(body, `${file} does not gate a query on currentOrgId`).toMatch(/enabled:[^\n]*currentOrgId/)
    expect(body, `${file} does not key a query by currentOrgId`).toMatch(/queryKey:[^\n]*currentOrgId/)
  })

  it('did not reach green by joining the register', () => {
    /*
     * The cheapest way to silence the guard is to add a file to
     * known-unscoped-queries.json. None of these six is on it, and none may
     * be: the register is for files that rely on RLS, and for these tables
     * RLS is not organisation-aware.
     */
    const known = new Set(baseline as string[])
    for (const f of HOOKS) expect(known.has(`src/hooks/${f}`), `${f} is on the register`).toBe(false)
  })

  it('still watches the tables these hooks touch', () => {
    // If a table were dropped from the scanner's list, the tests above would
    // pass by looking at nothing.
    for (const t of ['asset_notes', 'asset_contributions', 'analyst_price_targets', 'trade_queue_items']) {
      expect(ORG_SCOPED_TABLES).toContain(t)
    }
  })
})
