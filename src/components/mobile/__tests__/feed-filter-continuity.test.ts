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
    const end = dash.indexOf('}, [feedBaseline,', at)
    expect(at).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(at)
    const deps = dash.slice(end, dash.indexOf('])', end))
    expect(deps).toContain('tileFamily')
    expect(deps).toContain('feedFilter')
    expect(deps).toContain('kindFilter')
  })

  it('builds the view by filtering and never by sorting', () => {
    const at = dash.indexOf('const feedEntries = useMemo(() => {')
    const body = dash.slice(at, dash.indexOf('}, [feedBaseline,', at))
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
    expect(dash).not.toContain('setKindFilter(categoryOf({ kind: trackAs })')
    /**
     * `displayFamilyOf`, updated in place.
     *
     * The claim is unchanged — the family comes from the ENTRY, not from the
     * hook that produced the row. What changed is which entry-level resolver
     * answers it, because the product decided that visible pill identity wins
     * for user-facing filtering. `familyOf` refines a capital-stamped tile to a
     * Curate row its chip never prints, so filtering on it hid a tile whose
     * chip said the identical words. See `displayFamilyOf`.
     */
    expect(dash).toContain('const family = displayFamilyOf(entry)')

    /*
      Every render site goes through the same helper.

      The literal handler was asserted here before, which held while there was
      one site and hid the fact that there were six — five of them shipping no
      handler at all, including the scenario branch that draws Case vs Price.
      The count is the claim now, and `tile-family-filter.test` presses the
      chip to prove the behaviour.
    */
    const sites = dash.split('<SignalCardSection').length - 1
    const wired = dash.split('onFilterKind={pillFilterFor(entry)}').length - 1
    expect(sites).toBeGreaterThan(1)
    expect(wired).toBe(sites)
  })

  it('threads the entry to the card so the family can be read at all', () => {
    // `displayFamilyOf` needs the research framing, which does not survive into
    // the built card. A card-only handler cannot tell the five research
    // framings apart.
    expect(dash).toContain('renderCard(built, entry, \'lens\', assetId, panes, shell)')
  })

  it('leaves a filter through one path, whichever control does it', () => {
    /*
      Clearing has to keep the BASE anchor and drop only the view anchor, or
      the reader lands wherever their tile sits in the full list rather than
      where they left. Re-tapping the active chip and the banner's Clear are
      the same gesture, so they write the same object — defined once, asserted
      once, and used by both.
    */
    expect(dash).toContain('const CLEAR_TILE_FAMILY = { family: null, position: { viewKey: null } } as const')
    expect(dash.split('CLEAR_TILE_FAMILY').length - 1).toBe(3)
    expect(dash).not.toContain('const next = prev === family ? null : family')
  })

  it('drives the active-filter band from the pill state, not the dead one', () => {
    /*
      The band was gated on `kindFilter`, which is now only ever written as
      null — so filtering by chip showed no label and offered no Clear. This
      is the line that had to move.
    */
    const at = dash.indexOf('data-testid="active-filter-banner"')
    expect(at).toBeGreaterThan(0)
    const open = dash.lastIndexOf('{(', at)
    expect(dash.slice(open, at)).toContain('tileFamily')
  })

  it('names the family in the band rather than its category', () => {
    const at = dash.indexOf('data-testid="active-filter-banner"')
    const band = dash.slice(at, at + 900)
    expect(band).toContain('familyLabel(tileFamily)')
    expect(band).toContain('clearTileFamily()')
  })

  it('lets the empty state name the family too', () => {
    const at = dash.indexOf('const activeFilterLabel = useMemo(')
    const body = dash.slice(at, dash.indexOf('}, [', at))
    expect(body).toContain('familyLabel(tileFamily)')
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

describe('the base order is a snapshot, not a recomputation', () => {
  it('re-imposes the remembered order on every recompute', () => {
    /**
     * The ranked memo is component state, so a remount recomputes it — and
     * its inputs move on their own between mounts. `rotateBySeen` is the
     * sharpest: the feed marks its top ten seen 1.5s after mount, and the next
     * mount loads that map and demotes exactly those ten. Proved end to end in
     * `feed-snapshot-continuity.test`.
     */
    const at = dash.indexOf('const feedBaseline = useMemo(')
    expect(at).toBeGreaterThan(0)
    const body = dash.slice(at, dash.indexOf('}, [baseFeedEntries, continuityKey])', at))
    expect(body).toContain('readFeedContinuity(continuityKey).baseOrder')
    expect(body).toContain('reconcileToRemembered(')
  })

  it('feeds the view from the baseline, not from the raw ranked memo', () => {
    // Reading `baseFeedEntries` here would restore the tile into a feed whose
    // surrounding order had already shifted.
    expect(dash).toContain('deriveFeedView(feedBaseline.entries,')
    expect(dash).not.toContain('deriveFeedView(baseFeedEntries,')
  })

  it('commits the order in an effect, so the memo only reads', () => {
    expect(dash).toContain('rememberBaseOrder(feedBaseline.remembered, feedBaseline.keys)')
    expect(dash).toContain('writeFeedContinuity(continuityKey, { baseOrder: next })')
  })
})

/**
 * Where composition sits in the pipeline, pinned at the source.
 *
 * The behavioural half lives in `lib/tile-engine/adopt/__tests__/feed-integration`.
 * This half pins the ORDER of the steps in the dashboard, which no unit test
 * over pure functions can see and which is the thing a future edit is most
 * likely to get wrong.
 */
describe('tile-engine composition runs before ranking and after the candidate set', () => {
  it('absorbs after allEntriesRef and before the pool is ranked', () => {
    const recorded = dash.indexOf('allEntriesRef.current = all')
    const absorbed = dash.indexOf('const afterComposition = absorbedTargets.size')
    const pooled = dash.indexOf('const pool = afterComposition.map(')
    const ranked = dash.indexOf('const ranked = rankFeed<any>(pool')

    expect(recorded).toBeGreaterThan(0)
    // Explore matches its tiles against the recorded set, so a candidate must
    // not be dropped before it.
    expect(absorbed).toBeGreaterThan(recorded)
    // And the base order is ranked over the composed set, not the raw one.
    expect(pooled).toBeGreaterThan(absorbed)
    expect(ranked).toBeGreaterThan(pooled)
  })

  it('keeps composition out of the filtered view', () => {
    const at = dash.indexOf('const feedEntries = useMemo(() => {')
    const body = dash.slice(at, dash.indexOf('}, [feedBaseline,', at))
    // A view may hide rows. It may not decide what the candidates are.
    expect(body).not.toContain('absorbedTargets')
    expect(body).not.toContain('afterComposition')
    expect(body).not.toContain('adoptTile')
  })

  it('keeps filter state out of what gets absorbed', () => {
    const at = dash.indexOf('const absorbedTargets = useMemo(')
    const deps = dash.slice(dash.indexOf('}, [', at), dash.indexOf('])', dash.indexOf('}, [', at)))
    expect(deps).not.toContain('tileFamily')
    expect(deps).not.toContain('feedFilter')
    expect(deps).not.toContain('kindFilter')
  })

  it('gives a composed tile an identity that does not name its lead', () => {
    // `composedKey` is the situation id, so a severity change that flips which
    // finding leads cannot change the tile's continuity key.
    expect(dash).toContain('composedTargetKeyByAsset')
    expect(dash).toContain('composedKey: key')
  })
})

/**
 * Every path that can clear the family clears the RECORD too.
 *
 * ── Why a state-only clear is a bug and not a cosmetic one ────────────────
 *
 * `tileFamily` is React state and the continuity record is a module-level map
 * that deliberately outlives the component — the dashboard unmounts whenever an
 * asset opens, which is the navigation the record exists to survive. A path
 * that clears the state and not the record therefore looks correct on screen
 * and restores the old family the moment the reader comes back.
 *
 * `clearTileFamily` is the one operation that does both. These assert that no
 * path reaches `setTileFamily(null)` around it.
 */
describe('every family-clearing path is continuity-aware', () => {
  it('has exactly one canonical clear, and it writes the record', () => {
    const at = dash.indexOf('const clearTileFamily = useCallback(')
    expect(at).toBeGreaterThan(0)
    const body = dash.slice(at, dash.indexOf('}, [continuityKey])', at))
    expect(body).toContain('setTileFamily')
    expect(body).toContain('writeFeedContinuity(continuityKey, CLEAR_TILE_FAMILY)')
  })

  it('routes the banner Clear, Reset and the empty state through it', () => {
    // The band's own Clear.
    expect(dash).toContain('onClick={() => { clearTileFamily(); setKindFilter(null) }}')
    // Reset, in the Curate header.
    expect(dash).toContain('onClick={() => { setFeedFilter(EMPTY_FILTER); clearTileFamily() }}')
    // The empty state's "Clear filters".
    expect(dash).toContain(
      'onClick={() => { setFeedFilter(EMPTY_FILTER); setKindFilter(null); clearTileFamily() }}')
  })

  it('clears the record on a second tap of the active pill', () => {
    const at = dash.indexOf('const toggleTileFamily = useCallback(')
    const body = dash.slice(at, dash.indexOf('}, [currentAnchorKey, continuityKey])', at))
    expect(body).toContain('CLEAR_TILE_FAMILY')
  })

  /**
   * A refresh is allowed to be stronger, and is the only one that is.
   *
   * Pull-to-refresh is the reader asking for a different feed, so it drops the
   * whole record rather than one field. That is a superset of the canonical
   * clear, not a bypass of it.
   */
  it('leaves only the deliberate refresh clearing state without the helper', () => {
    // Executable lines only: the Reset button's comment names the call it is
    // deliberately not making, and a scan that cannot tell prose from code
    // fails on its own documentation.
    const code = dash.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '')
    const bare = code.split('setTileFamily(null)').length - 1
    expect(bare).toBe(1)
    const at = code.indexOf('setTileFamily(null)')
    const around = code.slice(at - 900, at + 300)
    expect(around).toContain('clearFeedContinuity(continuityKey)')
    expect(around).toContain('handleRefresh')
  })
})

/**
 * The two identities, and which one each caller may ask.
 *
 * ── Why this is a source pin and not a unit test ──────────────────────────
 *
 * Both resolvers are pure and both are tested directly. What no unit test can
 * see is WHICH ONE each call site uses, and that is the whole of the decision:
 * a filter reaching for `familyOf` is exactly the defect this replaced, and it
 * would look completely correct in isolation.
 */
describe('user-facing filtering uses the visible family, internals keep the refined one', () => {
  it('filters and toggles on the display family', () => {
    expect(dash).toContain('deriveFeedView(feedBaseline.entries, (e: any) => displayFamilyOf(e), tileFamily)')
    expect(dash).toContain('const family = displayFamilyOf(entry)')
  })

  it('leaves composition, diversity and the overlays on the refined one', () => {
    // `composeFeed`'s diversity axis. Changing it would change feed order.
    expect(dash).toContain('familyOf: (e: any) => familyOf(e),')
    // The dev overlays report what the composer saw, so they read the same.
    expect(dash).toContain("const family = familyOf(r.item as any) ?? 'unknown'")
    expect(dash).toContain('family: familyOf(r.item as any),')
  })

  it('never resolves a user-facing filter through the refined identity', () => {
    const at = dash.indexOf('const feedEntries = useMemo(() => {')
    const view = dash.slice(at, dash.indexOf('}, [feedBaseline,', at))
    // The view may read the display family and the category. Not the refined one.
    expect(view).toContain('displayFamilyOf')
    expect(view).not.toMatch(/[^y]familyOf\(/)
  })
})
