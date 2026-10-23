import React from 'react'
import { clsx } from 'clsx'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useAssetWorkspace, primaryPosition } from '../../../hooks/useAssetWorkspace'
import {
  guidanceFor,
  type EvidenceFacet,
  type PeriodKey,
} from '../../../lib/asset-work/requirement-guidance'
import { readPerformance, describeBasis, PERIODS } from '../../../lib/asset-work/performance'

/**
 * The requirement as an assignment rather than a checkbox.
 *
 * ── What this replaces ──────────────────────────────────────────────────
 *
 * Selecting a requirement produced the item card alone: its text, a
 * completion control, a notes box and a comment box. Everything the
 * requirement was ABOUT — the position it concerns, the price it is
 * reacting to, the target it is measured against, when the case was last
 * written — lived on other sub-pages, so the analyst left Work to look
 * anything up and came back to a box with a cursor in it.
 *
 * This frames the same card with the three questions a working surface has
 * to answer: what am I establishing, what do I already know, what do I do
 * next. The card itself is untouched and still owns every write — the
 * takeaway, the notes, the status transition and its attribution. There is
 * no second completion path here, and no second store.
 *
 * ── Evidence integrity ──────────────────────────────────────────────────
 *
 * Every cell states its own provenance and its own as-of date, because
 * these facts are not equally fresh: the position is a dated holdings
 * snapshot, the price is the last CLOSE and not a live quote, the target
 * is the firm's official one, and the case age is an authoring timestamp.
 * A cell with nothing behind it renders an em-dash and says what is
 * missing. Nothing here is computed from a live market-data endpoint, and
 * nothing is generated.
 *
 * The hook is the same org-scoped `useAssetWorkspace` the context strip
 * and the Snapshot already read, on the same query key, so this adds no
 * query path and no new RLS surface. The deep-history window is requested
 * only for a requirement whose subject is price.
 */

interface NextRequirement {
  id: string
  text: string
}

interface Props {
  assetId: string
  symbol: string | null
  /** The requirement's own text — the heading of this workspace. */
  requirementText: string
  /** Stage label and the description the Process defines for it, if any. */
  stageLabel: string
  stageDescription?: string | null
  /** 1-based position of this requirement among the stage's requirements. */
  index: number
  total: number
  doneCount: number
  /** Clears the selection and returns to the stage overview. */
  onBack: () => void
  next?: NextRequirement | null
  onOpenNext?: (id: string) => void
  /** The existing item card: work product, completion, attribution. */
  children: React.ReactNode
  className?: string
}

const EYEBROW = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'
const CELL_VALUE = 'text-[15px] font-semibold leading-tight text-gray-900 dark:text-gray-100'
const CELL_DASH = 'text-[15px] font-semibold leading-tight text-gray-300 dark:text-gray-600'
const CELL_SUB = 'mt-0.5 text-[11px] leading-tight text-gray-500 dark:text-gray-400'

const money = (n: number) =>
  '$' + (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2))
const signed = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%'

/** A short, unambiguous date. Never a relative one on its own. */
function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}

/**
 * The move across the window the cache actually holds, and the date it is
 * measured from. Stating the anchor is the point: "+3.1%" with no window
 * is not a fact a reader can check.
 */
function moveOverWindow(history: { date: string; close: number }[]) {
  if (history.length < 2) return null
  const last = history[history.length - 1]
  const first = history[0]
  if (!(first.close > 0)) return null
  return { pct: ((last.close - first.close) / first.close) * 100, from: first.date, to: last.date }
}

interface Cell {
  key: EvidenceFacet
  label: string
  value: string | null
  sub: string
}

/**
 * The performance block: three horizons at once, one of them expanded.
 *
 * ── Why all three are on screen ─────────────────────────────────────────
 *
 * "Check YTD performance" is not answerable by a year-to-date number
 * alone. A name up 12% on the year and down 9% over the month is a
 * different investment question from one that drifted up all year, and a
 * reader who has to click to find that out will not click. So the chips
 * carry their own figures and the selected horizon gets the basis dates
 * and the arithmetic spelled out.
 *
 * Every figure is stamped with the two closes it was measured between,
 * because a return without its endpoints is not checkable. A horizon the
 * series cannot support says why in words rather than showing a dash.
 */
