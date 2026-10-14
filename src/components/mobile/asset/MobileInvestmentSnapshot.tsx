/**
 * The Investment Snapshot, built for a phone.
 *
 * ── Why this is not the desktop Snapshot at 390px ────────────────────────
 *
 * `InvestmentSnapshot` composes four desktop modules in a two-column grid
 * with inline figure rows and hover deep-links. None of that survives a
 * thumb: the figure rows wrap into unreadable pairs, the grid collapses to a
 * single column of tall cards that pushes Decision Memory three screens down,
 * and hover links are unreachable. The locked decision for this page is one
 * app, two shells, shared data layer — so this is a different surface over
 * the SAME hook.
 *
 * ── What is shared, and what is not ──────────────────────────────────────
 *
 * Shared: `useAssetWorkspace` (one `Promise.all` behind one React Query key,
 * so the phone issues no extra reads), `primaryPosition`/`otherPositions`,
 * `DecisionMemorySummary`, and the execution-proof semantics. Those are the
 * truth, and a second copy of them is how two surfaces start disagreeing.
 *
 * Not shared: layout, density, and what gets collapsed. A phone reader scans
 * one column and taps to go deeper, so every domain is one band with its
 * headline fact visible and its detail behind a tap.
 *
 * ── Order ────────────────────────────────────────────────────────────────
 *
 * The CONCLUSION first — rating, target, bear/bull and exposure in a 2x2
 * grid, with the differentiated view quoted under it — then Position, Belief,
 * Active Work and Decision Memory.
 *
 * It did not used to have a conclusion. It opened on Position and reduced the
 * whole of belief to "$268 target +16%": no rating, no range, no edge. So the
 * two shells answered different questions about the same name, and the phone
 * answered the smaller one.
 *
 * The old note here argued that a phone reader wants "what do we own" first.
 * That is still true, and it is still first — exposure is one of the four
 * figures, and Position remains the first band. What changed is that the
 * other three conclusions are no longer three taps away.
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import {
  ChevronRight, Briefcase, FileText, Activity, Scale, ChevronDown,
} from 'lucide-react'
import { useAssetWorkspace, primaryPosition, otherPositions } from '../../../hooks/useAssetWorkspace'
import { DecisionMemorySummary } from '../../asset/DecisionMemorySummary'
import { BookFilter } from '../../shared/BookFilter'
/*
 * The conclusion's arithmetic and the excerpt clipper, imported rather than
 * rewritten for the phone. The LAYOUT differs between the shells; "percent to
 * target" and "where a quoted sentence ends" must not.
 */
import { conclusionFigures } from '../../asset/InvestmentConclusion'
import { ourViewExcerpt } from '../../asset/OurViewSummary'
import { useAnalystRatings } from '../../../hooks/useAnalystRatings'
import { AttentionBand } from '../../asset/AttentionBand'
import {
  resolveWorkspaceState, resolveWorkspaceSignals, type WorkspaceFacts,
} from '../../../lib/asset-workspace/context'

const pct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? null : `${v.toFixed(digits)}%`

