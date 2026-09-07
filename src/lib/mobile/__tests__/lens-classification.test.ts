import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { categoryOf } from '../feed-categories'
import { categoryForType } from '../../signals/content-registry'

/**
 * A lens entry has no card either.
 *
 * ── The same defect, one family over ──────────────────────────────────────
 *
 * Stage 3K found that an insight entry is `{ kind, score, insight, round }`
 * and carries no card at filter time, so a stamped Portfolio card was
 * classified from its entry kind and stayed in Research. Stage 3M then moved
 * `crowding` and `no_target` to Portfolio in the registry — and they did not
 * move, because a lens entry is `{ kind: 'lens', score, lens }` and carries no
 * card either. `categoryOf` fell through to `case 'lens': return 'decisions'`
 * and the registry was never consulted.
 *
 * Two families, two entry shapes, one root cause: the object the filters
 * classify is not the object that knows what it is. The fix is the same shape
 * as 3K's — the entry declares what the classifier needs, from the one
 * function that also tells the ranker.
 *
 * `active_risk` was never affected: it arrives as a `template` entry, which
 * has carried `card: { type }` since the News misfiling was corrected.
 */

const PORTFOLIO_LENSES = [
  { lens: 'crowded', type: 'crowding' },
  { lens: 'untargeted', type: 'no_target' },
] as const

const DECISION_LENSES = [
  { lens: 'breach', type: 'target_hit' },
  { lens: 'stale', type: 'target_expired' },
  { lens: 'conviction', type: 'conviction_oversized' },
] as const

describe('a lens entry classifies from its declared type', () => {
  it.each(PORTFOLIO_LENSES)('$lens reaches Portfolio', ({ type }) => {
    expect(categoryForType(type)).toBe('portfolio')
    expect(categoryOf({ kind: 'lens', signalType: type })).toBe('portfolio')
  })

  it.each(DECISION_LENSES)('$lens stays in Decisions', ({ type }) => {
    expect(categoryOf({ kind: 'lens', signalType: type })).toBe('decisions')
  })

  it('would have been Decisions without the declaration', () => {
    // The bug, reproduced: an entry that knows nothing falls to its kind.
    expect(categoryOf({ kind: 'lens' })).toBe('decisions')
    expect(categoryOf({ kind: 'lens', signalType: 'crowding' })).toBe('portfolio')
  })

  it('agrees with the card once one exists', () => {
    // The entry is filtered, the card is rendered. If they disagreed a card
    // would be filtered into one lens and render in another.
    for (const { type } of [...PORTFOLIO_LENSES, ...DECISION_LENSES]) {
      expect(categoryOf({ kind: 'lens', signalType: type }))
        .toBe(categoryOf({ kind: 'lens', card: { type } }))
    }
  })

  it('lets the built card win if the two ever differ', () => {
    // `card.type` is the stronger claim: it is what actually rendered.
    expect(categoryOf({ kind: 'lens', signalType: 'crowding', card: { type: 'news' } }))
      .toBe('news')
  })
})

