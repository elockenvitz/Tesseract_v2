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
    expect(src).toContain('const scope: ComposeScope =')
    expect(src).toContain("feedFilter.signalTypes.length ? 'type'")
    expect(src).toContain("(kindFilter || feedFilter.kinds.length) ? 'category'")
  })

  it('applies the reader\'s filter BEFORE ranking, not after', () => {
    // So the ranked set under an explicit filter is already scoped, and there
    // is no post-rank truncation that could cut a category short.
    const filterAt = src.indexOf('const filtered = kindFilter ?')
    const rankAt = src.indexOf('const ranked = rankFeed<any>(')
    expect(filterAt).toBeGreaterThan(0)
    expect(rankAt).toBeGreaterThan(0)
    expect(filterAt).toBeLessThan(rankAt)
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
