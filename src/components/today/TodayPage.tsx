/**
 * Today — the production surface.
 *
 * Real evaluator output, ranked tier-first, composed editorially: one featured
 * item, then the supporting priorities, then a quiet proof of selectivity.
 *
 * What this page deliberately is not: a dashboard of everything that happened.
 * The engine routinely produces more findings than a person should be asked to
 * look at, so the page shows four and reports the rest as evaluated — because
 * "these are the few things most worth your attention" is only credible if the
 * surface also says what it decided not to show.
 */

import { useMemo } from 'react'
import { clsx } from 'clsx'
import { CheckCircle2 } from 'lucide-react'
import { useDecisionEngine } from '../../engine/decisionEngine'
import { dispatchDecisionAction } from '../../engine/decisionEngine/dispatchDecisionAction'
import {
  openDashboardFocus, TODAY_FOCUS_ACTIONS, type RailCard,
} from '../../lib/dashboard/focus'
import { useAttentionState } from '../../hooks/useAttentionState'
import { feedItemAttentionKey } from '../../lib/attention-state'
import {
  adaptDecisionItem, selectToday, expandToObjects, diversify, applyEnrichment,
  compareTodayItems, TODAY_LIMIT,
} from '../../lib/today'
import { useTodayEnrichment } from '../../hooks/useTodayEnrichment'
import type { TodayItem, AggregateNote } from '../../lib/today'
import type { FocusSource } from '../../lib/dashboard/focus'
import { TodayTile } from './TodayTile'

