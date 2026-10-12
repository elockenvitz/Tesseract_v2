/**
 * The conclusion band — what we think, what it is worth, and how we are placed.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The Snapshot had everything an analyst needs and said nothing. Rating,
 * target and case-written-date sat as three equal figures in a row; the
 * thesis appeared as a list of SECTION NAMES with dates beside them, so the
 * landing surface could tell you a thesis had been written on 28 September
 * without telling you what it said. Valuation was a hairline across 1200px
 * with no number attached to the asymmetry, and the position lived in a
 * separate column with nothing relating it to the conviction.
 *
 * A reader opening a name asks four things in order: what do we think, what
 * is it worth, where are we different, and are we positioned for it. This
 * band answers those four, above everything else, in one eyeful.
 *
 * ── What it may not do ───────────────────────────────────────────────────
 *
 * Every figure here is read, not derived into an opinion:
 *
 *   - The rating is the dominant one with its count ALWAYS beside it. Three
 *     of five analysts is not "the firm rates this Buy", and the Snapshot has
 *     never pretended otherwise.
 *   - Upside and skew are arithmetic on a target and a spot the reader can
 *     see. There is no score, no weighting, no model.
 *   - The variant view is a VERBATIM excerpt of what an analyst wrote, with
 *     their name on it, through the same helper Our View uses. This component
 *     does not summarise prose.
 *   - Alignment between conviction and exposure is DESCRIBED, never judged.
 *     "Rated Buy, held at 2.5%" is a fact; "underweight relative to
 *     conviction" is a position-sizing opinion nobody has asked this surface
 *     to have.
 *
 * Absent data says it is absent, in the place the figure would have been.
 */

import { clsx } from 'clsx'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { EYEBROW } from '../desktop/DesktopModule'
import { ourViewExcerpt, ourViewAge } from './OurViewSummary'
import type { CurrentLadder } from '../../lib/signals/current-ladder'

export interface ConclusionSection {
  section: string
  content: string | null
  updatedAt: string | null
  authorName: string | null
}

export interface InvestmentConclusionProps {
  symbol: string | null
  /** Dominant rating and the n it rests on. Null when nobody has rated it. */
  rating: { value: string; count: number } | null
  analystCount: number
  target: number | null
  spot: number | null
  ladder: CurrentLadder | null
  /** Core research sections, for the variant view and the thesis line. */
  sections: ConclusionSection[]
  /** The position in the current scope, and how many books hold it at all. */
  weightPct: number | null
  bookName: string | null
  heldBookCount: number
  /** True when a book is selected that does not hold the name. */
  notInSelectedBook?: boolean
  onOpenResearch: () => void
}

const pct1 = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

/** A rating's direction, for the arrow only. Unknown words get no arrow. */
function tone(value: string | null | undefined): 'up' | 'down' | 'flat' | null {
  if (!value) return null
  const v = value.toLowerCase()
  if (/buy|overweight|outperform|add|long/.test(v)) return 'up'
  if (/sell|underweight|underperform|trim|short|reduce/.test(v)) return 'down'
  if (/hold|neutral|market ?perform|equal ?weight/.test(v)) return 'flat'
  return null
}

const rung = (ladder: CurrentLadder | null, name: string) =>
  ladder?.cases.find(c => c.name === name)?.price ?? null

export interface ConclusionFigures {
  /** Percent from spot to the headline target. Null without both. */
  upside: number | null
  /** Percent from spot to the bear rung. */
  downside: number | null
  /** Percent from spot to the bull rung. */
  upsideBull: number | null
  bear: number | null
  bull: number | null
  /** Reward-to-risk. Null unless BOTH ends are on record. */
  skew: number | null
}

/**
 * The band's arithmetic, exported so the phone shares it.
 *
 * Mobile renders a different layout — a 2x2 grid, not a wide row — but it
 * must not compute a second upside. Two implementations of "percent to
 * target" is how a phone and a desktop end up disagreeing about the same
 * name, and the rounding would differ before the logic did.
 *
 * Every figure here is null-propagating on purpose. A missing spot does not
 * produce a zero, it produces no number, and the surfaces render the absence.
 */
export function conclusionFigures(
  { target, spot, ladder }: { target: number | null; spot: number | null; ladder: CurrentLadder | null },
): ConclusionFigures {
  const usable = spot != null && Number.isFinite(spot) && spot > 0
  const to = (v: number | null) => (usable && v != null ? ((v - spot!) / spot!) * 100 : null)

  const bear = rung(ladder, 'Bear')
  const bull = rung(ladder, 'Bull')
  const downside = to(bear)
  const upsideBull = to(bull)

  /*
   * Reward-to-risk, stated only when BOTH ends exist.
   *
   * A one-sided ladder produces a ratio against an unknown, which is the kind
   * of number that gets quoted in a meeting and cannot be defended. Either
   * both rungs are on record or the figure is not shown.
   */
  const skew = downside != null && upsideBull != null && downside < 0
    ? upsideBull / Math.abs(downside)
    : null

  return { upside: to(target), downside, upsideBull, bear, bull, skew }
}