const usd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return null
  const abs = Math.abs(v)
  if (abs >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

const shares = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? null : v.toLocaleString()

/**
 * One band.
 *
 * Collapsible, with the headline always visible. A band that can hide its own
 * summary is a band the reader has to open to learn whether it was worth
 * opening.
 */
function Band({
  title, icon: Icon, headline, children, defaultOpen = false, testId, action,
}: {
  title: string
  icon: typeof FileText
  /** Always visible, collapsed or not. */
  headline: React.ReactNode
  children?: React.ReactNode
  defaultOpen?: boolean
  testId: string
  action?: { label: string; onClick: () => void }
}) {
  const [open, setOpen] = useState(defaultOpen)
  const collapsible = !!children

  return (
    <section
      data-testid={testId}
      className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden"
    >
      <div className="px-3 pt-2 pb-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Icon className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 truncate">
              {title}
            </h2>
          </div>
          {collapsible && (
            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              aria-expanded={open}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
              data-testid={`${testId}-toggle`}
              /* 40px tall: a real thumb target, not a 16px chevron. */
              className="shrink-0 -mr-1 h-10 w-10 flex items-center justify-center text-gray-400 active:bg-gray-100 dark:active:bg-gray-800 rounded-lg"
            >
              <ChevronDown className={clsx('h-4 w-4 transition-transform', open && 'rotate-180')} />
            </button>
          )}
        </div>

        <div className="mt-0.5">{headline}</div>
      </div>

      {collapsible && open && (
        <div
          className="px-3 pb-2 border-t border-gray-100 dark:border-gray-800 pt-1.5"
          data-testid={`${testId}-detail`}
        >
          {children}
        </div>
      )}

      {action && (
        <button
          type="button"
          onClick={action.onClick}
          data-testid={`${testId}-action`}
          className="w-full flex items-center justify-between px-3 h-11 border-t border-gray-100 dark:border-gray-800 text-[13px] font-medium text-primary-600 dark:text-primary-400 active:bg-gray-50 dark:active:bg-gray-800"
        >
          {action.label}
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </section>
  )
}

/** A label/value row sized for a phone: value right-aligned, never wrapping. */
function Row({ label, value, sub }: { label: string; value: string | null; sub?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[12px] text-gray-500 dark:text-gray-400 min-w-0 truncate">{label}</span>
      <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100 tabular-nums shrink-0">
        {value ?? <span className="font-normal text-gray-400">—</span>}
        {sub && <span className="ml-1 font-normal text-[11px] text-gray-500">{sub}</span>}
      </span>
    </div>
  )
}

/**
 * One of the four conclusion figures, in a 2x2 grid.
 *
 * Separate from `Row` because this is a figure, not a label/value pair: the
 * value leads and the qualifier sits under it. The qualifier is rendered in
 * the absent case too — "Not rated" and "Needs both cases" are the useful
 * half when the number is missing, which is the mistake the desktop band made
 * first.
 */
function MobileFigure({
  label, value, sub,
}: { label: string; value: string | null; sub?: string | null }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{label}</div>
      <div className={clsx(
        'mt-0.5 text-[17px] font-semibold leading-none tracking-tight truncate',
        value ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500',
      )}>
        {value ?? 'Not set'}
      </div>
      {sub && <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 truncate">{sub}</div>}
    </div>
  )
}

interface Props {
  assetId: string
  symbol: string
  /** Lifted so the phone's bands and its Decision Memory share one scope. */
  portfolioId: string | null
  onSelectBook: (id: string | null) => void
  onOpenSubPage: (page: 'case' | 'decisions' | 'lists') => void
  onNavigate?: (result: any) => void
}

export function MobileInvestmentSnapshot({
  assetId, symbol, portfolioId, onSelectBook, onOpenSubPage,
}: Props) {
  const { data, isLoading } = useAssetWorkspace(assetId, symbol, 'overview')
  /*
   * The rating, which the phone did not show at all.
   *
   * A second query, and a deliberate one: the headline conclusion on desktop
   * is a rating, and a phone that omits it answers a different question about
   * the same name. It is the same hook and the same React Query key the Case
   * tab's rating field already uses, so on this page it is usually a cache
   * read rather than a round trip.
   */
  const { consensus, ratings } = useAnalystRatings({ assetId })

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="mobile-snapshot-loading">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-3"
          >
            <div className="h-2.5 w-20 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
            <div className="mt-2 h-4 w-2/3 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  const position = primaryPosition(data.positions, portfolioId)
  const others = otherPositions(data.positions, position)
  const held = data.positions.length > 0

  /*
   * Books come from this asset's own positions — the RLS-scoped set in which
   * it actually appears. Offering a book with no exposure would be offering
   * an empty filter, and `BookFilter` renders nothing at one book or fewer.
   */
  const books = data.positions.map(p => ({
    id: p.portfolioId,
    name: p.portfolioName,
    badge: 'held',
  }))

  /* ── Position ───────────────────────────────────────────────────────── */
  /*
   * Value and P&L, because the conclusion above already states the WEIGHT.
   *
   * This led on "2.5% of Tech & Consumer Growth" and the band directly above
   * it now says "2.55%" under Our exposure — the same number at two
   * precisions, which reads as two different figures. The weight is the
   * conclusion's; what this band adds is what the stake is worth and what it
   * has done. Shares remain the fallback when no market value is derivable,
   * and both stay in the detail rows below.
   */
  const positionHeadline = held && position ? (
    <div className="flex items-baseline gap-2 flex-wrap">
      <span className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">
        {usd(position.marketValue) ?? shares(position.shares) ?? '—'}
      </span>
      <span className="text-[12px] text-gray-500 dark:text-gray-400 truncate">
        {position.marketValue != null ? 'in' : 'shares in'} {position.portfolioName}
      </span>
      {position.unrealisedPct != null && (
        <span className={clsx(
          'text-[12px] font-semibold tabular-nums',
          position.unrealisedPct >= 0
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-red-600 dark:text-red-400',
        )}>
          {position.unrealisedPct >= 0 ? '+' : ''}{position.unrealisedPct.toFixed(1)}%
        </span>
      )}
    </div>
  ) : (
    <p className="text-[13px] text-gray-600 dark:text-gray-400" data-testid="mobile-snapshot-unheld">
      Not held in any book you can see.
    </p>
  )

  /* ── Belief ─────────────────────────────────────────────────────────── */
  const core = data.sections.filter(s => data.coreSections.includes(s.section))
  const written = core.filter(s => (s.content ?? '').trim().length > 0)
  /*
   * The thesis, not the target.
   *
   * This headline used to be "$268 target +16%" — which the conclusion band
   * directly above now states, to one more decimal place. Two figures for one
   * fact, eight millimetres apart, and a reader cannot tell whether they are
   * one record or two. The band owns the valuation; this band owns the
   * ARGUMENT, which is what "Belief" was always supposed to mean and what the
   * desktop's "The case" says.
   */
  const thesisRow = core.find(s => s.section === 'thesis' && (s.content ?? '').trim())
  const beliefHeadline = thesisRow ? (
    <p className="text-[13px] leading-snug text-gray-700 dark:text-gray-300">
      {ourViewExcerpt(thesisRow.content, 130)}
    </p>
  ) : (
    <p className="text-[13px] text-gray-600 dark:text-gray-400">
      {written.length > 0
        ? `No thesis written. ${written.length} of ${core.length} sections have content.`
        : 'No investment case has been written.'}
    </p>
  )

  /* ── Active Work ────────────────────────────────────────────────────── */
  /*
   * Live ideas are NOT filtered by book.
   *
   * `AssetLiveIdea` carries `portfolioName` and no `portfolioId`, so there is
   * no id to match a selected book against. Filtering on the name would be a
   * guess that breaks the moment two books share a name across orgs, and
   * dropping ideas on a guess is worse than showing all of them. The count is
   * labelled "across all books" when a book is selected so the reader is not
   * told these are scoped when they are not.
   */
  const liveIdeas = data.liveIdeas
  const openDecisions = (portfolioId
    ? data.decisions.filter(d => d.portfolioId === portfolioId)
    : data.decisions
  ).filter(d => d.decidedAt == null)

  const activeHeadline = liveIdeas.length === 0 && openDecisions.length === 0 ? (
    <p className="text-[13px] text-gray-600 dark:text-gray-400">Nothing in flight.</p>
  ) : (
    <p className="text-[13px] font-medium text-gray-900 dark:text-gray-100">
      {[
        liveIdeas.length > 0
          && `${liveIdeas.length} open ${liveIdeas.length === 1 ? 'idea' : 'ideas'}`
            + (portfolioId ? ' across all books' : ''),
        openDecisions.length > 0 && `${openDecisions.length} awaiting a decision`,
      ].filter(Boolean).join(' · ')}
    </p>
  )

  /* ── The conclusion, first ──────────────────────────────────────────── */
  /*
   * Desktop now opens with rating, target, bear/bull and exposure, then the
   * differentiated view. The phone opened with Position and reduced the whole
   * belief to "$268 target +16%" — no rating, no range, no edge — so the two
   * shells answered different questions about the same name.
   *
   * The ORDER note above this file argued the phone reader wants "what do we
   * own" first. That is still true and it is still first INSIDE the
   * conclusion: exposure is one of the four figures. What changed is that the
   * other three are no longer three taps away. A 2x2 grid is the layout a
   * thumb can read; the arithmetic behind it is imported, not recomputed.
   */
  const figures = conclusionFigures({ target: data.target, spot: data.spot, ladder: data.ladder })
  const variant = core.find(s => s.section === 'where_different' && (s.content ?? '').trim())
  const dominant = consensus[0] ?? null

  /*
   * What needs attention, from the same resolver the desktop uses.
   *
   * ── The one signal this surface must NOT emit ──
   *
   * `gap-no-coverage` fires when `coveringUserIds` is empty and work exists.
   * The phone does not fetch coverage — `MobileAssetPage` has no coverage
   * query — so passing an empty array here would make every name on every
   * phone claim "nobody is assigned coverage", which is a false statement
   * derived from absent data rather than from a record.
   *
   * So the facts carry empty coverage and the signal is filtered out, and
   * both halves are stated here rather than left for a reader to infer from
   * a missing query. Adding a coverage read to the phone would fix it
   * properly; that is a deliberate scope call, not an oversight.
   *
   * The execution counts are likewise zero, so `provenance` cannot fire here
   * either: deriving them needs the decision-timeline hook, and this
   * component does not call it — `DecisionMemorySummary` does, one band
   * below, and that band already states the caveat from its own counts.
   * Passing zeros is therefore both honest and sufficient; it is not a
   * placeholder waiting to be filled.
   */
  const workspaceFacts: WorkspaceFacts = {
    symbol,
    positions: data.positions.map(p => ({
      portfolioId: p.portfolioId, portfolioName: p.portfolioName, weightPct: p.weightPct ?? null,
    })),
    coveringUserIds: [],
    caseWrittenAt: data.caseWrittenAt,
    writtenSections: core.map(s => ({ section: s.section, updatedAt: s.updatedAt ?? null })),
    rating: dominant ? { value: dominant.value, count: dominant.count, total: ratings.length } : null,
    target: data.target,
    spot: data.spot,
    newEvidenceCount: 0,
    openDecisions: openDecisions.map(d => ({
      id: d.id, action: d.action ?? null,
      portfolioId: d.portfolioId ?? null, portfolioName: d.portfolioName ?? null,
    })),
    liveIdeaCount: liveIdeas.length,
    unobservedExecutionCount: 0,
    executionCount: 0,
    viewerId: null,
    arrivalIntent: null,
  }
  const workspaceState = resolveWorkspaceState(workspaceFacts)
  const workspaceSignals = resolveWorkspaceSignals(workspaceFacts)
    .filter(s => s.id !== 'gap-no-coverage')

  const conclusion = (
    <div
      data-testid="mobile-conclusion"
      className="rounded-xl border border-gray-200 bg-white px-3.5 py-3 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        <MobileFigure
          label="Our rating"
          value={dominant?.value ?? null}
          sub={dominant ? `${dominant.count} of ${ratings.length}` : 'Not rated'}
        />
        <MobileFigure
          label="Target"
          value={data.target != null ? usd(data.target) : null}
          sub={figures.upside != null ? `${figures.upside >= 0 ? '+' : ''}${figures.upside.toFixed(1)}% to spot` : 'No spot'}
        />
        <MobileFigure
          label="Bear / bull"
          value={figures.bear != null && figures.bull != null
            ? `${usd(figures.bear)} – ${usd(figures.bull)}` : null}
          sub={figures.downside != null && figures.upsideBull != null
            ? `${figures.downside.toFixed(0)}% / +${figures.upsideBull.toFixed(0)}%`
              + (figures.skew != null ? ` · ${figures.skew.toFixed(1)}:1` : '')
            : 'Needs both cases'}
        />
        <MobileFigure
          label="Our exposure"
          value={position?.weightPct != null ? `${position.weightPct.toFixed(2)}%`
            : position ? 'Held' : 'Not held'}
          sub={position ? position.portfolioName : undefined}
        />
      </div>

      {variant && (
        <button
          type="button"
          onClick={() => onOpenSubPage('case')}
          data-testid="mobile-conclusion-variant"
          className="mt-3 w-full border-t border-gray-200/70 pt-2.5 text-left dark:border-white/[0.07]"
        >
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Where we differ
          </span>
          {/* Verbatim, through the helper both shells share. */}
          <p className="mt-1 text-[13px] leading-snug text-gray-700 dark:text-gray-300">
            {ourViewExcerpt(variant.content, 150)}
          </p>
        </button>
      )}
    </div>
  )

  return (
    <div className="space-y-2" data-testid="mobile-snapshot">
      {/*
        * The book selector sits at the TOP, above every band, because it
        * scopes all of them. Putting it inside Position would imply it only
        * filtered that one.
        */}
      {books.length > 1 && (
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">Scope</span>
          <BookFilter
            books={books}
            portfolioId={portfolioId}
            onSelect={onSelectBook}
            allLabel="All portfolios"
            testId="mobile-snapshot-book-filter"
            compact
          />
        </div>
      )}

      {conclusion}

      {/* Same resolver, same signals, same words as the desktop band. */}
      {workspaceSignals.length > 0 && (
        <AttentionBand
          state={workspaceState}
          signals={workspaceSignals}
          onOpen={(page) => {
            if (page === 'decisions' || page === 'lists') onOpenSubPage(page)
            else if (page === 'research' || page === 'workflow') onOpenSubPage('case')
          }}
        />
      )}

      <Band
        testId="mobile-band-position"
        title={held ? (portfolioId ? 'Position' : 'Largest position') : 'Position'}
        icon={Briefcase}
        headline={positionHeadline}
        defaultOpen={false}
        action={held ? { label: 'Open books & lists', onClick: () => onOpenSubPage('lists') } : undefined}
      >
        {position && (
          <>
            <Row label="Shares" value={shares(position.shares)} />
            <Row label="Market value" value={usd(position.marketValue)} />
            <Row label="Average cost" value={usd(position.avgCost)} />
            <Row
              label="Unrealised"
              value={usd(position.unrealisedGain)}
              sub={position.unrealisedPct != null ? `${position.unrealisedPct.toFixed(1)}%` : null}
            />
            {others.length > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                  Also held in {others.length} {others.length === 1 ? 'book' : 'books'}
                </p>
                {others.slice(0, 4).map(o => (
                  <Row key={o.portfolioId} label={o.portfolioName} value={pct(o.weightPct) ?? shares(o.shares)} />
                ))}
              </div>
            )}
          </>
        )}
      </Band>

      <Band
        testId="mobile-band-belief"
        title="Belief"
        icon={FileText}
        headline={beliefHeadline}
        action={{ label: 'Open the case', onClick: () => onOpenSubPage('case') }}
      >
        {written.length > 0 ? (
          <>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
              {written.length} of {core.length} core {core.length === 1 ? 'section' : 'sections'} written
            </p>
            {written.slice(0, 3).map(s => (
              <div key={s.section} className="py-1">
                <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 capitalize">
                  {s.section.replace(/_/g, ' ')}
                </p>
                <p className="text-[12px] text-gray-600 dark:text-gray-400 line-clamp-2">
                  {(s.content ?? '').trim()}
                </p>
              </div>
            ))}
          </>
        ) : (
          <p className="text-[12px] text-gray-600 dark:text-gray-400">
            No case has been written for {symbol} yet.
          </p>
        )}
      </Band>

      <Band
        testId="mobile-band-active"
        title="Active work"
        icon={Activity}
        headline={activeHeadline}
        action={{ label: 'Open decisions', onClick: () => onOpenSubPage('decisions') }}
      >
        {liveIdeas.slice(0, 5).map(i => (
          <Row key={i.id} label={i.action ?? 'Idea'} value={i.portfolioName ?? null} />
        ))}
        {openDecisions.slice(0, 5).map(d => (
          <Row key={d.id} label={d.action ?? 'Decision request'} value={d.portfolioName ?? null} />
        ))}
      </Band>

      {/*
        * Decision Memory: the SAME component the desktop Snapshot uses, so
        * the phone cannot report a different state of play. Compact mode only
        * changes type sizes and tap targets.
        */}
      <Band
        testId="mobile-band-memory"
        title="Decision memory"
        icon={Scale}
        headline={
          <DecisionMemorySummary
            assetId={assetId}
            portfolioId={portfolioId}
            symbol={symbol}
            heldBookIds={data.positions.map(p => p.portfolioId)}
            compact
          />
        }
        action={{ label: 'See the full history', onClick: () => onOpenSubPage('decisions') }}
      />
    </div>
  )
}
