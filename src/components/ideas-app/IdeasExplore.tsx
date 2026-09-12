import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Loader2, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { CuratePanel } from './CuratePanel'
import { EMPTY_FILTER, filterCount, type FeedFilter } from '../../hooks/mobile/useFeedFacets'
import { SignalCardView } from '../signals/SignalCardView'
import { ideaPanes } from '../signals/ideaPanes'
import { FeedPreview } from '../signals/FeedPreview'
import { previewFor, previewSymbol } from '../../lib/signals/feed-preview'
import { progressionFor } from '../../lib/desktop-ideas/progression'
import { selectionFor } from '../../lib/desktop-ideas/selection'
import { ideaRowFromFeedItem } from '../../lib/desktop-ideas/from-feed'
import type { Progression } from '../../lib/desktop-ideas/progression'
import { usePriceHistory } from '../../hooks/mobile/usePriceHistory'
import type { SignalCard } from '../../lib/signals/contract'
import { useDesktopAttentionFeed, type AttentionEntry } from '../../hooks/useDesktopAttentionFeed'
import { IDEA_LENSES, lensSpec, lensShowsInvestmentFilters, type IdeaLens } from '../../lib/desktop-ideas/lens'
import { MATURITY_LABEL, maturityOf, type IdeaDirection, type IdeaMaturity } from '../../lib/desktop-ideas'
import { usePilotOnboarding } from '../../hooks/usePilotOnboarding'

/**
 * Desktop Explore — the canonical Ideas feed, composed for a wide screen.
 *
 * ── What this is not ──────────────────────────────────────────────────────
 *
 * Not the 200-row Ideas database browser, not a masonry discovery page, and
 * not mobile's cards stretched across the viewport. It is an attention surface
 * that happens to have width, so it spends that width on scanning — a readable
 * measure for the claim, and metadata laid out horizontally where a phone has
 * to stack it.
 *
 * ── Type lens first, filters second ───────────────────────────────────────
 *
 * The lens says what KIND of thing you are looking at, and the investment
 * controls appear only inside Trade Ideas, where every row actually has a
 * direction and a maturity. Over a mixed feed those controls would mean
 * "Buy" silently deletes every thought and prompt on screen — a trade-only
 * filter redefining the candidate set with nothing saying so. Conditional
 * rendering of controls that already exist, not a filter framework.
 *
 * Switching lens refetches nothing: the feed is fetched unfiltered once and
 * narrowed client-side, so Trade Ideas is one click away and instant.
 */

/*
 * 56rem, not 46.
 *
 * Wide enough that a ladder, a chart or a metadata row has somewhere to go
 * horizontally instead of making the card taller; narrow enough that a claim
 * still reads as prose rather than a banner.
 *
 * Deliberately NOT viewport-relative. Stage 5 puts a work region beside this
 * column, and a measure defined as a share of the viewport would reflow every
 * card the moment that region opens. A fixed measure keeps the feed still
 * while something opens next to it, which is the whole point of the
 * persistent-context requirement.
 */
/*
 * 72rem, up from 56.
 *
 * 56 was chosen when the feed was a single narrative column; with an
 * analytical object able to sit BESIDE the narrative it was leaving a third of
 * a 1440px canvas empty on both sides. Capped rather than fluid so an ultrawide
 * monitor does not stretch a claim across 2000px, and the pane's own width
 * still constrains it when a workspace is open — no second measure is needed
 * for that case, which is why this is one constant and not two.
 *
 * 96rem (1536px) rather than 72: a 1760-to-1920px monitor was still being
 * asked to leave ~380px empty down each side. The cap stops mattering below
 * about 1550px, where the pane's own gutter takes over — see `IdeasApp` for
 * the 32px floor. It is the READING measure that protects prose from the extra
 * width, not this number; see `.feed-tile-prose`.
 */
const FEED_MEASURE = 'mx-auto w-full max-w-[96rem]'

const DIRECTIONS: IdeaDirection[] = ['buy', 'sell', 'add', 'trim']
const MATURITIES: IdeaMaturity[] = ['researching', 'thesis_forming', 'decision_ready', 'deciding']