export function TodayPage() {
  const { selectForDashboard, isLoading } = useDecisionEngine()
  const attention = useAttentionState()

  const engineSlice = selectForDashboard()

  /**
   * Adapt, suppress, rank.
   *
   * Suppression is applied BEFORE the cut, not after: a dismissed item must
   * not consume one of the four slots and leave the surface looking thinner
   * than it is.
   */
  const { surfaced, alsoWatching, evaluated, suppressedCount, aggregates } = useMemo(() => {
    // Expand BEFORE ranking and before the cut.
    //
    // postprocess.ts collapses repetitive findings into synthetic parents
    // ("7 theses may be stale") carrying an empty context, a batch CTA and
    // count-shaped chips. Those parents are right for a queue summary and
    // wrong for a surface whose unit is one object, one issue, one action --
    // and their inflated score (maxScore + count*10) would win slots from the
    // very objects they describe. The rollup stays intact for every other
    // consumer; Today just unwraps for itself.
    const expanded = expandToObjects([...engineSlice.action, ...engineSlice.intel])
    const all = expanded.items.map(adaptDecisionItem)

    const visible: TodayItem[] = []
    let suppressed = 0
    for (const item of all) {
      const key = feedItemAttentionKey(item.id)
      if (key && attention.suppressedKeys.has(key)) { suppressed++; continue }
      visible.push(item)
    }

    // Rank, then diversify, then cut.
    //
    // Diversity runs on the RANKED list and never moves #1, so the lead is
    // still the highest-priority finding. It only prevents the remaining
    // slots from being saturated by one evaluator when a materially
    // comparable alternative exists -- the four-stale-theses result.
    const ranked = [...visible].sort(compareTodayItems)
    const arranged = diversify(ranked, TODAY_LIMIT)

    return {
      surfaced: arranged.slice(0, TODAY_LIMIT),
      alsoWatching: arranged.slice(TODAY_LIMIT),
      evaluated: arranged.length,
      suppressedCount: suppressed,
      aggregates: expanded.aggregates,
    }
  }, [engineSlice.action, engineSlice.intel, attention.suppressedKeys])

  // Enrich ONLY what surfaced. Also-watching draws nothing, so it fetches
  // nothing -- four symbols of history rather than the whole candidate pool.
  const enrichment = useTodayEnrichment(surfaced)
  const enriched = useMemo(
    () => surfaced.map(i => applyEnrichment(i, enrichment[i.source.context.assetId ?? ''])),
    [surfaced, enrichment],
  )

  const handlePrimary = (item: TodayItem, source?: FocusSource) => {
    if (!item.primary) return
    const payload = {
      ...item.source.context,
      ...(item.primary.payload ?? {}),
      // The reason this surfaced travels with the hand-off, so the canonical
      // workspace can say why the user was sent rather than making them
      // rediscover it.
      issue: item.state,
    }

    /*
      A Dashboard action stays in the Dashboard.

      This used to build a tab descriptor and dispatch it on the shell's
      channel, so "Review thesis" left the Dashboard and opened a second
      surface. A Dashboard action is not navigation: it names an issue, and
      the shell enters Focus Mode on the lens that owns it, in this tab.

      Only the keys in TODAY_FOCUS_ACTIONS are Dashboard issues. Everything
      else on a Today card -- raising an idea, opening a simulation, filtering
      the trade queue -- is operational work the deep product owns and still
      goes through the shared dispatcher untouched. That dispatcher also serves
      the Asset page, the old Dashboard and the Action Center, so it is read
      here and never modified.
    */
    const workspaceLens = TODAY_FOCUS_ACTIONS[item.primary.actionKey]
    if (workspaceLens && payload.assetId) {
      openDashboardFocus({
        target: {
          // Where Back goes, and it is NOT where the workspace comes from.
          // A stale thesis is answered by a research-shaped workspace, but
          // the reader came from Today and returns to Today.
          originLens: 'today',
          workspaceLens,
          objectType: 'asset',
          objectId: payload.assetId as string,
          symbol: item.ticker,
          label: item.objectLabel,
          issue: item.state,
          origin: 'today',
          /*
           * Which tile this came out of, and how it was presented.
           *
           * Carried rather than inferred: the workspace could otherwise only
           * find its source by matching on ticker or heading text, and two
           * findings about one name would then resolve to the same tile. The
           * shell does not animate with this yet — it exists so that when a
           * shared-element transition is built it has a real handle and real
           * geometry to start from.
           */
          source: source ?? null,
        },
        backLabel: 'Today',
        // The rest of this morning's work, in Today's own ranking, built from
        // what is already on screen. No second scan to draw a rail.
        // The whole of this morning's work, in Today's own ranking.
        rail: enriched.map(toRailCard),
      })
      return
    }

    dispatchDecisionAction(item.primary.actionKey, payload)
  }

/**
 * A Today item as a rail card.
 *
 * Today's own vocabulary: the state that surfaced it, the metric the tile was
 * already showing, and the one-line claim. Not a re-derivation -- whatever
 * Today decided is worth saying is what the rail says.
 */
function toRailCard(item: TodayItem): RailCard {
  const lead = item.metrics[0]
  return {
    // The rail is keyed on the object the workspace will open, which is the
    // asset -- `item.id` is an engine finding id and would not resolve.
    id: (item.target?.assetId ?? item.source?.context?.assetId ?? item.id) as string,
    // A Today card is answered by whichever workspace fits its issue; today
    // that is the research one for every focusable action key.
    workspaceLens: 'research',
    objectType: 'asset',
    symbol: item.ticker,
    reason: item.state,
    tone: item.severity === 'red' ? 'critical'
      : item.severity === 'orange' || item.severity === 'yellow' ? 'review'
      : 'neutral',
    figure: lead?.value ?? null,
    figureLabel: lead?.label ?? null,
    // Today already computed a second metric for the tile; the rail reuses it
    // rather than deriving anything of its own.
    secondary: item.metrics[1]
      ? { value: item.metrics[1].value, label: item.metrics[1].label }
      : null,
    detail: item.claim,
    issue: item.state,
  }
}

  const handleDismiss = (item: TodayItem) => {
    const key = feedItemAttentionKey(item.id)
    if (key) attention.dismissForMe(key)
  }

  const handleSnooze = (item: TodayItem, hours: number) => {
    const key = feedItemAttentionKey(item.id)
    if (key) attention.snoozeForMe(key, hours)
  }

  const [featured, ...supporting] = enriched

  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 pb-12 dark:bg-[#0b0f16]">{/* Layout gives full-width tabs `overflow-hidden` on an h-full box, so a
          full-width surface must own its own scrolling. min-h-full clipped
          everything past the fold with no way to reach it. */}
      {/*
        One header line, not four.

        This was a 21px title, a two-line blurb restating the tab's own name, a
        separate count line, and then a "Start here" rule above a single card
        that already wears a #1 pill. Measured at 1920 that stack put the first
        piece of investment content 208px down -- 19.3% of a 1080px fold spent
        before the reader sees a ticker, on a surface whose whole claim is that
        it shows the few things that matter.

        The title and what the page found now share one baseline. The blurb is
        gone: it said what the tab's own name says, on every load.
      */}
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6 pt-5">
        <h1 className="text-[19px] font-semibold tracking-tight text-gray-900 dark:text-gray-50">
          Today
        </h1>
        <Summary
          isLoading={isLoading}
          surfaced={enriched.length}
          evaluated={evaluated}
          suppressed={suppressedCount}
        />
      </header>

      {isLoading ? (
        <Loading />
      ) : enriched.length === 0 ? (
        <Cleared evaluated={evaluated} suppressed={suppressedCount} />
      ) : (
        <>
          {/*
            One grid, and no phase transition.

            Today was two regions on two grids: a full-bleed featured block,
            then a rule, then an even three-across row. At 1920 that made the
            lead tile 1,872px wide and 253px tall while each supporting tile
            was 615px wide and 370px tall -- the most important object on the
            page rendered 117px SHORTER than the three beneath it, with its
            aging bar stretched across 880px to encode "4 days". The page's
            strongest treatment was spent on its emptiest tile.

            Eight columns then four, exactly as the Ideas field does it: the
            lead is visibly dominant, #2 fills the space that was white, and
            every vertical edge on the page lands on the same lines. The rank
            still comes from `compareTodayItems` and nothing here reorders it.

            `items-start` is what stops a metrics-only tile from being stretched
            to match a charted sibling. Height is earned, never granted -- BABA
            carried 185px of white for exactly that reason.
          */}
          <div
            data-testid="today-field"
            className="mt-4 grid grid-cols-12 items-start gap-3.5 px-6"
          >
            <div className="col-span-12 lg:col-span-8">
              <TodayTile
                item={featured}
                rank={1}
                featured
                onPrimary={handlePrimary}
                onDismiss={handleDismiss}
                onSnooze={handleSnooze}
              />
            </div>
            {supporting.map((item, i) => {
              const { span, wide } = supportingSpan(i, supporting.length)
              return (
              <div key={item.id} className={span}>
                <TodayTile
                  item={item}
                  rank={i + 2}
                  wide={wide}
                  onPrimary={handlePrimary}
                  onDismiss={handleDismiss}
                  onSnooze={handleSnooze}
                />
              </div>
              )
            })}
          </div>

          <AlsoWatching items={alsoWatching} suppressed={suppressedCount} aggregates={aggregates} />
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------- summary -- */

function Summary({
  isLoading, surfaced, evaluated, suppressed,
}: { isLoading: boolean; surfaced: number; evaluated: number; suppressed: number }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[11px] text-gray-500 dark:text-gray-500">
      <strong className="font-semibold text-gray-700 dark:text-gray-300">
        {isLoading ? 'Evaluating…' : `${surfaced} item${surfaced === 1 ? '' : 's'}`}
      </strong>
      {!isLoading && evaluated > surfaced && (
        <>
          <span className="text-gray-300 dark:text-gray-700">·</span>
          <span>{evaluated - surfaced} more, lower priority</span>
        </>
      )}
      {!isLoading && suppressed > 0 && (
        <>
          <span className="text-gray-300 dark:text-gray-700">·</span>
          <span>{suppressed} dismissed or snoozed by you</span>
        </>
      )}
    </div>
  )
}

/**
 * Where a supporting item sits on the twelve-column field.
 *
 * The lead takes eight columns and #2 takes the four beside it, so the FIRST
 * supporting item is spoken for by the lead's row. Everything after it has a
 * row of its own to fill, and must divide twelve between them or leave the
 * remainder as empty page.
 *
 * Today's cut is four items, so that remainder is normally two -- and a fixed
 * four-column span left a third of the second row blank, which is the void an
 * even three-across grid had been avoiding before this stage moved #2 up
 * beside the lead. Two take six each, three take four each, one takes the
 * width. Twelve divides by all of them, so every vertical edge still lands on
 * the lines of the row above.
 *
 * This is composition only. `TODAY_LIMIT` still decides how many items exist
 * and `compareTodayItems` still decides which, in what order.
 */
export function supportingSpan(index: number, total: number): { span: string; wide: boolean } {
  // #2 rides in the lead's row, under the four columns the lead does not take.
  if (index === 0) return { span: 'col-span-12 lg:col-span-4', wide: false }

  const rest = total - 1
  if (rest === 1) return { span: 'col-span-12', wide: true }
  if (rest === 2) return { span: 'col-span-12 md:col-span-6', wide: true }
  return { span: 'col-span-12 md:col-span-6 lg:col-span-4', wide: false }
}

/* --------------------------------------------------------- also watching -- */

/**
 * The selectivity proof. Subdued by construction — no shadow, no border, no
 * card. It exists so "these are the few things" reads as a decision the system
 * made rather than as all it could find.
 */
function AlsoWatching({
  items, suppressed, aggregates,
}: { items: TodayItem[]; suppressed: number; aggregates: AggregateNote[] }) {
  if (items.length === 0 && suppressed === 0 && aggregates.length === 0) return null

  return (
    <div className="mx-6 mt-7 border-t border-gray-200 pt-3 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-gray-500 dark:text-gray-500">
        <span className="font-semibold text-gray-600 dark:text-gray-400">Also watching</span>
        <span>
          {items.length > 0
            ? `Tesseract evaluated ${items.length} more finding${items.length === 1 ? '' : 's'} this morning and deliberately did not interrupt you.`
            : 'Nothing else cleared the bar for your attention.'}
        </span>
      </div>
      {aggregates.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-500">
          {aggregates.map(a => (
            <span key={a.titleKey}>
              <b className="font-mono font-semibold text-gray-600 dark:text-gray-400">{a.count}</b>
              {' '}{a.title.replace(/^\d+\s+/, '')} evaluated
            </span>
          ))}
        </div>
      )}
      {/*
        Each line names an object and the fact about it, not the queue it is in.

        These read `KO thesis may be stale · tier 1 framework gap`: a process
        state, then the engine's own bucket number, then the bucket's name. Two
        of the three said nothing about the investment, and "tier 1" said
        nothing to anybody outside the evaluator. What a reader wants from a
        line they are NOT being asked to act on is which name it concerns and
        what is true of it — the leading metric the tile would have shown had
        this item surfaced, which is already computed and was being discarded.
      */}
      {items.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
          {items.slice(0, 8).map(i => {
            const lead = i.metrics[0]
            return (
              <span key={i.id} className="flex items-baseline gap-1.5 text-[11px]">
                <span className="font-mono font-semibold text-gray-600 dark:text-gray-400">
                  {i.ticker ?? '—'}
                </span>
                <span className="text-gray-500 dark:text-gray-500">
                  {i.state.toLowerCase()}
                  {lead && (
                    <>
                      {' · '}
                      <span className="font-mono tabular-nums">{lead.value}</span>
                      {' '}{lead.label.toLowerCase()}
                    </>
                  )}
                </span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- states -- */

/**
 * Not an empty query.
 *
 * It says what was evaluated and what is still being watched, so a quiet
 * morning reads as a finished one rather than as a broken feed.
 */
function Cleared({ evaluated, suppressed }: { evaluated: number; suppressed: number }) {
  return (
    <div className="mx-6 mt-4 rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm dark:border-white/[0.08] dark:bg-[#141a25]">
      <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-400" />
      <h2 className="mt-4 text-[18px] font-semibold tracking-tight text-gray-900 dark:text-gray-50">
        You're current.
      </h2>
      <p className="mx-auto mt-1.5 max-w-[48ch] text-[12px] text-gray-600 dark:text-gray-400">
        Nothing across your coverage and portfolios needs work right now.
      </p>
      <div className="mx-auto mt-5 flex max-w-lg justify-center gap-7 border-t border-gray-200 pt-4 text-[11px] text-gray-500 dark:border-white/10 dark:text-gray-500">
        <span><b className="font-mono">{evaluated}</b> findings evaluated</span>
        {suppressed > 0 && <span><b className="font-mono">{suppressed}</b> handled by you</span>}
        <span>Watching theses, proposals, ratings and deliverables</span>
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div className="px-6 pt-4">
      <div className="h-48 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-[#141a25]" />
      <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className={clsx(
              'h-40 animate-pulse rounded-xl border border-gray-200 bg-white',
              'dark:border-white/[0.08] dark:bg-[#141a25]',
            )}
          />
        ))}
      </div>
    </div>
  )
}
