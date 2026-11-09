import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * A notification that knows its asset stops throwing it away.
 *
 * ── The two tiles ─────────────────────────────────────────────────────────
 *
 * After the attention destination ladder landed, 2 of 144 tiles on the live
 * desktop Explore field still opened nothing, both reading "Price Target
 * Expired: AAPL". They were not missing data. Queried in production:
 *
 *   context_type = 'price_target'  (13 rows)
 *   context_data = { asset_id, asset_symbol, asset_name, target_price, ... }
 *
 * `collectNotifications` read `context_type === 'asset' ? context_id : null`
 * and ignored `context_data` entirely, so the subject that the producer had
 * already written into the row never reached the tile. No new query was needed
 * to fix it: the row is read with `select('*')`, and this same function
 * already reads `context_data?.changed_by` two lines above.
 *
 * ── Why this test reads source ────────────────────────────────────────────
 *
 * `collectNotifications` is a module-private async function that calls
 * `supabase` directly; it is not exported and there is no seam to inject a
 * client through. Pinning the read is worth more than no coverage, and the
 * live measurement above is the behavioural evidence. The isolation half is a
 * genuine assertion either way, because it is about a lookup table.
 */

const SRC = resolve(__dirname, '../useAttention.ts')
const code = () => readFileSync(SRC, 'utf8')

/** Comments quote the old line to explain why it is gone. Strip them first. */
const bare = () => code()
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

describe('a notification about an asset reaches the tile with its asset', () => {
  it('falls back to the payload the producer wrote', () => {
    const body = bare()
    expect(body).toContain('n.context_data?.asset_id')
    // And the ticker beside it, which the same payload carries.
    expect(body).toContain('n.context_data?.asset_symbol')
  })

  it('no longer hard-nulls the symbol for every notification', () => {
    const fn = bare()
    const start = fn.indexOf('async function collectNotifications')
    const scope = fn.slice(start, fn.indexOf('\n}\n', start))
    expect(scope).not.toContain('symbol: null,')
  })

  it('still honours context_type first, which is the explicit statement', () => {
    // The payload is a FALLBACK. A row that says what it is about in
    // `context_type` must keep winning, or a stale `context_data` copy could
    // override the row's own declaration.
    const body = bare()
    expect(body).toMatch(/context_type === 'asset'\s*\n?\s*\?\s*n\.context_id/)
  })

  it('reads the project out of the payload too, by the same rule', () => {
    expect(bare()).toContain('n.context_data?.project_id')
  })
})

describe('what must NOT be added to the org filter', () => {
  /**
   * Rewritten, with the reason recorded, in the same session that wrote it.
   *
   * This case first asserted `price_target: 'price_targets'` was PRESENT, on
   * the reasoning that a notification which now names an asset should have its
   * subject org-checked. The entry was added and the live field was measured:
   * the two price-target tiles disappeared instead of becoming openable.
   *
   * Queried in production, all 13 `Price Target Expired` rows have a
   * `context_id` matching no row in `price_targets` -- the target was deleted
   * after the notification was raised. `filterNotificationsToOrg` drops any
   * row whose subject the lookup cannot find, so the entry deleted the
   * notifications outright. Losing the row is worse than the inert tile.
   *
   * So the assertion is inverted and the rule it pins is the general one:
   * this map may only name a table whose rows still exist for every
   * notification that points at it. `user_id` already scopes these rows.
   */
  it('does NOT scope a price-target notification to a row that may be gone', () => {
    const body = bare()
    const start = body.indexOf('const SCOPED')
    const map = body.slice(start, body.indexOf('}', start))
    expect(map).not.toMatch(/^\s*price_target:/m)
  })

  it('does NOT add `asset`, because assets have no organization_id', () => {
    // Verified against the live schema: `assets` has no `organization_id`
    // column -- it is global reference data by design (CLAUDE.md's documented
    // exception). Adding it to this map would make the `.eq('organization_id')`
    // lookup return nothing and silently drop every asset notification.
    const body = bare()
    const start = body.indexOf('const SCOPED')
    const map = body.slice(start, body.indexOf('}', start))
    expect(map).not.toMatch(/^\s*asset:/m)
  })

  it('keeps every subject in the map pointing at an org-owned table', () => {
    // The whole filter depends on this: an entry whose table has no
    // `organization_id` filters its rows to nothing rather than scoping them.
    const body = bare()
    const start = body.indexOf('const SCOPED')
    const map = body.slice(start, body.indexOf('}', start))
    const tables = [...map.matchAll(/:\s*'([a-z_]+)'/g)].map(m => m[1])
    expect(tables.length).toBeGreaterThan(6)
    expect(tables).not.toContain('assets')
    // And not `price_targets`: see the case above. A table the subject row may
    // have been deleted from turns this filter into a silent delete.
    expect(tables).not.toContain('price_targets')
  })
})
