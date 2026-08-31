/**
 * Desktop Decisions — the memory workspace.
 *
 * Scan the history, open one decision, keep the rest beside you. Same shape as
 * Ideas, Research and Portfolio, for the same reason: reading one record should
 * never cost you the list.
 *
 * ── This is a memory surface, not a queue ────────────────────────────────
 *
 * Ordered by when things were decided, newest first. No tier, no score, no
 * "worth revisiting" ranking — Today already answers what deserves attention,
 * and turning history into a second priority list would make the past
 * something to work through rather than something to consult.
 *
 * ── Terminal records are the content ─────────────────────────────────────
 *
 * Accepted, declined and withdrawn decisions are exactly what belongs here.
 * The active-work filters that Ideas and Today apply would empty this page.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, Landmark } from 'lucide-react'
import { askAI } from '../../lib/engagement'
import {
  useDecisionScan, usePortfoliosWithDecisions, useDecisionDetail,
} from '../../hooks/useDesktopDecisions'
import {
  outcomeOf, OUTCOME_LABEL, summaryOf, provenanceOf,
  compareDecisions, daysSince, targetFor,
  type DecisionRecord,
} from '../../lib/desktop-decisions/model'
import { DecisionDetailPane } from './DecisionDetail'
import { OUTCOME_CHIP } from './DecisionVisual'

export interface DecisionsWorkspaceProps {
  selectedPortfolioId?: string | null
  selectedDecisionId?: string | null
}

export function DecisionsWorkspace({
  selectedPortfolioId, selectedDecisionId,
}: DecisionsWorkspaceProps = {}) {
  // The scan is unfiltered by book so the portfolio list can be built from the
  // decisions that actually exist; filtering happens in memory afterward.
  const { decisions, isLoading, error } = useDecisionScan(null)
  const books = usePortfoliosWithDecisions(decisions)

  const [portfolioId, setPortfolioId] = useState<string | null>(selectedPortfolioId ?? null)
  const [decisionId, setDecisionId] = useState<string | null>(selectedDecisionId ?? null)

  useEffect(() => { if (selectedPortfolioId) setPortfolioId(selectedPortfolioId) }, [selectedPortfolioId])
  useEffect(() => { if (selectedDecisionId) setDecisionId(selectedDecisionId) }, [selectedDecisionId])

  const rows = useMemo(
    () => decisions
      .filter(d => !portfolioId || d.portfolioId === portfolioId)
      .slice()
      .sort(compareDecisions),
    [decisions, portfolioId],
  )

  const selected = rows.find(d => d.id === decisionId) ?? null
  const { detail } = useDecisionDetail(selected)

  // Narrowing the book must not leave a decision from another one open.
  const selectBook = (id: string | null) => { setPortfolioId(id); setDecisionId(null) }

  if (isLoading) return <Loading />
  if (error || !decisions.length) {
    return (
      <div className="h-full overflow-y-auto bg-gray-50/60 dark:bg-[#0b0f16]">
        <Header books={books} portfolioId={null} rows={[]} onSelect={selectBook} />
        {/* A failed read and an empty history look identical to a reader, and
            they are opposite problems. The failure is named rather than
            rendered as "nothing has ever been decided". */}
        {error ? <Failed message={error.message} /> : <Empty />}
      </div>
    )
  }

  if (!selected) {
    return (
      <div className="h-full overflow-y-auto bg-gray-50/60 pb-12 dark:bg-[#0b0f16]">
        <Header books={books} portfolioId={portfolioId} rows={rows} onSelect={selectBook} />
        <div className="grid grid-cols-1 gap-3.5 px-6 pt-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(d => (
            <ScanCard key={d.id} decision={d} onOpen={() => setDecisionId(d.id)} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden bg-gray-50/60 dark:bg-[#0b0f16]">
      <aside className="h-full w-[28%] min-w-[260px] shrink-0 overflow-y-auto border-r border-gray-200 px-3 py-3 dark:border-white/10">
        <div className="mb-2 flex items-center gap-2 px-1">
          <BookFilter books={books} portfolioId={portfolioId} onSelect={selectBook} compact />
          <span className="font-mono text-[10.5px] text-gray-500">{rows.length}</span>
          <button
            type="button"
            onClick={() => setDecisionId(null)}
            className="ml-auto rounded-md px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
          >
            All decisions
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {rows.map(d => (
            <NavCard
              key={d.id}
              decision={d}
              selected={d.id === selected.id}
              onSelect={() => setDecisionId(d.id)}
            />
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <DecisionDetailPane decision={selected} detail={detail} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ header */

function Header({
  books, portfolioId, rows, onSelect,
}: {
  books: { id: string; name: string; count: number }[]
  portfolioId: string | null
  rows: DecisionRecord[]
  onSelect: (id: string | null) => void
}) {
  const resolved = rows.filter(d => outcomeOf(d.status) !== 'open')
  const withReason = rows.filter(d => provenanceOf(d.decisionNote) === 'human' || d.contextNote?.trim())
  const executed = rows.filter(d => d.execution?.completedAt)

  return (
    <header className="px-6 pt-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h1 className="text-[21px] font-semibold tracking-tight">Decisions</h1>
        <BookFilter books={books} portfolioId={portfolioId} onSelect={onSelect} />
      </div>

      <p className="mt-1.5 max-w-[70ch] text-[12.5px] text-gray-600 dark:text-gray-400">
        What was decided, by whom, and what followed. Newest first — this is a
        record to consult, not a queue to work through.
      </p>

      {rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[11.5px] text-gray-500">
          <span>
            <strong className="font-semibold text-gray-800 dark:text-gray-200">{resolved.length}</strong>{' '}
            resolved decision{resolved.length === 1 ? '' : 's'}
          </span>
          <span>
            <strong className="font-semibold text-gray-800 dark:text-gray-200">{executed.length}</strong> executed
          </span>
          {/* Stated because it is the honest measure of how much reasoning this
              history actually preserves, and it is currently low. */}
          <span>
            <strong className="font-semibold text-gray-800 dark:text-gray-200">{withReason.length}</strong>{' '}
            carry a written reason
          </span>
        </div>
      )}
    </header>
  )
}

function BookFilter({
  books, portfolioId, onSelect, compact,
}: {
  books: { id: string; name: string; count: number }[]
  portfolioId: string | null
  onSelect: (id: string | null) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  // One book that has decisions is not a choice worth a control.
  if (books.length <= 1) {
    const only = books[0]?.name
    return only
      ? <span className={clsx('truncate text-gray-500', compact ? 'text-[12px] font-semibold' : 'text-[12.5px]')}>{only}</span>
      : null
  }

  const current = books.find(b => b.id === portfolioId)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={clsx(
          'flex min-w-0 items-center gap-1 rounded-md border border-gray-300 hover:bg-gray-100 dark:border-white/15 dark:hover:bg-white/[0.06]',
          compact ? 'px-1.5 py-0.5 text-[11px] font-semibold' : 'px-2 py-1 text-[11.5px]',
        )}
      >
        <span className="min-w-0 truncate">{current?.name ?? 'All portfolios'}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-gray-500" />
      </button>
      {open && (
        <div role="listbox"
             className="absolute left-0 top-full z-20 mt-1 max-h-[60vh] w-60 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-[#141a25]">
          <button type="button" role="option" aria-selected={!portfolioId}
                  onClick={() => { onSelect(null); setOpen(false) }}
                  className={clsx('block w-full px-3 py-1.5 text-left text-[12.5px]',
                    !portfolioId ? 'bg-blue-50 font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                                 : 'hover:bg-gray-100 dark:hover:bg-white/[0.06]')}>
            All portfolios
          </button>
          {books.map(b => (
            <button key={b.id} type="button" role="option" aria-selected={b.id === portfolioId}
                    onClick={() => { onSelect(b.id); setOpen(false) }}
                    className={clsx('flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[12.5px]',
                      b.id === portfolioId ? 'bg-blue-50 font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                                           : 'hover:bg-gray-100 dark:hover:bg-white/[0.06]')}>
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              <span className="font-mono text-[10.5px] text-gray-500">{b.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- cards */

function OutcomeChip({ decision, small }: { decision: DecisionRecord; small?: boolean }) {
  const kind = outcomeOf(decision.status)
  return (
    <span className={clsx(
      'rounded-full border font-bold uppercase tracking-[0.06em]',
      small ? 'px-1.5 py-[1px] text-[9px]' : 'px-2 py-[3px] text-[10px]',
      OUTCOME_CHIP[kind],
    )}>
      {OUTCOME_LABEL[kind]}
    </span>
  )
}

function ScanCard({ decision, onOpen }: { decision: DecisionRecord; onOpen: () => void }) {
  const d = decision
  const when = daysSince(d.decidedAt ?? d.requestedAt)
  const target = targetFor(d)
  const prov = provenanceOf(d.decisionNote)

  return (
    <article
      data-testid="decision-card"
      data-outcome={outcomeOf(d.status)}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-white/[0.08] dark:bg-[#141a25]"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200/80 bg-gray-50/80 px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.03]">
        <OutcomeChip decision={d} />
        {d.action && (
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.06em] text-gray-500">
            {d.action}
          </span>
        )}
        <span className="ml-auto font-mono text-[10.5px] text-gray-500">
          {when != null ? `${when}d ago` : '—'}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 px-3.5 pt-2.5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="font-black text-[22px] leading-[1.05] tracking-[-0.035em]">
            {d.symbol ?? '—'}
          </span>
          {d.portfolioName && (
            <span className="min-w-0 truncate text-[12px] font-medium text-gray-500">{d.portfolioName}</span>
          )}
        </div>

        <p className="text-[12.5px] leading-snug text-gray-700 dark:text-gray-300">{summaryOf(d)}</p>

        {/* Only a reason a person wrote is quoted here. System provenance
            strings are not reasoning and are not shown on the card. */}
        {prov === 'human' && d.decisionNote && (
          <blockquote className="border-l-2 border-gray-300 pl-2.5 text-[12px] italic leading-snug text-gray-600 dark:border-white/20 dark:text-gray-400">
            “{d.decisionNote}”
          </blockquote>
        )}
        {prov !== 'human' && d.contextNote?.trim() && (
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500">Proposed because</div>
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-gray-600 dark:text-gray-400">
              {d.contextNote}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[10.5px] text-gray-500">
          {d.decidedByName && <span>{d.decidedByName}</span>}
          {d.decidedAt && <span>{new Date(d.decidedAt).toLocaleDateString()}</span>}
          {d.execution?.completedAt && (
            <span className="font-semibold text-gray-700 dark:text-gray-300">Executed</span>
          )}
          {outcomeOf(d.status) === 'accepted' && !d.execution && (
            <span>No execution recorded</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 px-3.5 pb-2.5 pt-2.5">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 px-3.5 py-2 text-[12.5px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800"
        >
          Revisit this decision
        </button>
        {target && (
          <button
            type="button"
            onClick={() => askAI(target)}
            className="inline-flex items-baseline gap-1.5 rounded-md px-2.5 py-2 text-[12px] text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
          >
            Ask AI
            <span className="font-mono text-[10.5px] opacity-75">{target.contextChips?.length ?? 0}</span>
          </button>
        )}
      </div>
    </article>
  )
}

function NavCard({
  decision, selected, onSelect,
}: { decision: DecisionRecord; selected: boolean; onSelect: () => void }) {
  const d = decision
  const when = daysSince(d.decidedAt ?? d.requestedAt)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected && ref.current && typeof ref.current.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  return (
    <div
      ref={ref}
      data-testid="decision-nav-card"
      role="button"
      tabIndex={0}
      aria-current={selected}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={clsx(
        // flex:none — the navigator is a flex column and default shrink would
        // crush every card to its chrome band.
        'flex-none cursor-pointer overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-[#141a25]',
        selected
          ? 'border-blue-600 shadow-[0_0_0_1px_theme(colors.blue.600)]'
          : 'border-gray-200 hover:shadow-md dark:border-white/[0.08]',
      )}
    >
      <div className={clsx(
        'flex items-center gap-1.5 border-b px-2.5 py-1.5',
        selected
          ? 'border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/30'
          : 'border-gray-200/80 bg-gray-50/80 dark:border-white/10 dark:bg-white/[0.03]',
      )}>
        <span className="font-mono text-[13px] font-bold tracking-tight">{d.symbol ?? '—'}</span>
        {d.action && (
          <span className="font-mono text-[9.5px] font-bold uppercase text-gray-500">{d.action}</span>
        )}
        <span className="ml-auto font-mono text-[10px] text-gray-500">
          {when != null ? `${when}d` : '—'}
        </span>
      </div>
      <div className="flex flex-col items-start gap-1 px-2.5 py-2">
        <OutcomeChip decision={d} small />
        <span className="min-w-0 max-w-full truncate text-[10.5px] text-gray-500">
          {d.portfolioName ?? '—'}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ states */

function Loading() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
      <div className="h-8 w-40 animate-pulse rounded bg-gray-200 dark:bg-white/10" />
      <div className="mt-5 grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-48 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-[#141a25]" />
        ))}
      </div>
    </div>
  )
}

function Failed({ message }: { message: string }) {
  return (
    <div className="mx-6 mt-4 rounded-xl border border-rose-200 bg-white px-6 py-12 text-center shadow-sm dark:border-rose-900/50 dark:bg-[#141a25]">
      <h2 className="text-[16px] font-semibold text-rose-700 dark:text-rose-400">
        The decision history could not be loaded
      </h2>
      <p className="mx-auto mt-1.5 max-w-[52ch] text-[12px] text-gray-600 dark:text-gray-400">
        This is a read failure, not an empty history.
      </p>
      <p className="mx-auto mt-2 max-w-[60ch] font-mono text-[11px] text-gray-500">{message}</p>
    </div>
  )
}

function Empty() {
  return (
    <div className="mx-6 mt-4 rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm dark:border-white/[0.08] dark:bg-[#141a25]">
      <Landmark className="mx-auto h-7 w-7 text-gray-400" />
      <h2 className="mt-4 text-[17px] font-semibold">No decisions on record yet</h2>
      <p className="mx-auto mt-1.5 max-w-[46ch] text-[12.5px] text-gray-600 dark:text-gray-400">
        A decision appears here once someone accepts, declines or defers a
        request against a portfolio.
      </p>
    </div>
  )
}
