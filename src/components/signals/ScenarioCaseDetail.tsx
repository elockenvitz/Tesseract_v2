import { clsx } from 'clsx'
import { isQualityContent } from '../../lib/signals/suppression'
import type { ScenarioCase } from '../../lib/signals/builders/scenarioGap'

interface ScenarioCaseDetailProps {
  price: number
  cases: ScenarioCase[]
  expected: number | null
}

/**
 * Every case the analyst wrote, in place on the card.
 *
 * This is the answer to "I want to see more about the cases without going to
 * the asset page". The ladder above shows *where* the price sits; this shows
 * *what each case says* — the target, its probability, its horizon and the
 * reasoning the analyst typed when they set it.
 *
 * Reasoning is the part that makes it worth opening. A row of numbers is
 * already in the ladder; the sentence explaining why the bear case is $325 is
 * the thing that has, until now, only existed behind three taps on a desktop
 * screen.
 *
 * Sorted high to low. The card's claim is almost always about an end of the
 * range, and reading a ladder top-down matches how the ladder is drawn.
 */
export function ScenarioCaseDetail({ price, cases, expected }: ScenarioCaseDetailProps) {
  const sorted = [...cases].sort((a, b) => b.price - a.price)
  /**
   * Every case, with the prose giving way rather than the cases.
   *
   * ── What this replaces, and why it was wrong ─────────────────────────────
   *
   * Two rows, and a line reading "+1 more case on the asset". That line named
   * exactly the thing the reader wanted and then withheld it — the worst of
   * both, because the reader now knows a case exists, cannot see it, and has
   * to leave the feed to find out what it says.
   *
   * The height budget was real: a row carrying three lines of reasoning is
   * about 96px and the pane is about 200, so two rows was genuinely all that
   * fit. But the thing that made rows tall was the PROSE, not the case, and a
   * bear case is its name and its price. So the reasoning renders only when a
   * ladder is short enough to afford it, and every case is always listed.
   *
   * Three, measured rather than chosen. A prose-free row is about 60px and
   * the pane is about 200: five rows put the remainder line 101px below the
   * action bar, where `overflow-hidden` deletes it. Three fits with room to
   * spare.
   *
   * Three is also what a ladder actually is — bear, base, bull — so in
   * practice nothing is hidden at all, which is the point. The ceiling exists
   * for the pathological twenty-case name, not for the normal one.
   */
  const MAX_ROWS = 3
  const shown = sorted.slice(0, MAX_ROWS)
  const hidden = sorted.length - shown.length
  /** Prose costs about two rows. Afforded only when the ladder is short. */
  const showReasoning = sorted.length <= 2

  return (
    <div
      data-testid="case-detail"
      /**
       * A plain list again, bounded rather than paged.
       *
       * It column-wrapped into a horizontal pager, which solved the height but
       * put a sideways scroller INSIDE a pane that the carousel already pages
       * sideways. Two horizontal scrollers nested one inside the other is a
       * gesture nobody can aim: reported as "cases and reweight are weirdly
       * horizontal scrolling within the component".
       *
       * So the ladder shows what fits and says how many it did not, the same
       * bounded-with-a-remainder shape `ActiveWeightPeers` uses. Truncation is
       * stated; the full ladder is on the asset.
       */
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700"
    >
      {shown.map(c => {
        const gap = (c.price - price) / price
        return (
          <div
            key={`${c.name}-${c.price}`}
            className="shrink-0 border-b border-gray-100 px-3.5 py-2.5 last:border-b-0 dark:border-gray-800"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200">
                {c.name}
              </span>
              <span className="text-[15px] font-bold tabular-nums text-gray-900 dark:text-white">
                ${c.price.toFixed(2)}
              </span>
              {/* Distance from the tape, per case. The single most useful
                  number here and the one the ladder can only show
                  positionally. */}
              <span className={clsx(
                'text-[13px] font-semibold tabular-nums',
                gap >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
              )}>
                {gap >= 0 ? '+' : ''}{(gap * 100).toFixed(0)}%
              </span>
              {c.probability != null && (
                <span className="ml-auto shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {c.probability.toFixed(0)}%
                </span>
              )}
            </div>
            {c.timeframe && (
              <div className="mt-0.5 text-[12px] font-medium text-gray-400">{c.timeframe}</div>
            )}
            {/* The reasoning, verbatim — but only when it is readable.
                Not summarised: this is the analyst's own sentence, and
                paraphrasing somebody's thesis back at them is how a surface
                loses their trust.
                
                Gated on isQualityContent because 19 of 30 target rows in this
                database hold keyboard mash — 'sdfsdfs', 'eljfnbejwknvfkejrf',
                'gtfrwghghwsdsadasd' — and rendering that verbatim presents
                someone's stray keystrokes as analysis. The case still shows its
                price, probability and horizon, so nothing checkable is lost;
                what goes is a line that was never a sentence. */}
            {showReasoning && isQualityContent(c.reasoning) && (
              // Clamped, because the pane is a box and the card owns no
              // vertical gesture to reach past it. Measured at 390x844 an
              // unclamped ladder pushed 136px of somebody's thesis below the
              // action bar, where `overflow-hidden` deleted it — a clamp at
              // least tells the reader there is more, and the full text is two
              // taps away on the asset. Clipping silently is the one option
              // that is not honest.
              <p className="mt-1 line-clamp-2 text-[13px] leading-[1.45] text-gray-600 dark:text-gray-300">
                {c.reasoning!.trim()}
              </p>
            )}
          </div>
        )
      })}

      {/* Only past five, which a real ladder never reaches. Naming a hidden
          case is worth doing when the alternative is pushing the pane through
          the action bar, and not otherwise. */}
      {hidden > 0 && (
        <p className="shrink-0 px-3.5 py-2 text-[11px] font-medium text-gray-400" data-testid="cases-truncated">
          +{hidden} more case{hidden === 1 ? '' : 's'} on the asset
        </p>
      )}

      {expected != null && (
        <div className="flex shrink-0 items-baseline gap-2 bg-gray-50 px-3.5 py-2.5 dark:bg-gray-800/60">
          <span className="text-[13px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Expected
          </span>
          <span className="text-[15px] font-bold tabular-nums text-gray-900 dark:text-white">
            ${expected.toFixed(2)}
          </span>
          <span className="ml-auto text-[12px] font-medium text-gray-400">
            probability-weighted
          </span>
        </div>
      )}
    </div>
  )
}
