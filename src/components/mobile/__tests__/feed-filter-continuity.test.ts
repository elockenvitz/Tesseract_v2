/**
 * How the dashboard is wired to the continuity model.
 *
 * `feed-continuity.test` pins the model itself against plain objects. This
 * pins the four wiring decisions that the model cannot enforce on its own and
 * that a well-meaning edit to a 7,000-line component would silently undo.
 *
 * Source assertions rather than a render, for the same reason
 * `lens-classification.test` uses them on this file: mounting the dashboard
 * means mounting the whole product behind it, and the claims here are about
 * which value flows into which call — structure, not behaviour under a click.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dash = readFileSync(resolve(__dirname, '../MobileDashboard.tsx'), 'utf8')
const slot = readFileSync(resolve(__dirname, '../FeedSlot.tsx'), 'utf8')

/** The dependency array of the memo that ranks. */
function baseFeedDeps(): string {
  const at = dash.indexOf('const baseFeedEntries = useMemo(() => {')
  expect(at).toBeGreaterThan(0)
  const end = dash.indexOf('}, [dedupedAttention', at)
  expect(end).toBeGreaterThan(at)
  return dash.slice(end, dash.indexOf('])', end))
}

describe('a filter change cannot re-run ranking', () => {
  it('keeps the filter state out of the ranking memo dependencies', () => {
    /**
     * This is the mechanism of the whole defect, in one line of code.
     *
     * `kindFilter` and `feedFilter` were dependencies of the memo that calls
     * `rankFeed` and `composeFeed`. React re-runs a memo when a dependency
     * changes, so tapping a pill re-ranked — and a re-rank is a different
     * feed, not the same feed with rows hidden.
     */
    const deps = baseFeedDeps()
    expect(deps).not.toContain('kindFilter')
    expect(deps).not.toContain('feedFilter')
    expect(deps).not.toContain('tileFamily')
    // The things that legitimately change what the feed IS are still there.
    expect(deps).toContain('dedupedAttention')
    expect(deps).toContain('lenses')
  })

  it('keeps the filters as dependencies of the view instead', () => {
    const at = dash.indexOf('const feedEntries = useMemo(() => {')
    const end = dash.indexOf('}, [baseFeedEntries', at)
    expect(at).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(at)
    const deps = dash.slice(end, dash.indexOf('])', end))
    expect(deps).toContain('tileFamily')
    expect(deps).toContain('feedFilter')
    expect(deps).toContain('kindFilter')
  })

  it('builds the view by filtering and never by sorting', () => {
    const at = dash.indexOf('const feedEntries = useMemo(() => {')
    const body = dash.slice(at, dash.indexOf('}, [baseFeedEntries', at))
    // A sort here would defeat the base snapshot as surely as re-ranking does.
    expect(body).not.toContain('.sort(')
    expect(body).not.toContain('rankFeed')
    expect(body).not.toContain('composeFeed')
    expect(body).toContain('deriveFeedView')
  })
})

describe('the pill filters by the tile type it is printed on', () => {
  it('resolves the family from the entry, not from the entry kind', () => {
    /**
     * It was `setKindFilter(categoryOf({ kind: trackAs }))` — the pill's own
     * `card.type` discarded, and the row reclassified from the hook that
     * produced it into one of six broad categories. So "Case vs Price" asked
     * for all of Decisions, and two different pills on two cards of the same
     * kind gave the identical feed.
     */
    expect(dash).toContain('onFilterKind={() => toggleTileFamily(entry)}')
    expect(dash).not.toContain('setKindFilter(categoryOf({ kind: trackAs })')
    expect(dash).toContain('const family = familyOf(entry)')
  })

  it('threads the entry to the card so the family can be read at all', () => {
    // `familyOf` needs the capital stamp and the research framing, and neither
    // survives into the built card. A card-only handler cannot tell a held
    // framework break from an unheld case-vs-price.
    expect(dash).toContain('renderCard(built, entry, \'lens\', assetId, panes, shell)')
  })

  it('toggles off when the same pill is tapped again', () => {
    expect(dash).toContain('const next = prev === family ? null : family')
  })
})

describe('position travels as an identity', () => {
  it('publishes the stable entry key on every slot', () => {
    expect(dash).toContain('slotKey={feedKeys[i]}')
    expect(slot).toContain('data-feed-key={slotKey}')
  })

  it('reads the anchor from the DOM rather than from an array index', () => {
    const at = dash.indexOf('const currentAnchorKey = useCallback(')
    expect(at).toBeGreaterThan(0)
    const body = dash.slice(at, dash.indexOf('}, [scroller])', at))
    expect(body).toContain('[data-feed-key]')
    expect(body).toContain('anchorKeyAt(')
  })

  it('no longer throws the reader to the top on a filter change', () => {
    /**
     * The old effect was `setCycle(0)` plus `scrollTop = 0`. That was the
     * right answer while a filter change REBUILT the feed under a reader
     * standing five screens down. It is the wrong one now: the reader taps a
     * pill ON a tile, and that tile is the subject of the gesture.
     */
    const at = dash.indexOf('const lastFilterKey = useRef(filterKey)')
    expect(at).toBeGreaterThan(0)
    const body = dash.slice(at, dash.indexOf('}, [filterKey,', at))
    expect(body).not.toContain('scrollTop = 0')
    expect(body).not.toContain('setCycle(0)')
    expect(body).toContain('scrollToKey(')
  })
})

describe('the remembered state has the lifetime of the page load', () => {
  it('uses the in-memory module and not storage', () => {
    const at = dash.indexOf('const continuityKey = useMemo(')
    expect(at).toBeGreaterThan(0)
    expect(dash).toContain("from '../../lib/mobile/feed-continuity'")
    // The filter and the anchors never reach either store. `feed-session`
    // still owns the seed, which is a different lifetime on purpose.
    expect(dash).not.toContain('sessionStorage.setItem')
    expect(dash).not.toContain('localStorage.setItem')
  })

  it('is read once at mount, which is what survives the remount', () => {
    // Returning from an asset page remounts the dashboard, so the mount-time
    // read IS the restore.
    expect(dash).toContain('useState(() => readFeedContinuity(feedScopeKey(feedScope)))')
  })

  it('is cleared by a deliberate refresh and by nothing else', () => {
    expect(dash).toContain('clearFeedContinuity(continuityKey)')
    // Exactly one call site: pull-to-refresh. A filter change clearing it
    // would discard the position it exists to protect.
    expect(dash.split('clearFeedContinuity(').length - 1).toBe(1)
  })
})
