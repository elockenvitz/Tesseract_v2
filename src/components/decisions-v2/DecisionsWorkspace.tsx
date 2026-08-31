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
import {
  useDecisionScan, usePortfoliosWithDecisions, useDecisionDetail,
} from '../../hooks/useDesktopDecisions'
import {
  outcomeOf, OUTCOME_LABEL, provenanceOf, summaryOf, compareDecisions, daysSince,
  type DecisionRecord,
} from '../../lib/desktop-decisions/model'
import { DecisionDetailPane } from './DecisionDetail'
import {
  DesktopScanBand, DesktopTile, TileIdentity, TileReason, TileMeta, TileFigure,
} from '../desktop/DesktopTile'
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

  // The newest decision, when nothing is chosen. Deterministic: `rows` is
  // already sorted newest-first with an id tiebreak, so the same book always
  // opens on the same record.
  //
  // Entry goes straight into the memory workspace. A grid of near-identical
  // cards, each repeating "Revisit this decision", read as an inbox to work
  // through -- exactly the mental model this surface must not have.
  const selected = rows.find(d => d.id === decisionId) ?? rows[0] ?? null

  const { detail } = useDecisionDetail(selected)

  // Narrowing the book re-anchors on that book's newest decision rather than
  // stranding the reader on one from a book they just filtered out.
  const selectBook = (id: string | null) => { setPortfolioId(id); setDecisionId(null) }

  if (isLoading) return <Loading />
  if (error || !rows.length) {
    return (
      <div className="h-full overflow-y-auto bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
        <h1 className="text-[21px] font-semibold tracking-tight">Decisions</h1>
        {/* A failed read and an empty history look identical to a reader, and
            they are opposite problems. The failure is named rather than
            rendered as "nothing has ever been decided". */}
        {error ? <Failed message={error.message} /> : <Empty />}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-50/60 dark:bg-[#0b0f16]">
      <DesktopScanBand
        title="Decisions"
        count={rows.length}
        action={<BookFilter books={books} portfolioId={portfolioId} onSelect={selectBook} compact />}
      >
        {rows.map(d => (
          <DecisionTile
            key={d.id}
            decision={d}
            selected={d.id === selected.id}
            onSelect={() => setDecisionId(d.id)}
          />
        ))}
      </DesktopScanBand>

      <div className="shrink-0 border-b border-gray-200 px-6 py-1.5 dark:border-white/10">
        <Metrics rows={rows} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DecisionDetailPane decision={selected} detail={detail} />
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- metrics */

/**
 * What this history actually preserves.
 *
 * The first version read "22 carry a written reason", which fused two very
 * different things: 22 decisions have a `context_note` written by the person
 * who PROPOSED the trade, and exactly ONE has a rationale written by the person
 * who DECIDED it. Reporting them together made the record look four times
 * healthier than it is, on the one number whose whole job is to say how much
 * reasoning survives.
 *
 * They are now counted and named separately, and neither is called a "written
 * reason".
 */
function Metrics({ rows }: { rows: DecisionRecord[] }) {
  const resolved = rows.filter(d => outcomeOf(d.status) !== 'open').length
  const executed = rows.filter(d => d.execution?.completedAt).length
  // Human decision rationale: written by the decider, at decision time.
  const rationale = rows.filter(d => provenanceOf(d.decisionNote) === 'human').length
  // Submission context: written by the requester, before anyone decided.
  const context = rows.filter(d => !!d.contextNote?.trim()).length

  if (!rows.length) return null

  return (
    <dl className="mt-2 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[10.5px] text-gray-500">
      <Metric n={resolved} label="resolved" />
      <Metric n={executed} label="executed" />
      <Metric n={rationale} label={`decision rationale${rationale === 1 ? '' : 's'}`} />
      {context > 0 && <Metric n={context} label="with submission context" />}
    </dl>
  )
}

function Metric({ n, label }: { n: number; label: string }) {
  return (
    <div data-testid="decision-metric" className="flex items-baseline gap-1">
      <dt className="sr-only">{label}</dt>
      <dd className="font-mono text-[11.5px] font-semibold text-gray-800 dark:text-gray-200">{n}</dd>
      <span>{label}</span>
    </div>
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

/* ------------------------------------------------------------------- index */

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


/**
 * One line of the index.
 *
 * No button. Selecting IS revisiting, and a "Revisit this decision" control
 * repeated eighty-three times down a column is what made the first version
 * read as a queue of work rather than a record.
 */
/**
 * One decision in the scan.
 *
 * Outcome, action and age carry the identity; the summary says what happened
 * without judging it. A rationale somebody actually wrote is quoted here,
 * because it is the rarest and most valuable thing this history holds -- one
 * decision in eighty-three has one, and a scan that hides it wastes it.
 *
 * The month grouping the rail carried is dropped: a grid does not read as a
 * chronology, and a heading over every second tile would be noise. The age on
 * each tile does that work, and the order is still newest first.
 */
function DecisionTile({
  decision, selected, onSelect,
}: { decision: DecisionRecord; selected: boolean; onSelect: () => void }) {
  const d = decision
  const when = daysSince(d.decidedAt ?? d.requestedAt)
  const humanReason = provenanceOf(d.decisionNote) === 'human' ? d.decisionNote : null

  return (
    <DesktopTile
      testId="decision-tile"
      dataAttrs={{ 'data-outcome': outcomeOf(d.status) }}
      selected={selected}
      onSelect={onSelect}
      eyebrow={<>
        <OutcomeChip decision={d} small />
        {d.action && (
          <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.06em] text-gray-500">
            {d.action}
          </span>
        )}
        <TileFigure>{when != null ? `${when}d ago` : '—'}</TileFigure>
      </>}
    >
      <TileIdentity symbol={d.symbol} name={d.companyName} />
      {humanReason ? (
        <blockquote className="line-clamp-2 border-l-2 border-gray-300 pl-2 text-[11.5px] italic leading-snug text-gray-700 dark:border-white/20 dark:text-gray-300">
          “{humanReason}”
        </blockquote>
      ) : (
        <TileReason>{summaryOf(d)}</TileReason>
      )}
      <TileMeta>
        <span className="font-medium text-gray-600 dark:text-gray-400">{d.portfolioName ?? '—'}</span>
        {d.decidedByName && <span>{d.decidedByName}</span>}
        {d.execution?.completedAt && (
          <span className="font-semibold text-gray-700 dark:text-gray-300">Executed</span>
        )}
      </TileMeta>
    </DesktopTile>
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
    <div className="mt-4 rounded-xl border border-rose-200 bg-white px-6 py-12 text-center shadow-sm dark:border-rose-900/50 dark:bg-[#141a25]">
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
    <div className="mt-4 rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm dark:border-white/[0.08] dark:bg-[#141a25]">
      <Landmark className="mx-auto h-7 w-7 text-gray-400" />
      <h2 className="mt-4 text-[17px] font-semibold">No decisions on record yet</h2>
      <p className="mx-auto mt-1.5 max-w-[46ch] text-[12.5px] text-gray-600 dark:text-gray-400">
        A decision appears here once someone accepts, declines or defers a
        request against a portfolio.
      </p>
    </div>
  )
}