export function IdeasExplore({
  onSelect, selectedKey = null, onSelectionInvalid, onProgress,
}: {
  /** The one next step this candidate can take. See `progressionFor`. */
  onProgress?: (entry: AttentionEntry, progression: Progression) => void
  /** The tile the reader picked. The app owns what happens next. */
  onSelect?: (entry: AttentionEntry) => void
  /** Which tile the open workspace belongs to, for the selected state. */
  selectedKey?: string | null
  /**
   * The open workspace's candidate is no longer eligible here.
   *
   * Fired only after the reader changes the feed's CONTEXT — lens, Curate
   * facets, or a trade-specific filter. Never on paging, reranking or a
   * refetch, because none of those is the reader asking for a different set.
   */
  onSelectionInvalid?: () => void
}) {
  const [lens, setLens] = useState<IdeaLens>('all')
  const [direction, setDirection] = useState<IdeaDirection | null>(null)
  const [maturity, setMaturity] = useState<IdeaMaturity | null>(null)
  /*
   * The APPLIED facets. Held here, above the feed, so they survive lens
   * switches, paging and the panel opening and closing — the panel keeps only
   * its own draft. Session state, like every other control on this surface;
   * nothing is persisted beyond it.
   */
  const [facets, setFacets] = useState<FeedFilter>(EMPTY_FILTER)
  const [curateOpen, setCurateOpen] = useState(false)
  const facetCount = filterCount(facets)

  const feed = useDesktopAttentionFeed(lens, { facets })
  const { markIdeasViewed } = usePilotOnboarding()
  const listRef = useRef<HTMLDivElement | null>(null)

  /**
   * What the reader has asked the feed to show.
   *
   * A string rather than a dependency list so it can be COMPARED against the
   * last reconciled value: the effect below must fire on a deliberate context
   * change and stay silent through paging, recomposition and refetches, and
   * only an explicit previous-value check can tell those apart.
   */
  const contextKey = JSON.stringify([lens, facets, direction, maturity])
  const reconciledFor = useRef(contextKey)
  const spec = lensSpec(lens)
  const showInvestment = lensShowsInvestmentFilters(lens)

  /*
   * Investment filters apply only where they mean something, and they are
   * applied here rather than in the hook so that leaving the lens does not
   * silently keep filtering. Selecting Buy, switching to All and seeing every
   * thought vanish is the exact failure the lens exists to prevent.
   */
  const entries = showInvestment
    ? feed.entries.filter(e => {
      const row = (e.item ?? {}) as unknown as { action?: string | null; stage?: string | null }
      if (direction && row.action !== direction) return false
      // `maturityOf` is the canonical stage bucket the whole desktop Ideas
      // model uses. Re-deriving it here would be the second definition.
      if (maturity && maturityOf(row.stage) !== maturity) return false
      return true
    })
    : feed.entries

  /*
   * One batched history read for the whole visible feed.
   *
   * `usePriceHistory` takes the symbol SET and returns one map behind one
   * query key, sorted and de-duplicated so a re-render that reorders the feed
   * does not look like a new query. That is the alternative to
   * `useSymbolHistory`, which is per-symbol and would be one request per
   * visible card.
   *
   * 60 closes rather than the 260 default: these lines are about sixty pixels
   * wide, so more resolution than that cannot be shown and costs round trips.
   */
  const historySymbols = useMemo(
    () => Array.from(new Set(entries.map(e => previewSymbol(e.card)).filter((x): x is string => !!x))),
    [entries],
  )
  const historyQ = usePriceHistory(historySymbols, { points: 60 })
  const history = historyQ.data

  /**
   * The last thing that moves on a cold load.
   *
   * `historySymbols` is derived FROM `entries`, so this query cannot start
   * until the feed has candidates — which means it lands after the list has
   * painted, and every sparkline tile then grows by about 128px at once. The
   * pool settle-gate upstream cannot cover it, because the request does not
   * exist until that gate opens.
   *
   * So the list waits for the first history result too. Latched, for the same
   * reason the pool gate is: a later refetch must never re-block a feed the
   * reader is already using.
   *
   * `enabled` is `wanted.length > 0`, so a feed with no sparkline candidates
   * would leave `isFetched` false forever — that case is settled by
   * definition, not by waiting.
   */
  const historySettled = historySymbols.length === 0 || historyQ.isFetched
  const historyReady = useRef(false)
  if (historySettled) historyReady.current = true
  const booting = feed.isLoading || !historyReady.current

  /*
   * The pilot has seen the real feed.
   *
   * Keyed on candidates actually being on screen, not on this component
   * mounting: the step means "you have looked at what deserves attention", and
   * a boot skeleton is not that. `markIdeasViewed` is a no-op for non-pilots
   * and dedupes its write per session, so firing it from an effect that can
   * re-run is safe by construction.
   */
  useEffect(() => {
    if (booting || entries.length === 0) return
    markIdeasViewed()
  }, [booting, entries.length, markIdeasViewed])


  /*
   * Reconcile selection, and normalise scroll, on a context change.
   *
   * Both belong to the same moment and neither belongs anywhere else:
   *
   *   selection   an open workspace whose candidate is no longer in the
   *               resulting set is incoherent — the reader switched to
   *               Thoughts and is looking at a case-versus-price gap. Closed
   *               rather than replaced: choosing a substitute on their behalf
   *               is a decision they did not make.
   *
   *   scroll      a deep offset into a substantially different result set is
   *               meaningless. Normalised to the top HERE and nowhere else —
   *               opening a workspace, paging and reranking must all leave it
   *               exactly where it is.
   *
   * Waits for the set to settle: reconciling mid-fetch would close a workspace
   * because its candidate had not arrived yet.
   *
   * Matched on `key`, the card's stable identity, not on title, array position
   * or object reference — the entry objects are rebuilt on every pass.
   */
  useEffect(() => {
    if (contextKey === reconciledFor.current) return
    if (feed.isLoading) return
    reconciledFor.current = contextKey
    listRef.current?.scrollTo({ top: 0 })
    if (selectedKey && !entries.some(e => e.key === selectedKey)) onSelectionInvalid?.()
  }, [contextKey, feed.isLoading, entries, selectedKey, onSelectionInvalid])

  return (
    /*
     * Toolbar OUTSIDE the scroller, list inside it.
     *
     * The lens rail and Curate were children of the `overflow-y-auto` element,
     * so they scrolled away with the tiles. Chosen over `position: sticky`
     * because it needs no z-index, cannot overlap, and leaves the Curate
     * popover anchored in a non-scrolling context — sticky would have put the
     * popover's `relative` ancestor inside the scrollport it is meant to sit
     * above.
     *
     * The measure is applied to both halves so the toolbar stays aligned with
     * the cards under it.
     */
    <div className="flex h-full flex-col">
      {/* `relative z-20` only so the Curate popover paints above the list; the
          app header is z-30 and above, so nothing is covered that matters. */}
      <div className={clsx(FEED_MEASURE, 'relative z-20 shrink-0 border-b border-gray-200 bg-white px-6 pt-5 dark:border-gray-700 dark:bg-gray-900')}>
        {/* Lens rail. Persistent, because it is the primary control. */}
        <div className="flex items-center gap-1.5 pb-3">
          {IDEA_LENSES.map(l => (
            <button
              key={l.key}
              onClick={() => {
                setLens(l.key)
                // Leaving Trade Ideas drops its filters with it. They are not
                // meaningful anywhere else and must not keep applying unseen.
                if (l.key !== 'trade_ideas') { setDirection(null); setMaturity(null) }
              }}
              className={clsx(
                'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                lens === l.key
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
              )}
            >
              {l.label}
            </button>
          ))}

          {/*
            Curate: the deep faceted filter, beside the quick lenses but
            deliberately not one of them.

            A lens is one tap and one dimension — "show me thoughts". Curate is
            kinds, signal types, sectors, countries, exchanges and tickers,
            multi-select within a facet and intersected across them. The chip
            answers "more like this"; Curate is how you say "European
            industrials, news and decisions only", which no chip can express.

            Separated by a divider and given an outline rather than a pill, so
            it reads as a control that OPENS something rather than a fifth
            lens. Disabled until the desktop facet panel exists — the facet
            data comes from `useFeedFacets`, which is shared, but the panel is
            its own piece of work and a button that silently does nothing is
            worse than one that says it is not ready.
          */}
          <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" aria-hidden />
          <div className="relative">
            <button
              type="button"
              onClick={() => setCurateOpen(o => !o)}
              aria-expanded={curateOpen}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors',
                facetCount > 0
                  ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800',
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Curate
              {/* The count is the whole active-state indication. A row of chips
                  per selected value would fill the header on the first real
                  filter, which is the thing to avoid. */}
              {facetCount > 0 && (
                <span className="rounded-full bg-primary-600 px-1.5 text-[10px] font-bold text-white">
                  {facetCount}
                </span>
              )}
            </button>
            <CuratePanel
              open={curateOpen}
              value={facets}
              onApply={setFacets}
              onClose={() => setCurateOpen(false)}
            />
          </div>
          {facetCount > 0 && (
            <button
              onClick={() => setFacets(EMPTY_FILTER)}
              title="Clear Curate filters"
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        {/* Investment controls — Trade Ideas only. */}
        {showInvestment && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 py-2.5 dark:border-gray-800">
            <FilterRow
              label="Direction"
              options={DIRECTIONS.map(d => ({ key: d, label: d }))}
              value={direction}
              onChange={v => setDirection(v as IdeaDirection | null)}
            />
            <FilterRow
              label="Maturity"
              options={MATURITIES.map(m => ({ key: m, label: MATURITY_LABEL[m] }))}
              value={maturity}
              onChange={v => setMaturity(v as IdeaMaturity | null)}
            />
          </div>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className={clsx(FEED_MEASURE, 'px-6 pb-5')}>
        {/* While booting the list is hidden, so the spinner must not depend on
            entries being empty — the pool can be settled while history is not,
            and that window would otherwise show a blank column. */}
        {booting && (
          <div className="flex justify-center py-16 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}

        {/* A genuine failure is distinguishable from an empty feed, and
            recoverable without a page reload. */}
        {!booting && feed.isError && entries.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              The feed could not be loaded.
            </p>
            <button
              onClick={feed.retry}
              className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Try again
            </button>
          </div>
        )}

        {!booting && !feed.isError && entries.length === 0 && (
          <div className="py-16 text-center">
            <Sparkles className="mx-auto h-6 w-6 text-gray-300 dark:text-gray-600" />
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {facetCount > 0
                ? 'Nothing matches these Curate filters.'
                : spec.emptyHint}
            </p>
            {facetCount > 0 && (
              <button
                onClick={() => setFacets(EMPTY_FILTER)}
                className="mt-2 text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        <div className={clsx('space-y-4 pt-4', booting && 'hidden')}>
          {entries.map(entry => {
            const sym = previewSymbol(entry.card)
            /* Dated closes: the desktop chart reads out the date under the
               cursor, which bare numbers cannot answer. */
            const preview = previewFor(
              entry.family, entry.card, entry.source,
              sym ? history?.get(sym) : undefined,
            )
            return (
            <div
              key={entry.key}
              // The card contract owns its own internal height on a phone. Here
              // it sits in normal flow at a readable measure, so the feed
              // scrolls as one column rather than as a stack of viewports.
              /*
               * Selection is the BACKGROUND's job, not the card's.
               *
               * The tile contains its own controls — carousel pager, ladder
               * markers, the disclosure toggle — and every one of them is a
               * reversible preview interaction that must act locally. Paging
               * the carousel and finding the workspace had swapped underneath
               * is the defect this guards.
               *
               * The test is whether the click originated on a CONTROL, not
               * whether it originated on the tile's own box — requiring the
               * latter would leave only the border clickable, since the card
               * fills the tile. So a click passing through prose, a metric or
               * the card's chrome selects; a click on a button, link, input or
               * anything with a button role is that control's and stops here.
               *
               * Card actions still open the workspace, explicitly, via
               * `onAction` — they are meant to.
               */
              onClick={e => {
                /*
                 * The match must be a DESCENDANT, not the tile itself.
                 *
                 * The tile carries `role="button"` for keyboard semantics, so
                 * `closest()` walking up from the target matched the tile root
                 * on every click — including clicks on prose — and every one
                 * of them looked like a nested-control press. That is the
                 * regression: the guard was catching its own container.
                 */
                const root = e.currentTarget as HTMLElement
                const hit = (e.target as HTMLElement)
                  .closest('button, a, input, select, textarea, [role="button"], [role="tab"]')
                if (hit && hit !== root && root.contains(hit)) return
                onSelect?.(entry)
              }}
              /* Keyboard parity: the tile is reachable and Enter opens it. */
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(entry) }
              }}
              className={clsx(
                /* With no Open button, hover and focus are what say the tile is
                   clickable at all. */
                'feed-tile cursor-pointer overflow-hidden rounded-xl border bg-white shadow-sm transition-all hover:shadow-md hover:border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-gray-800 dark:hover:border-gray-600',
                // Restrained: a ring, not a fill. The card's own severity rail
                // already uses colour, and a selected state that competes with
                // it would make every list look alarming.
                selectedKey === entry.key
                  ? 'border-primary-400 ring-1 ring-primary-400 dark:border-primary-500 dark:ring-primary-500'
                  : 'border-gray-200 dark:border-gray-700',
              )}
            >
              {selectedKey === entry.key ? (
                <SelectedSummary card={entry.card} />
              ) : (
              <div
                /* `feed-tile-prose` caps the READING measure when there is no
                   analytical object to share the tile with. Without it a
                   thought on a 1920px canvas is a single 1400px line. Keyed on
                   the preview seam that already exists, not on family. */
                className={clsx('feed-tile-cols', !preview && 'feed-tile-prose')}
              >
              <SignalCardView
                card={entry.card}
                /*
                 * The interactive half of the card.
                 *
                 * Passing only `card` rendered the typographic half of a
                 * contract that also takes panes — which is why the desktop
                 * feed read as flat text while the phone's reads as something
                 * you can turn over. Same renderer, same primitives; the
                 * assembly was simply never done on this side.
                 */
                /*
                 * Panes follow the shared plan. A machine-derived card has no
                 * post body, so it gets none and renders as the typography it
                 * is — which is correct, not a gap.
                 */
                panes={ideaPanes(entry.card)}
                /*
                 * This card is in a scrolling column, not on a screen of its
                 * own. Every fixed height in the contract is a share of a
                 * phone viewport, and applying them here reserved a 264px
                 * stage for a two-word conviction pane.
                 */
                layout="flow"
                /*
                 * The preview is NOT a card prop. It renders as the card's
                 * sibling so a wide tile can put it BESIDE the narrative
                 * instead of underneath it. Threading it back through the card
                 * would mean restructuring the card's internal flex column,
                 * which is the geometry the phone suite guards — and this
                 * composition is desktop-only.
                 */
                /*
                 * Every card action opens the workspace, which is where an
                 * action has somewhere to happen. `onAction` is required
                 * rather than optional precisely so a card cannot render with
                 * its actions silently inert.
                 */
                onAction={() => onSelect?.(entry)}
              />
              {/*
                The analytical object. Beside the narrative once the TILE is
                wide enough — see `.feed-tile-cols` — and stacked beneath it
                otherwise, which is what keeps a 30rem pane from squeezing a
                chart next to a claim.

                Text-led candidates produce no preview and render nothing here,
                so they get no empty right column.
              */}
              {preview && (
                <div className="feed-tile-aside border-t border-gray-100 px-4 py-3 dark:border-gray-800">
                  <FeedPreview preview={preview} />
                </div>
              )}
              </div>
              )}
              {selectedKey !== entry.key && (() => {
                /*
                 * One compact progression control, and only where the
                 * destination differs from what the tile already does.
                 * `progressionFor` returns null otherwise — machine findings,
                 * promoted thoughts, closed prompts — and nothing renders.
                 */
                const p = progressionFor(
                  selectionFor(entry),
                  { idea: entry.item ? ideaRowFromFeedItem(entry.item) : null },
                )
                if (!p) return null
                return (
                  <div className="flex justify-end border-t border-gray-100 px-4 py-2 dark:border-gray-800">
                    <button
                      type="button"
                      /* A nested control: the tile's guard sees a `button`
                         descendant and leaves selection alone. */
                      onClick={() => onProgress?.(entry, p)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      {p.label}
                    </button>
                  </div>
                )
              })()}
            </div>
            )
          })}
        </div>

        {/*
         * Explicit continuation rather than intersection loading.
         *
         * The feed lives inside a workspace whose right region is about to
         * start opening and closing over it (Stage 4). An observer that fires
         * on layout change would page the feed as a side effect of opening an
         * item, which is exactly the "feed reset while I was reading" defect
         * the context requirement forbids. A button pages when the reader asks.
         */}
        {/* Outside the hidden list, so it needs the boot gate of its own —
            otherwise the continuation control sits under a spinner offering to
            page a feed that has not arrived. */}
        {!booting && feed.hasNextPage && (
          <button
            onClick={feed.fetchNextPage}
            disabled={feed.isFetchingNextPage}
            className="mt-4 w-full rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {feed.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </button>
        )}
      </div>
      </div>
    </div>
  )
}

/**
 * The selected tile, collapsed.
 *
 * ── Why it collapses at all ───────────────────────────────────────────────
 *
 * Its full workspace is open two inches to the right. Leaving the carousel,
 * the ladder and the action row on the tile would put two independently
 * interactive copies of the same object on screen, which is the thing the
 * tile/workspace division exists to prevent — and the second copy is the one
 * with less room.
 *
 * ── What survives ─────────────────────────────────────────────────────────
 *
 * Everything needed to remember WHY this row is the one open: the family, the
 * headline, the number the claim turns on, and the provenance line. Nothing
 * that would duplicate the workspace.
 *
 * ── Only this tile ────────────────────────────────────────────────────────
 *
 * Every other tile keeps its full preview. A reader must still be able to scan
 * past the open item to something more interesting and switch to it, which is
 * the whole point of a persistent feed; reducing the list to text rows because
 * a workspace happens to be open would defeat it.
 *
 * ── Height ────────────────────────────────────────────────────────────────
 *
 * `min-h` matches the collapsed card's natural height rather than the full
 * one, and the transition is a swap rather than an animated collapse. A tile
 * shrinking under the cursor is what moves everything below it; a swap changes
 * one row's height once, at the moment of a deliberate click, which is when a
 * reader expects the layout to respond.
 */
function SelectedSummary({ card }: { card: SignalCard }) {
  return (
    <div className="flex min-h-[5.5rem] items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          <span>{card.surface}</span>
          {card.entity?.ticker && (
            <>
              <span aria-hidden>·</span>
              <span className="text-gray-600 dark:text-gray-300">{card.entity.ticker}</span>
            </>
          )}
        </div>
        <p className="mt-1 text-sm font-semibold leading-snug text-gray-900 dark:text-white">
          {card.headline}
        </p>
        {card.provenance?.reason && (
          <p className="mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
            {card.provenance.reason}
          </p>
        )}
      </div>
      {card.metric && (
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">
            {card.metric.value}
          </p>
          {card.metric.label && (
            <p className="text-[10px] uppercase tracking-wide text-gray-400">{card.metric.label}</p>
          )}
        </div>
      )}
      <span className="mt-0.5 shrink-0 rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
        Open
      </span>
    </div>
  )
}

function FilterRow({
  label, options, value, onChange,
}: {
  label: string
  options: { key: string; label: string }[]
  value: string | null
  onChange: (v: string | null) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(value === o.key ? null : o.key)}
          className={clsx(
            'rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors',
            value === o.key
              ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
