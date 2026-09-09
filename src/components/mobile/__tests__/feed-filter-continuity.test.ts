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
     * `tileFamilyOf`, updated in place.
     *
     * The claim is unchanged: the family comes from the ENTRY, not from the
     * hook that produced the row. `tileFamilyOf` is the component's own
     * resolver — `displayFamilyOf` for every kind but one, plus the
     * recommendation lookup only this scope can perform. A trade-queue
     * attention item becomes a recommendation card only when that map holds
     * one; without it the chip reads "Needs review" while the pure resolver
     * said `recommendation`, so the band named a family the tile never printed.
     */
    expect(dash).toContain('const family = tileFamilyOf(entry)')

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
      null — so filtering by chip showed no label and offered no Clear.

      It has since moved INTO the mode bar, beside Curate and Reset, because a
      full-width row in inverted colours cost a tile's worth of height on a
      390px screen to say one word. Same role, same test id, one row instead of
      two — so this asserts the gate and the placement rather than scanning
      backwards for the nearest `{(`, which now finds an unrelated handler.
    */
    // The LAST occurrence: the comment above the markup names the test id too.
    const at = dash.lastIndexOf('data-testid="active-filter-banner"')
    expect(at).toBeGreaterThan(0)
    const gate = dash.lastIndexOf('{(tileFamily || kindFilter) && (', at)
    expect(gate).toBeGreaterThan(0)
    expect(at - gate).toBeLessThan(600)
    // Inside the control strip, not in a band of its own.
    const bar = dash.lastIndexOf('MODE_BAR.BAR', at)
    expect(bar).toBeGreaterThan(0)
    expect(bar).toBeLessThan(gate)
  })

  it('names the family in the band rather than its category', () => {
    const at = dash.lastIndexOf('data-testid="active-filter-banner"')
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
    expect(dash).toContain('rememberBaseOrder(')
    expect(dash).toContain('writeFeedContinuity(continuityKey, { baseOrder: next })')
  })

  /**
   * And it commits the READ PREFIX, not the whole order.
   *
   * Remembering every key froze the part of the feed nobody had seen, which
   * meant anything arriving later could only be appended — a page of posts
   * fetched at the bottom of a long scroll landed after every tile rather than
   * interleaving into the stretch about to be reached. Only what the reader
   * has passed, plus a screen, has to hold still.
   */
  it('freezes only what the reader has passed', () => {
    const at = dash.indexOf('const next = rememberBaseOrder(')
    expect(at).toBeGreaterThan(0)
    const call = dash.slice(at, at + 200)
    expect(call).toContain('feedBaseline.keys.slice(0, frozen)')
    expect(dash).toContain('FREEZE_LOOKAHEAD')
    expect(dash).toContain('readFeedContinuity(continuityKey).readDepth')
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
    expect(dash).toContain('deriveFeedView(feedBaseline.entries, (e: any) => tileFamilyOf(e), tileFamily)')
    expect(dash).toContain('const family = tileFamilyOf(entry)')
    // And `tileFamilyOf` defers to the pure resolver for every other kind.
    expect(dash).toContain('return displayFamilyOf(entry)')
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

/**
 * The duplicate suppression sits where the absorption does, and for one reason.
 *
 * Both remove a candidate for a semantic reason, and both must run after
 * `allEntriesRef` — which Explore matches its tiles against — and before the
 * pool is ranked. A drop before that record makes a tapped Explore tile
 * unmatchable; a drop after ranking makes clearing a filter restore an order
 * the base never had.
 */
describe('the Research card wins over the attention copy, in the right place', () => {
  it('suppresses the duplicate after the candidate set and before the pool', () => {
    const recorded = dash.indexOf('allEntriesRef.current = all')
    const deduped = dash.indexOf('const afterDuplicates = suppressCoveredAttention(all, researchedAssets)')
    const composed = dash.indexOf('const afterComposition = absorbedTargets.size')
    const pooled = dash.indexOf('const pool = afterComposition.map(')

    expect(deduped).toBeGreaterThan(recorded)
    expect(composed).toBeGreaterThan(deduped)
    expect(pooled).toBeGreaterThan(composed)
  })

  it('composes over the deduplicated set, not the raw one', () => {
    // Both branches of the absorption ternary read `afterDuplicates`, so the
    // dropped row cannot come back when no target pair is absorbed.
    const at = dash.indexOf('const afterComposition = absorbedTargets.size')
    const body = dash.slice(at, dash.indexOf('const pool = afterComposition.map(', at))
    expect(body).toContain('? afterDuplicates')
    expect(body).toContain(': afterDuplicates')
  })

  /**
   * The set is a semantic set, not every asset with research on it.
   *
   * It was `derivedInsights.map(i => i.assetId)` — every asset carrying any
   * Research card — so a name with a price-move card lost its coverage tile
   * too. Two different reader questions, one silently deleted for sharing a
   * ticker. `coverageDuplicateAssets` narrows it to the one framing that makes
   * the same claim; the predicate itself is pinned in `coverage-gap.test`.
   */
  it('suppresses on the same question rather than on the same asset', () => {
    expect(dash).toContain('coverageDuplicateAssets(derivedInsights)')
    expect(dash).not.toContain('derivedInsights.map(i => i.assetId)')
  })
})

describe('the coverage card renders through the engine for everybody', () => {
  /**
   * Manual QA: "I can see a Coverage Gap tile, but the card still says
   * Research stale and shows a price chart."
   *
   * Both halves of that are one cause. Coverage Gap's IDENTITY shipped
   * unflagged — the chip, the pill, the category, the dedupe rule — while its
   * PRESENTATION stayed behind the comparison flag. So the flagged-off state
   * was not the old behaviour; it was a tile that calls itself a coverage
   * finding and then reads like the legacy attention row underneath.
   */
  it('adopts the coverage row whether or not the comparison flag is on', () => {
    const at = dash.indexOf('const adoptTile = useCallback(')
    expect(at).toBeGreaterThan(0)
    const body = dash.slice(at, dash.indexOf('const rankInputFor = useCallback(', at))
    expect(body).toContain("'coverage' in source || 'overdue' in source")
    expect(body).toContain('if (!tileEngineOn && !flagless) return declinedTile(original)')
  })

  /**
   * The tape is dropped by a general rule, not a per-family one.
   *
   * When the resolver has chosen a lead visual, that visual IS the evidence,
   * and a price series stapled underneath contradicts the choice the plan just
   * made. Coverage and Overdue both reach it, and so will the next family whose
   * claim is not about the price.
   */
  it('drops the price pane wherever the engine took the row on', () => {
    expect(dash).toContain("const attnPrice = attnAdopted?.adopted ? null : pricePane(")
  })

  /** The other four families are still behind it. */
  it('leaves every other adoption behind the flag', () => {
    expect(dash).toContain('const tileEngineOn = isFlagOn(')
    const at = dash.indexOf('const adoptTile = useCallback(')
    const body = dash.slice(at, dash.indexOf('const rankInputFor = useCallback(', at))
    expect(body).toContain('tileEngineOn')
  })
})

describe('the base order is committed from a complete feed', () => {
  /**
   * QA on localhost: nine posts, then three Overdue. Impossible from one
   * composed list — attention outranks posts — and exactly what an order
   * remembered from a partial pool produces, because everything that lands
   * afterwards is appended behind it.
   *
   * The effect runs on every render including the ones behind the loader, so
   * an early return in the render body does not stop it.
   */
  it('waits for the ordering-critical sources before remembering an order', () => {
    const at = dash.indexOf('const next = rememberBaseOrder(')
    expect(at).toBeGreaterThan(0)
    const body = dash.slice(dash.lastIndexOf('useEffect(() => {', at), at)
    expect(body).toContain('if (composing) return')
  })

  /** And the gate is the same signal that holds the loader up. */
  it('uses the loader gate rather than a second idea of readiness', () => {
    expect(dash).toContain('const composing =')
    expect(dash.match(/const composing =/g)).toHaveLength(1)
    const decl = dash.indexOf('const composing =')
    const effect = dash.indexOf('const next = rememberBaseOrder(')
    const loader = dash.indexOf('if (composing) {')
    expect(decl).toBeLessThan(effect)
    expect(decl).toBeLessThan(loader)
  })

  /**
   * The briefing axis reaches the production composer.
   *
   * Keyed on `composeFeed(input, {` rather than `composeFeed(ordered, {`: the
   * call moved inside `composeRound`, which takes the ranked list as an
   * argument so the endless feed can compose a rotation of it per round. The
   * assertion is about what the call passes, and that is unchanged.
   */
  it('passes the brief lane to the composer', () => {
    const at = dash.indexOf('composeFeed(input, {')
    expect(at).toBeGreaterThan(0)
    const call = dash.slice(at, dash.indexOf('})', dash.indexOf('scope,', at)))
    expect(call).toContain('briefOf:')
    expect(call).toContain('briefClassFor(')
  })

  /**
   * And the round mechanism is the whole pool rather than one source.
   *
   * The derived insights used to be the only thing that repeated when the
   * server ran out, so "endless" meant an endless stream of research prompts.
   * If `insightEntries` grows a length-by-cycle again, that regression is back.
   */
  it('repeats the whole feed rather than one source', () => {
    expect(dash).toContain('rotateForRound(ordered, round)')
    const at = dash.indexOf('const insightEntries =')
    expect(at).toBeGreaterThan(0)
    expect(dash.slice(at, at + 200)).not.toContain('cycle + 1')
  })
})

describe('the plan owns the picture on every adopted family', () => {
  /**
   * The seam, once, for all of them.
   *
   * `planPane` renders whatever primitive the plan named through the switch
   * Explore already owns. A hand-written pane that led an adopted card would be
   * the caller overruling the resolver, which is the defect this whole seam
   * closes — so the assertion is that every adoption site consults it.
   */
  it('renders the plan visual through one shared seam', () => {
    expect(dash).toContain('const planPane = useCallback((visual: ExploreVisual | null)')
    expect(dash).toContain('<ExploreVisualBlock visual={visual} />')
  })

  it('leads the attention families with it', () => {
    expect(dash).toContain('const attnPlanPane = planPane(attnAdopted?.visual ?? null)')
  })

  it('leads Target Hit with it, ahead of the tape', () => {
    expect(dash).toContain('const lensPlanPane = planPane(lensAdopted?.visual ?? null)')
    const at = dash.indexOf('if (lensPlanPane) panes.push(lensPlanPane)')
    const priced = dash.indexOf('const priced = pricePane(symbol, { bands: priceBands')
    expect(at).toBeGreaterThan(0)
    expect(priced).toBeGreaterThan(at)
  })

  it('leads Unreviewed Move with it, ahead of the producer own order', () => {
    expect(dash).toContain('const insightPlanPane = planPane(insightAdopted?.visual ?? null)')
    const at = dash.indexOf('...(insightPlanPane ? [insightPlanPane] : []),')
    const producerOrder = dash.indexOf('...insightPanePlan({')
    expect(at).toBeGreaterThan(0)
    expect(producerOrder).toBeGreaterThan(at)
  })

  /**
   * The producer's pane plan is untouched.
   *
   * It is the geometry contract the gallery measures, and threading an engine
   * pane through it would make a card's reserved height depend on whether its
   * situation had been adopted yet.
   */
  it('does not thread the engine pane through the producer geometry plan', () => {
    expect(dash).not.toContain("id === 'visual'")
  })
})

describe('coming back to Ideas lands where the reader left', () => {
  /** The restore effect, from its guard to the end of its dependency list. */
  function restoreBody(): string {
    const at = dash.indexOf('const continuityRestoredRef = useRef(false)')
    expect(at).toBeGreaterThan(0)
    return dash.slice(at, dash.indexOf('// A deliberate refresh', at))
  }

  /**
   * The defect: it acted on the first measurement it could take.
   *
   * A tab switch unmounts the dashboard, so returning is a remount and this
   * effect is the restore. It fired on the first commit that had entries, and
   * at that moment the feed has not laid out — `FeedSlot` keeps about five
   * cards mounted and the rest are placeholders — so a tile twenty down
   * measures a few hundred pixels instead of several thousand. The jump
   * "succeeded" near the top and latched.
   */
  it('re-measures across frames instead of jumping once', () => {
    const body = restoreBody()
    expect(body).toContain('requestAnimationFrame(attempt)')
    expect(body).toContain('cancelAnimationFrame(raf)')
    // Stops when the offset stops moving, not when it first exists.
    expect(body).toContain('if (top === last || tries++ > SETTLE_FRAMES)')
  })

  /**
   * And it disabled the one restore that already knew to keep trying.
   *
   * `restoredRef` switches off the saved-offset restore, whose own header
   * records this exact failure and solves it with a retry loop. Setting it
   * before there was a position meant the weaker restore won the race and then
   * did nothing.
   */
  it('only takes over the offset restore once it has a position', () => {
    const body = restoreBody()
    const marks = body.indexOf('restoredRef.current = true')
    const measures = body.indexOf('const top = offsetOfKey(key)')
    expect(measures).toBeGreaterThan(0)
    expect(marks).toBeGreaterThan(measures)
  })

  /** A tile that went missing is not a reason to go to the top. */
  it('falls back to the nearest tile in the order the reader left', () => {
    expect(restoreBody()).toContain('nearestRememberedKey(restoredContinuity.baseOrder')
  })
})

describe('attention urgency is read from the field the row has', () => {
  /**
   * The defect: `rankInputFor` read `a.priority`, which `AttentionItem` does
   * not define, so every attention item in the feed ranked `informational`.
   * The mapping now lives beside the other attention resolvers, where the
   * ranker and the chip cannot come to disagree about the same row.
   */
  it('ranks attention severity through the shared resolver', () => {
    const at = dash.indexOf("case 'attention': {")
    expect(at).toBeGreaterThan(0)
    const branch = dash.slice(at, dash.indexOf('}, a.context?.asset_id)', at))
    expect(branch).toContain('severity: attentionRankSeverity(a)')
  })

  /**
   * The comparison, not the word.
   *
   * The branch still NAMES `a.priority` — in the comment recording what it used
   * to read and why that was empty. What must not come back is the comparison.
   */
  it('compares against the phantom field nowhere in the file', () => {
    expect(dash).not.toContain('a.priority ===')
  })
})