describe('one mapping, for the entry and the ranker', () => {
  const src = readFileSync(
    resolve(__dirname, '../../../components/mobile/MobileDashboard.tsx'), 'utf8',
  )

  it('declares the type on every lens entry', () => {
    // Five lens rows, five declarations. A row that forgot would silently
    // classify from its kind again.
    expect(src.match(/signalType: lensSignalType\(/g) ?? []).toHaveLength(5)
  })

  it('gives the ranker the same function', () => {
    // The mapping used to live only inside `rankInputFor`, which is why the
    // entry had nothing. Two callers, one source of truth.
    expect(src).toContain('type: lensSignalType(l),')
    expect(src).toContain('function lensSignalType(')
  })

  it('resolves conviction by direction rather than by lens name', () => {
    // The one lens whose type is not a constant, and the reason this is a
    // function rather than a lookup table.
    expect(src).toContain("l.gap?.direction === 'overweight' ? 'conviction_oversized' : 'conviction_undersized'")
  })
})

describe('the diversity cap is not what was hiding them', () => {
  const src = readFileSync(
    resolve(__dirname, '../../../components/mobile/MobileDashboard.tsx'), 'utf8',
  )

  it('does not cap a filtered category, and now diversifies inside it', () => {
    /**
     * ── What this test used to say, and why it changed ──────────────────
     *
     * It pinned `enabled: !kindFilter && !feedFilter.kinds.length && ...` —
     * diversity OFF the moment the reader chose anything — on the reasoning
     * that an explicit Portfolio view should never be subject to mixed-feed
     * composition. Half of that was right and half was the bug: not
     * diversifying ACROSS categories is correct, because it would insert what
     * the reader excluded; not diversifying WITHIN one is what produced "No
     * Thesis, No Thesis, No Thesis, Crowding, Crowding".
     *
     * So the boolean became a scope, and the claim it pins is still that no
     * cap truncates a filtered category — `composeFeed` reorders and never
     * drops, which `feed-compose.test` asserts on the identity set.
     */
    /**
     * ── And why it changed again ────────────────────────────────────────
     *
     * The scope no longer reads the filter at all. It was coherent while the
     * filter chose the pool being composed; it is not, now that one base order
     * is composed per visit and every filter is a view over it. A scope that
     * moved with the filter would change the composition RULES under a reader
     * who only asked to hide some rows, and un-filtering would produce a third
     * order matching neither. The base is always the mixed feed, so the scope
     * is always `mixed`. See `lib/mobile/feed-continuity`.
     */
    expect(src).toContain("const scope: ComposeScope = 'mixed'")
    expect(src).not.toContain("feedFilter.signalTypes.length ? 'type'")
  })

  it('ranks the unfiltered base, and filters after', () => {
    /**
     * ── The reversal, and why it is not a regression ────────────────────
     *
     * This used to assert the opposite: filter, then rank, so that a filtered
     * category was ranked already-scoped and no post-rank step could truncate
     * it. The no-truncation half of that claim is unchanged and still pinned —
     * `composeFeed` reorders and never drops, on the identity set, in
     * `feed-compose.test`.
     *
     * The ordering half had a cost nobody had priced: with the filter ahead of
     * the ranker, and the filter state in the memo's dependency list, every
     * pill tap re-ranked a different pool and returned a DIFFERENT feed. The
     * tile the reader tapped the pill on moved or vanished, and clearing the
     * filter could not restore an order that nothing had kept.
     *
     * So the pool is now everything, ranked once, and the filter is a view
     * over the result.
     */
    const rankAt = src.indexOf('const ranked = rankFeed<any>(')
    const viewAt = src.indexOf('const byPill = deriveFeedView(')
    expect(rankAt).toBeGreaterThan(0)
    expect(viewAt).toBeGreaterThan(0)
    expect(rankAt).toBeLessThan(viewAt)
    /**
     * The pool the ranker sees carries no filter — updated in place.
     *
     * It read `all.map(...)`. It now reads `afterComposition.map(...)`, and the
     * claim is unchanged: absorption is not a filter. It decides what the
     * CANDIDATES ARE — two findings asking one question are one tile — which is
     * true of the feed before anybody narrows it, and it depends on no filter
     * state. Ranking still runs once over the whole candidate set.
     *
     * What the assertion actually guards is that no filter reaches the pool, so
     * that is what it now says.
     */
    expect(src).toContain('const pool = afterComposition.map(e => ({ ...e, subject: symbolOf(e) }))')
    const poolAt = src.indexOf('const pool = afterComposition.map(')
    const poolLine = src.slice(poolAt, poolAt + 120)
    for (const filterState of ['tileFamily', 'feedFilter', 'kindFilter']) {
      expect(poolLine).not.toContain(filterState)
    }
  })
})

describe('the funnel overlay reports and never decides', () => {
  const dash = readFileSync(
    resolve(__dirname, '../../../components/mobile/MobileDashboard.tsx'), 'utf8',
  )
  const overlay = readFileSync(
    resolve(__dirname, '../../../components/mobile/FeedFunnelOverlay.tsx'), 'utf8',
  )

  it('is gated on a dev build and a URL flag', () => {
    expect(overlay).toContain('import.meta.env.DEV')
    expect(overlay).toContain("get('feedfunnel') === '1'")
    expect(dash).toContain('if (import.meta.env.DEV) {')
  })

  it('writes to a ref, so counting cannot cause a render', () => {
    // State here would make the feed depend on its own diagnostics.
    expect(dash).toContain('funnelRef.current = {')
    expect(dash).not.toContain('setFunnel')
  })

  it('counts only, and holds no card content', () => {
    expect(overlay).not.toContain('headline')
    expect(overlay).not.toContain('metric')
    expect(overlay).toContain('pointer-events-none fixed inset-0')
  })
})