/** A labelled figure, or an explicit absence in the same slot. */
function Figure({
  label, value, sub, tone: t, wide,
}: {
  label: string
  value: string | null
  sub?: string | null
  tone?: 'up' | 'down' | 'flat' | null
  wide?: boolean
}) {
  return (
    <div className={clsx('min-w-0', wide ? 'flex-1' : 'shrink-0')}>
      <div className={EYEBROW}>{label}</div>
      {value ? (
        <>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            {t && (
              t === 'up' ? <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                : t === 'down' ? <TrendingDown className="h-3.5 w-3.5 shrink-0 text-rose-600" />
                  : <Minus className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            )}
            <span className="text-[19px] font-semibold leading-none tracking-tight text-gray-900 dark:text-gray-100">
              {value}
            </span>
          </div>
          {sub && <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{sub}</div>}
        </>
      ) : (
        <>
          {/* The slot stays, so an absence reads as a gap in the record rather
              than as a figure that failed to load or a column that moved. */}
          <div className="mt-0.5 text-[13px] text-gray-400 dark:text-gray-500">Not set</div>
          {/*
            And the reason, which is the useful half.

            The first build rendered `sub` only alongside a value, so "Needs
            both a bear and a bull case" — the one line that tells a reader
            what to do about the gap — was dropped in exactly the case it was
            written for. The tests caught it.
          */}
          {sub && <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{sub}</div>}
        </>
      )}
    </div>
  )
}

export function InvestmentConclusion({
  symbol, rating, analystCount, target, spot, ladder, sections,
  weightPct, bookName, heldBookCount, notInSelectedBook, onOpenResearch,
}: InvestmentConclusionProps) {
  const { upside, downside, upsideBull, bear, bull, skew } =
    conclusionFigures({ target, spot, ladder })

  /*
   * The band leads on the DIFFERENTIATED view, and on nothing else.
   *
   * The first build fell back to the thesis when no variant view existed,
   * which printed the same paragraph twice in one screen — once here and
   * again in The case below. Two copies of one sentence is exactly the
   * incoherence this page exists to remove, and the fallback also quietly
   * relabelled a thesis as a differentiated view.
   *
   * When there is no variant view, that absence IS the finding: it is the
   * most useful thing this band can say, because a name held at 2.5% with no
   * recorded edge is a question for the next meeting.
   */
  const find = (s: string) => sections.find(x => x.section === s && (x.content ?? '').trim())
  const variant = find('where_different')
  const hasThesis = Boolean(find('thesis'))
  const variantAge = ourViewAge(variant?.updatedAt)

  return (
    <div
      data-testid="investment-conclusion"
      className="rounded-xl border border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <Figure
          label="Our rating"
          value={rating?.value ?? null}
          tone={tone(rating?.value)}
          sub={rating
            ? `${rating.count} of ${analystCount} analyst${analystCount === 1 ? '' : 's'}`
            : undefined}
        />
        <Figure
          label="Target"
          value={target != null ? `$${target.toFixed(2)}` : null}
          sub={upside != null ? `${pct1(upside)} to spot` : 'No spot to compare'}
        />
        <Figure
          label="Bear / bull"
          value={bear != null && bull != null ? `$${bear.toFixed(0)} – $${bull.toFixed(0)}` : null}
          sub={downside != null && upsideBull != null
            ? `${pct1(downside)} / ${pct1(upsideBull)}${skew != null ? ` · ${skew.toFixed(1)}:1` : ''}`
            : 'Needs both a bear and a bull case'}
        />
        <Figure
          label="Our exposure"
          value={notInSelectedBook ? 'Not held'
            : weightPct != null ? `${weightPct.toFixed(2)}%`
              : heldBookCount > 0 ? 'Held' : 'Not held'}
          /*
           * No sub-line in the held-nowhere case, deliberately.
           *
           * It read "Not held in any book you can see" — word for word what
           * the Position module below already says. One screen stating the
           * same fact in the same sentence twice is the incoherence this page
           * exists to remove, and a reader cannot tell whether two identical
           * claims are one read or two. The value says it; the module below
           * carries the detail.
           */
          sub={notInSelectedBook
            ? `${bookName ?? 'This book'} does not hold it`
            : heldBookCount > 0
              ? `${bookName ? `${bookName} · ` : ''}${heldBookCount} book${heldBookCount === 1 ? '' : 's'}`
              : undefined}
        />
      </div>

      {/* ── The differentiated view, in the analyst's own words ──────── */}
      <div className="mt-3.5 border-t border-gray-200/70 pt-3 dark:border-white/[0.07]">
        {variant ? (
          <button
            type="button"
            onClick={onOpenResearch}
            data-testid="conclusion-variant"
            className="group w-full text-left"
          >
            <div className="flex items-baseline gap-2">
              <span className={EYEBROW}>Where we differ</span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                {variant.authorName ?? 'Unknown analyst'}
                {variantAge && ` · ${variantAge.text}`}
              </span>
              {variantAge?.stale && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  may be stale
                </span>
              )}
            </div>
            {/* Verbatim and attributed, through the same helper Our View uses.
                This surface quotes analysts; it does not paraphrase them. */}
            <p className="mt-1 max-w-[95ch] text-[13px] leading-snug text-gray-700 group-hover:text-gray-900 dark:text-gray-300 dark:group-hover:text-gray-100">
              {ourViewExcerpt(variant.content, 230)}
            </p>
          </button>
        ) : (
          <div data-testid="conclusion-no-variant">
            <span className={EYEBROW}>Where we differ</span>
            <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">
              {hasThesis
                ? 'Nobody has recorded what this firm sees that the market does not. '
                  + 'The thesis is below.'
                : `No investment case has been written for ${symbol ?? 'this name'}. `
                  + 'The figures above are whatever has been recorded against it.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
