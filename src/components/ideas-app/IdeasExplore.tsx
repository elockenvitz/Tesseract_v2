import { useState } from 'react'
import { clsx } from 'clsx'
import { Loader2, Sparkles } from 'lucide-react'
import { SignalCardView } from '../signals/SignalCardView'
import { ideaPanes } from '../signals/ideaPanes'
import { useDesktopExploreFeed } from '../../hooks/useDesktopExploreFeed'
import { IDEA_LENSES, lensSpec, lensShowsInvestmentFilters, type IdeaLens } from '../../lib/desktop-ideas/lens'
import { MATURITY_LABEL, maturityOf, type IdeaDirection, type IdeaMaturity } from '../../lib/desktop-ideas'
import type { SignalCard } from '../../lib/signals/contract'

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
const FEED_MEASURE = 'mx-auto w-full max-w-[56rem]'

const DIRECTIONS: IdeaDirection[] = ['buy', 'sell', 'add', 'trim']
const MATURITIES: IdeaMaturity[] = ['researching', 'thesis_forming', 'decision_ready', 'deciding']

export function IdeasExplore({
  onOpenCard,
}: {
  /** Stage 3 keeps selection minimal; the contextual workspace is Stage 4. */
  onOpenCard?: (card: SignalCard) => void
}) {
  const [lens, setLens] = useState<IdeaLens>('all')
  const [direction, setDirection] = useState<IdeaDirection | null>(null)
  const [maturity, setMaturity] = useState<IdeaMaturity | null>(null)

  const feed = useDesktopExploreFeed(lens)
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
      const row = e.item as unknown as { action?: string | null; stage?: string | null }
      if (direction && row.action !== direction) return false
      // `maturityOf` is the canonical stage bucket the whole desktop Ideas
      // model uses. Re-deriving it here would be the second definition.
      if (maturity && maturityOf(row.stage) !== maturity) return false
      return true
    })
    : feed.entries

  return (
    <div className="h-full overflow-y-auto">
      <div className={clsx(FEED_MEASURE, 'px-6 py-5')}>
        {/* Lens rail. Persistent, because it is the primary control. */}
        <div className="flex items-center gap-1.5 border-b border-gray-200 pb-3 dark:border-gray-700">
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
        </div>

        {/* Investment controls — Trade Ideas only. */}
        {showInvestment && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-100 py-2.5 dark:border-gray-800">
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

        {feed.isLoading && entries.length === 0 && (
          <div className="flex justify-center py-16 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}

        {!feed.isLoading && entries.length === 0 && (
          <div className="py-16 text-center">
            <Sparkles className="mx-auto h-6 w-6 text-gray-300 dark:text-gray-600" />
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{spec.emptyHint}</p>
          </div>
        )}

        <div className="space-y-4 pt-4">
          {entries.map(entry => (
            <div
              key={entry.key}
              // The card contract owns its own internal height on a phone. Here
              // it sits in normal flow at a readable measure, so the feed
              // scrolls as one column rather than as a stack of viewports.
              className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
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
                panes={ideaPanes(entry.input)}
                /*
                 * This card is in a scrolling column, not on a screen of its
                 * own. Every fixed height in the contract is a share of a
                 * phone viewport, and applying them here reserved a 264px
                 * stage for a two-word conviction pane.
                 */
                layout="flow"
                /*
                 * Stage 3 routes every card action to one place: open the item.
                 *
                 * The card contract's real action vocabulary — ask, share,
                 * promote, readthrough — is honoured by the contextual
                 * workspace in Stage 4, which is where an action has somewhere
                 * to happen. Wiring half of them now would mean writing the
                 * routing twice. `onAction` is required rather than optional
                 * precisely so a card cannot be rendered with its actions
                 * silently inert, so this is explicit rather than absent.
                 */
                onAction={(_actionId, card) => onOpenCard?.(card)}
              />
            </div>
          ))}
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
        {feed.hasNextPage && (
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