function PerformanceBlock({
  history, period, onPeriodChange,
}: {
  history: { date: string; close: number }[]
  period: PeriodKey
  onPeriodChange: (p: PeriodKey) => void
}) {
  const reading = readPerformance(history)
  const active = reading.periods[period]
  const basis = describeBasis(active)

  return (
    <div data-testid="performance-block">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <span className={EYEBROW}>{period} price return</span>
          {active.pct === null ? (
            <>
              <p className={CELL_DASH}>—</p>
              <p className={clsx(CELL_SUB, 'max-w-[46ch]')} data-testid="performance-unavailable">
                {active.unavailable}
              </p>
            </>
          ) : (
            <>
              <p
                className={clsx(
                  'text-[26px] font-semibold leading-none tracking-tight',
                  active.pct >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-700 dark:text-rose-400',
                )}
                data-testid="performance-headline"
              >
                {signed(active.pct)}
              </p>
              <p className={CELL_SUB}>
                {basis}
                {active.from && active.to
                  ? ` · ${money(active.from.close)} → ${money(active.to.close)}`
                  : ''}
              </p>
            </>
          )}
        </div>

        {/* The ladder. Each chip carries its own figure, so the comparison
            across horizons needs no clicking. */}
        <div className="flex items-center gap-1" role="group" aria-label="Return period">
          {PERIODS.map(key => {
            const p = reading.periods[key]
            const on = key === period
            return (
              <button
                key={key}
                type="button"
                onClick={() => onPeriodChange(key)}
                data-testid={`period-${key}`}
                aria-pressed={on}
                title={p.unavailable ?? describeBasis(p) ?? undefined}
                className={clsx(
                  'rounded border px-2 py-1 text-left leading-tight transition-colors',
                  on
                    ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
                    : 'border-gray-200 text-gray-600 hover:border-gray-400 dark:border-gray-700 dark:text-gray-300',
                )}
              >
                <span className="block text-[10px] font-semibold uppercase tracking-wider opacity-70">{key}</span>
                <span className="block text-[12px] font-semibold tabular-nums">
                  {p.pct === null ? '—' : signed(p.pct)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
        {reading.latest
          ? `Latest close ${money(reading.latest.close)} on ${shortDate(reading.latest.date)}`
          : 'No close held'}
        {reading.latestAgeDays !== null && reading.latestAgeDays > 0
          ? `, ${reading.latestAgeDays} days ago`
          : ''}
        {reading.coverage
          /* "loaded", not "held": the page fetches a bounded window, and a
             reader told the cache holds 261 closes would be told wrong. */
          ? ` · ${reading.coverage.observations} closes loaded, ${shortDate(reading.coverage.from)} to ${shortDate(reading.coverage.to)}`
          : ''}
        {/* Two refusals stated once, where the figures are, rather than
            left for the reader to assume either way. */}
        {' · '}Price return from stored closes: no dividend adjustment is recorded, so this is not total
        return, and no benchmark series is held for this organization, so relative performance is not shown.
      </p>
    </div>
  )
}

function Evidence({
  facets, assetId, symbol, period, onPeriodChange,
}: {
  facets: EvidenceFacet[]
  assetId: string
  symbol: string | null
  /** Non-null only where the requirement's subject is performance. */
  period: PeriodKey | null
  onPeriodChange: (p: PeriodKey) => void
}) {
  /*
   * ── Always the deep window, and never a conditional one ─────────────
   *
   * This asked for the deep history only where price led the facets, to
   * avoid pulling four hundred closes for a requirement that shows the
   * number in passing. Measured in the app, that produced a worse fault
   * than the one it saved: the shallow window is twelve CALENDAR days, the
   * newest close held for AMZN was twenty-two days old, and so the same
   * asset read "$248.23, Oct 1 2026" under one requirement and "No price
   * history held for this name" under the next.
   *
   * A false absence is the one thing this panel may never print, and two
   * different answers to the same question on one screen is worse again.
   * One window for the whole surface. `useAssetWorkspace` caches per
   * depth, so this is one query per asset shared by every requirement.
   */
  const { data, isLoading, error } = useAssetWorkspace(
    assetId, symbol, 'overview', { deepHistory: true },
  )

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="requirement-evidence-loading">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-[52px] animate-pulse rounded-md bg-gray-100 dark:bg-gray-800" />
        ))}
      </div>
    )
  }

  if (error) {
    /* Unavailable is not the same as absent, and must not read as "none". */
    return (
      <p className="text-[12px] text-amber-700 dark:text-amber-500" data-testid="requirement-evidence-error">
        Evidence could not be loaded, so nothing is shown here rather than an empty one.
      </p>
    )
  }

  const position = primaryPosition(data.positions)
  const lastClose = data.history.length ? data.history[data.history.length - 1] : null
  const move = moveOverWindow(data.history)
  const caseAge = daysSince(data.caseWrittenAt)

  const build = (facet: EvidenceFacet): Cell => {
    switch (facet) {
      case 'position': {
        if (!position) {
          return { key: facet, label: 'Position', value: null, sub: 'No position in any book you can see' }
        }
        const books = data.positions.length > 1 ? ` · +${data.positions.length - 1} more book${data.positions.length > 2 ? 's' : ''}` : ''
        return {
          key: facet,
          label: 'Position',
          value: position.weightPct !== null
            ? `${position.weightPct.toFixed(2)}% of ${position.portfolioName}`
            : `${Math.round(position.shares).toLocaleString('en-US')} sh`,
          sub: `${Math.round(position.shares).toLocaleString('en-US')} sh · ${money(position.marketValue)} · book as of ${shortDate(position.asOf) ?? 'an unknown date'}${books}`,
        }
      }
      case 'price': {
        if (!lastClose) return { key: facet, label: 'Price', value: null, sub: 'No price history held for this name' }
        return {
          key: facet,
          label: 'Last close',
          value: money(lastClose.close),
          sub: move
            ? `${shortDate(lastClose.date)} · ${signed(move.pct)} since ${shortDate(move.from)}`
            : `${shortDate(lastClose.date)} · one close held, so no move to state`,
        }
      }
      case 'target': {
        if (!data.target) return { key: facet, label: 'Target', value: null, sub: 'No official target recorded' }
        const implied = lastClose ? ((data.target - lastClose.close) / lastClose.close) * 100 : null
        return {
          key: facet,
          label: 'Target',
          value: money(data.target),
          sub: implied === null
            ? 'Firm official target'
            : `Firm official target · ${signed(implied)} from the last close`,
        }
      }
      case 'case': {
        if (!data.caseWrittenAt) return { key: facet, label: 'Investment case', value: null, sub: 'No case section written yet' }
        return {
          key: facet,
          label: 'Investment case',
          value: caseAge === null ? '—' : caseAge === 0 ? 'Today' : `${caseAge}d old`,
          sub: `Last written ${shortDate(data.caseWrittenAt)}`,
        }
      }
      case 'ideas':
      default: {
        const n = data.liveIdeas.length
        return {
          key: facet,
          label: 'Live ideas',
          value: n ? String(n) : null,
          sub: n ? 'Open on this asset' : 'No open ideas on this asset',
        }
      }
    }
  }

  /*
   * Where performance IS the subject, the single price cell is replaced by
   * the block above — three horizons, their basis dates and their
   * refusals. Leaving the cell in beside it would print the same close
   * twice under two different headings.
   */
  const cells = (period ? facets.filter(f => f !== 'price') : facets).slice(0, 4).map(build)

  return (
    <div className="space-y-3" data-testid="requirement-evidence">
      {period && (
        <PerformanceBlock
          history={data.history}
          period={period}
          onPeriodChange={onPeriodChange}
        />
      )}
      <div
        className={clsx(
          'grid gap-x-5 gap-y-3',
          period ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 lg:grid-cols-4',
          period && 'border-t border-gray-100 pt-3 dark:border-gray-800',
        )}
      >
        {cells.map(c => (
          <div key={c.key} data-testid={`evidence-${c.key}`}>
            <span className={EYEBROW}>{c.label}</span>
            <p className={c.value === null ? CELL_DASH : CELL_VALUE}>{c.value ?? '—'}</p>
            <p className={CELL_SUB}>{c.sub}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function RequirementWorkspace({
  assetId, symbol, requirementText, stageLabel, stageDescription,
  index, total, doneCount, onBack, next, onOpenNext, children, className,
}: Props) {
  const guidance = guidanceFor({ text: requirementText, stageDescription })
  /*
   * The horizon opens on the one the requirement NAMES and is the reader's
   * from then on. Keyed on the requirement by the caller, so moving to the
   * next one opens on its own period rather than inheriting this one's.
   */
  const [period, setPeriod] = React.useState<PeriodKey | null>(guidance.defaultPeriod)

  return (
    <section className={clsx('min-w-0', className)} data-testid="requirement-workspace">
      {/*
        ── Orientation ─────────────────────────────────────────────────
        One row that answers where this is and how much is left, so the
        reader does not have to look back up at the rail to find out.
      */}
      <header className="border-b border-gray-200 pb-3 dark:border-gray-700">
        {/*
          ── The way back is at the top, where it is looked for ───────────

          It used to be a footer control: to leave a requirement you scrolled
          past the evidence, the questions and your own draft to find it. The
          reader's position in the stage goes with it, so "where am I" and
          "how do I get out" are one line rather than two ends of a page.
        */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            data-testid="requirement-back-top"
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {stageLabel}
          </button>
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Requirement {index} of {total} · {doneCount} done
          </span>
        </div>
        <h3 className="mt-1 text-[17px] font-semibold leading-snug text-gray-900 dark:text-gray-100">
          {requirementText}
        </h3>
        {guidance.objective ? (
          <p className="mt-1.5 text-[13px] leading-relaxed text-gray-600 dark:text-gray-300">
            {guidance.objective}
            {/* Quoted, never composed: the reader can hold the Process to it. */}
            <span className="ml-1 text-[11px] text-gray-400 dark:text-gray-500">
              — this stage's objective, from your Process definition
            </span>
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
            This Process defines no objective for {stageLabel}.
          </p>
        )}
      </header>

      {/* ── What is already known ───────────────────────────────────── */}
      <div className="border-b border-gray-200 py-3 dark:border-gray-700">
        <span className={clsx(EYEBROW, 'mb-2 block')}>What you already know</span>
        <Evidence
          facets={guidance.facets}
          assetId={assetId}
          symbol={symbol}
          period={period}
          onPeriodChange={setPeriod}
        />
      </div>

      {/*
        ── What to establish ───────────────────────────────────────────
        Omitted entirely when the wording matched no topic. A heading with
        generic questions under it would read as the firm's guidance.
      */}
      {guidance.questions.length > 0 && (
        <div className="border-b border-gray-200 py-3 dark:border-gray-700" data-testid="requirement-questions">
          <span className={clsx(EYEBROW, 'mb-2 block')}>What to establish</span>
          <ul className="space-y-1">
            {guidance.questions.map(q => (
              <li key={q} className="flex gap-2 text-[13px] leading-relaxed text-gray-700 dark:text-gray-200">
                <span className="select-none text-gray-300 dark:text-gray-600">·</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
            Standard questions for a {guidance.topic!.toLowerCase()} requirement — not a reading of this asset.
          </p>
        </div>
      )}

      {/* ── The work itself: the existing card, unchanged ───────────── */}
      <div className="py-3" data-testid="requirement-work">
        <span className={clsx(EYEBROW, 'mb-2 block')}>Your work</span>
        {children}
      </div>

      {/* ── Where to go next ────────────────────────────────────────── */}
      {/* The footer keeps the FORWARD move — what you do when the finding is
          written — while the way back lives at the top. */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
        <button
          type="button"
          onClick={onBack}
          data-testid="requirement-back"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to {stageLabel}
        </button>
        {next && onOpenNext && (
          <button
            type="button"
            onClick={() => onOpenNext(next.id)}
            data-testid="requirement-next"
            className="inline-flex min-w-0 items-center gap-1.5 rounded border border-gray-300 px-2.5 py-1 text-[12px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <span className="truncate">Next: {next.text}</span>
            <ArrowRight className="h-3.5 w-3.5 flex-none" />
          </button>
        )}
      </footer>
    </section>
  )
}
