/**
 * One asset, one contributions query, however many sections ask.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `useContributions` was keyed `['contributions', assetId, section]` and
 * pushed the section into SQL as `.eq('section', section)`. Every reader on
 * the asset page therefore had its own cache entry and its own round trip,
 * and the page has many readers: `AssetTab` fetches the asset's rows with no
 * section, `ThesisContainer` fetches three more, and every
 * `ContributionSection` on screen fetches another -- each a strict SUBSET of
 * rows the page already held. `useAggregateHistory` added a fifth kind, a
 * round trip whose only purpose was to learn the ids of rows already loaded,
 * and which the real history query then waited on.
 *
 * Measured on a cold open of the asset page at 1920: 161 Supabase requests,
 * eleven of them this table, peaking at 49 in flight at once.
 *
 * ── Why these shapes ─────────────────────────────────────────────────────
 *
 * The filter is now a pure function, so it is tested as one: these cases
 * would catch a field rendering another section's prose, which is the way
 * this change could go wrong in a reader's hands and the way no source
 * assertion can see.
 *
 * The one-query invariant is source-pinned, following the precedent in
 * `contribution-visibility-preservation.test.ts`: the hook needs a live
 * Supabase client, an auth session and an organization context, and mocking
 * the client would only prove the mock received what the test told it to.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contributionsForSection, type Contribution } from '../useContributions'

const HOOK = readFileSync(join(process.cwd(), 'src/hooks/useContributions.ts'), 'utf8')
  // Comments explain the invariants; they must not be able to satisfy them.
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const row = (id: string, section: string) => ({ id, section } as unknown as Contribution)

/** TSLA as it actually stands: 3 business_model, 2 thesis, 2 risks, 1 each. */
const TSLA = [
  row('bm1', 'business_model'), row('bm2', 'business_model'), row('bm3', 'business_model'),
  row('th1', 'thesis'), row('th2', 'thesis'),
  row('rk1', 'risks_to_thesis'), row('rk2', 'risks_to_thesis'),
  row('wd1', 'where_different'),
  row('kc1', 'key_catalysts'),
]

describe('the section filter the SQL used to do', () => {
  it('gives a section only its own rows', () => {
    expect(contributionsForSection(TSLA, 'business_model').map(r => r.id)).toEqual(['bm1', 'bm2', 'bm3'])
    expect(contributionsForSection(TSLA, 'thesis').map(r => r.id)).toEqual(['th1', 'th2'])
    expect(contributionsForSection(TSLA, 'key_catalysts').map(r => r.id)).toEqual(['kc1'])
  })

  it('never lets one section show another section prose', () => {
    for (const s of ['business_model', 'thesis', 'risks_to_thesis', 'where_different', 'key_catalysts']) {
      expect(contributionsForSection(TSLA, s).every(r => r.section === s)).toBe(true)
    }
  })

  it('returns every row when no section is asked for, which is what AssetTab reads', () => {
    expect(contributionsForSection(TSLA)).toHaveLength(TSLA.length)
    // The same array, not a copy: the unsectioned caller is the common case
    // and must not get a new reference on every render.
    expect(contributionsForSection(TSLA)).toBe(TSLA)
  })

  it('gives an empty list for a section nobody has written, not every row', () => {
    expect(contributionsForSection(TSLA, 'moat')).toEqual([])
  })

  it('preserves the order the query returned, which is most-recent-first', () => {
    expect(contributionsForSection(TSLA, 'risks_to_thesis').map(r => r.id)).toEqual(['rk1', 'rk2'])
  })
})

describe('one cache entry per asset', () => {
  it('keys the read on the asset alone, so every section shares it', () => {
    expect(HOOK).toContain("queryKey: ['contributions', assetId]")
    // The three-part key is what gave each section its own entry and its own
    // request. Its return would silently restore the fan-out.
    expect(HOOK).not.toMatch(/queryKey:\s*\['contributions',\s*assetId,\s*section\]/)
  })

  it('filters in memory, not in SQL', () => {
    const read = HOOK.slice(HOOK.indexOf('function useAssetContributions'))
      .slice(0, HOOK.slice(HOOK.indexOf('function useAssetContributions')).indexOf('export function useContributions'))
    expect(read).toContain('contributionsForSection')
    expect(read).not.toMatch(/\.eq\('section'/)
  })

  it('still invalidates on the prefix every mutation already used', () => {
    // Dropping `section` from the key only stays safe while the invalidations
    // are prefix matches. A three-part invalidate would miss the entry.
    expect(HOOK).toContain("invalidateQueries({ queryKey: ['contributions', assetId] })")
  })
})

describe('aggregate history asks nobody for ids it already has', () => {
  const body = HOOK.slice(HOOK.indexOf('export function useAggregateHistory'))

  it('issues no asset_contributions query of its own', () => {
    // This was the serial round trip: ids first, history second, per section.
    expect(body).not.toMatch(/from\('asset_contributions'\)/)
  })

  it('takes the ids from the shared query instead', () => {
    expect(body).toContain('useAssetContributions(assetId, section)')
    expect(body).toMatch(/contributionIds\s*=\s*useMemo/)
  })

  it('waits for the ids rather than keying on them', () => {
    // Keying on the ids would mint a fresh entry the moment the shared query
    // resolves, discarding the in-flight request and asking again.
    expect(body).toContain('contributionIds.length > 0')
    expect(body).toMatch(/queryKey:\s*\['aggregate-history',\s*assetId,\s*section\]/)
  })
})
