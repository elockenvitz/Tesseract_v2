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
 * Position, then Belief, then Active Work, then Decision Memory. Desktop
 * leads with Belief because the reader has the whole page at once. On a phone
 * the first band is the only one guaranteed to be seen, and the question that
 * brings someone to an asset on their phone is "what do we own and what is
 * happening to it" — the thesis is what they read once that is answered.
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import {
  ChevronRight, Briefcase, FileText, Activity, Scale, ChevronDown,
} from 'lucide-react'
import { useAssetWorkspace, primaryPosition, otherPositions } from '../../../hooks/useAssetWorkspace'
import { DecisionMemorySummary } from '../../asset/DecisionMemorySummary'
import { BookFilter } from '../../shared/BookFilter'

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
      <div className="px-3 pt-2.5 pb-2">
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

        <div className="mt-1">{headline}</div>
      </div>

      {collapsible && open && (
        <div
          className="px-3 pb-2.5 border-t border-gray-100 dark:border-gray-800 pt-2"
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
  const positionHeadline = held && position ? (
    <div className="flex items-baseline gap-2 flex-wrap">
      <span className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">
        {pct(position.weightPct) ?? shares(position.shares) ?? '—'}
      </span>
      <span className="text-[12px] text-gray-500 dark:text-gray-400 truncate">
        {position.weightPct != null ? 'of' : 'shares in'} {position.portfolioName}
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
  const beliefHeadline = (
    <div className="flex items-baseline gap-2 flex-wrap">
      {data.target != null ? (
        <>
          <span className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">
            {usd(data.target)}
          </span>
          <span className="text-[12px] text-gray-500 dark:text-gray-400">target</span>
          {data.spot != null && data.spot > 0 && (
            <span className={clsx(
              'text-[12px] font-semibold tabular-nums',
              data.target >= data.spot
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400',
            )}>
              {data.target >= data.spot ? '+' : ''}
              {(((data.target - data.spot) / data.spot) * 100).toFixed(0)}%
            </span>
          )}
        </>
      ) : (
        <span className="text-[13px] text-gray-600 dark:text-gray-400">No target set.</span>
      )}
    </div>
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

  return (
    <div className="space-y-3" data-testid="mobile-snapshot">
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

      <Band
        testId="mobile-band-position"
        title={held ? (portfolioId ? 'Position' : 'Largest position') : 'Position'}
        icon={Briefcase}
        headline={positionHeadline}
        defaultOpen={false}
        action={held ? { label: 'Open position detail', onClick: () => onOpenSubPage('lists') } : undefined}
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
            compact
          />
        }
        action={{ label: 'See the full history', onClick: () => onOpenSubPage('decisions') }}
      />
    </div>
  )
}
