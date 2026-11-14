/**
 * The dashboard pane and the Asset page cannot disagree about the same case.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * The dashboard asset pane's only read is `useAssetWorkspace`, and it reads
 * tables the full Asset page owns the EDITORS for: `asset_contributions` for
 * the case, `analyst_price_targets` for the targets. Those editors invalidate
 * their own keys -- `contributions`, `analyst-price-targets`,
 * `desktop-research`, `scenario-cards` -- and the pane's key was not among
 * them.
 *
 * So: edit the case on the Asset page, go back to the dashboard pane, and the
 * pane states the OLD case. Not for an instant either. `staleTime` is 60
 * seconds, so for the first minute the pane does not even refetch on mount --
 * it serves the cached rows and prints "written 30d ago" over a paragraph the
 * reader has just rewritten, or "No core investment case has been written"
 * over one they have just written.
 *
 * It became EASIER to reach, not harder, when "Edit in research" stopped
 * opening an editor inside the pane and started sending the reader to the
 * Asset page. That made leaving and coming back the normal way to edit the
 * case rather than an unusual one.
 *
 * ── Why this is tested against a real QueryClient ─────────────────────────
 *
 * The thing that can be wrong is whether a key MATCHES, and only React Query
 * can answer that. A test asserting the string `'asset-workspace'` appears
 * somewhere would pass with the prefix misspelled, nested one level too deep,
 * or scoped to an asset id that the real key carries three more segments
 * after. So: seed real entries under the real key shape, run the real
 * invalidator, and read the real staleness back.
 */
import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { ASSET_WORKSPACE_KEY, invalidateAssetWorkspace } from '../useAssetWorkspace'

/**
 * The key as the hook actually builds it:
 * `[prefix, assetId, symbol, days, orgId]`.
 */
const key = (assetId: string, symbol: string | null, days: number, orgId: string) =>
  [ASSET_WORKSPACE_KEY, assetId, symbol, days, orgId]

function seeded() {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } })
  qc.setQueryData(key('a-1', 'AAPL', 12, 'org-1'), { sections: ['stale'] })
  return qc
}

const isStale = (qc: QueryClient, k: unknown[]) =>
  qc.getQueryState(k)?.isInvalidated === true

describe('a write marks the pane stale', () => {
  it('invalidates the entry the pane is actually holding', () => {
    const qc = seeded()
    expect(isStale(qc, key('a-1', 'AAPL', 12, 'org-1'))).toBe(false)

    invalidateAssetWorkspace(qc)

    expect(isStale(qc, key('a-1', 'AAPL', 12, 'org-1'))).toBe(true)
  })

  it('reaches every variant of the same asset, not just one', () => {
    /*
     * THE case for a prefix. The key carries the symbol, the history depth
     * and the organisation as well as the asset, and the reader can be
     * holding several at once: the pane opened at a shallow depth, the same
     * asset opened again with `deepHistory` for a chart. An id-scoped
     * invalidation would have to reproduce all four segments and would miss
     * whichever variant was actually on screen.
     */
    const qc = seeded()
    qc.setQueryData(key('a-1', 'AAPL', 400, 'org-1'), { sections: ['deep'] })
    qc.setQueryData(key('a-2', 'MSFT', 12, 'org-1'), { sections: ['other'] })

    invalidateAssetWorkspace(qc)

    expect(isStale(qc, key('a-1', 'AAPL', 12, 'org-1'))).toBe(true)
    expect(isStale(qc, key('a-1', 'AAPL', 400, 'org-1'))).toBe(true)
    /* Another asset too, and that is accepted deliberately: the cost is one
       refetch of a pane that is usually not mounted, and the alternative is
       each of the ten writers knowing this key's shape. */
    expect(isStale(qc, key('a-2', 'MSFT', 12, 'org-1'))).toBe(true)
  })

  it('leaves the other surfaces\' caches alone', () => {
    /* A prefix, not a sweep. Invalidating everything would make every write
       on the asset page refetch the page itself. */
    const qc = seeded()
    qc.setQueryData(['contributions', 'a-1'], [{ id: 'c-1' }])
    qc.setQueryData(['scenario-cards', 'org-1'], [{ id: 's-1' }])

    invalidateAssetWorkspace(qc)

    expect(isStale(qc, ['contributions', 'a-1'])).toBe(false)
    expect(isStale(qc, ['scenario-cards', 'org-1'])).toBe(false)
  })

  it('does not depend on an entry existing', () => {
    /* The pane is usually not mounted when the case is edited -- that is the
       whole scenario. Invalidating an absent key must be a no-op, not a
       throw, or every save on the Asset page fails for the common case. */
    const qc = new QueryClient()
    expect(() => invalidateAssetWorkspace(qc)).not.toThrow()
  })
})

describe('the prefix is the one the hook uses', () => {
  it('is a single segment, so the prefix match is a prefix match', () => {
    /*
     * If the exported constant were an ARRAY -- `['asset-workspace']` -- the
     * hook's key would be `[['asset-workspace'], assetId, ...]`: nested one
     * level, matching nothing the invalidator looks for, and every assertion
     * above would still pass because both sides would be wrong together.
     */
    expect(typeof ASSET_WORKSPACE_KEY).toBe('string')
    expect(ASSET_WORKSPACE_KEY).toBe('asset-workspace')
  })
})
