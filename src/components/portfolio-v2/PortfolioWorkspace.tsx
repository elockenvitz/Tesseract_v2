/**
 * Desktop Portfolio — the book workspace.
 *
 * Portfolio-centred at the top, position-centred once you are working: pick a
 * book, scan it for places the framework has come apart, open a position, and
 * keep the rest of the book beside you while you read it.
 *
 * Portfolio owns no work. Every action it names is completed by the surface
 * that owns it -- Research for the case, Ideas V2 for the decision -- through
 * the typed seams those stages already established. There is no AI panel, no
 * chat system, no navigation registry and no attention engine here.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ArrowRight, Briefcase, ChevronDown } from 'lucide-react'
import { askAI } from '../../lib/engagement'
import {
  usePortfolioList, useBook, useBookFrames, usePositionDetail,
} from '../../hooks/useDesktopPortfolio'
import {
  gapOf, toneForGap, whyItMatters, primaryActionFor, targetFor, comparePositions,
  GAP_LABEL, EMPTY_FRAME, type PositionFrame,
} from '../../lib/desktop-portfolio/model'
import { TONE_PILL, type SemanticTone } from '../../lib/semantic-tone'
import type { Position } from '../../lib/portfolio/holdings'
import { PositionDetailPane } from './PositionDetail'
import { BookMap, WeightBar, bigMoney, type MapCell } from './PortfolioVisual'


export interface PortfolioWorkspaceProps {
  selectedPortfolioId?: string | null
  selectedAssetId?: string | null
}

export function PortfolioWorkspace({ selectedPortfolioId, selectedAssetId }: PortfolioWorkspaceProps = {}) {
  const { portfolios, isLoading: listLoading } = usePortfolioList()
  const [portfolioId, setPortfolioId] = useState<string | null>(selectedPortfolioId ?? null)
  const [assetId, setAssetId] = useState<string | null>(selectedAssetId ?? null)

  // Default to the first book only once the list is known, so the selector
  // does not flash a name and then replace it.
  useEffect(() => {
    if (!portfolioId && portfolios.length) setPortfolioId(portfolios[0].id)
  }, [portfolios, portfolioId])
  useEffect(() => { if (selectedPortfolioId) setPortfolioId(selectedPortfolioId) }, [selectedPortfolioId])
  useEffect(() => { if (selectedAssetId) setAssetId(selectedAssetId) }, [selectedAssetId])

  const portfolio = portfolios.find(p => p.id === portfolioId) ?? null
  const { book, isLoading: bookLoading } = useBook(portfolioId)
  const frames = useBookFrames(book)

  const rows = useMemo(() => {
    if (!book) return []
    return book.positions
      .map(position => ({ position, frame: frames[position.assetId] ?? EMPTY_FRAME }))
      .sort(comparePositions)
  }, [book, frames])

  const selected = rows.find(r => r.position.assetId === assetId) ?? null
  const { detail } = usePositionDetail(selected?.position ?? null)
  const maxWeight = rows[0] ? Math.max(...rows.map(r => r.position.weightPct)) : 0

  // Switching books must drop the selection: a position is (asset, portfolio),
  // and carrying the asset across would show one book's line under another
  // book's name.
  const selectBook = (id: string) => { setPortfolioId(id); setAssetId(null) }

  if (listLoading) return <Loading />
  if (!portfolios.length) return <Empty message="No portfolios are visible to you." />

  const header = (
    <BookHeader
      portfolios={portfolios}
      portfolio={portfolio}
      book={book}
      rows={rows}
      onSelect={selectBook}
    />
  )

  if (!selected) {
    return (
      <div className="h-full overflow-y-auto bg-gray-50/60 pb-12 dark:bg-[#0b0f16]">
        {header}
        {bookLoading ? <SkeletonGrid /> : !rows.length ? (
          <Empty message="This book has no holdings on record." />
        ) : (
          <div className="grid grid-cols-1 gap-3.5 px-6 pt-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map(r => (
              <ScanTile
                key={r.position.assetId}
                position={r.position}
                frame={r.frame}
                maxWeight={maxWeight}
                portfolioName={portfolio?.name}
                onOpen={() => setAssetId(r.position.assetId)}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden bg-gray-50/60 dark:bg-[#0b0f16]">
      <aside className="h-full w-[28%] min-w-[250px] shrink-0 overflow-y-auto border-r border-gray-200 px-3 py-3 dark:border-white/10">
        <div className="mb-2 flex items-center gap-2 px-1">
          <PortfolioSelector
            portfolios={portfolios}
            current={portfolio}
            onSelect={selectBook}
            compact
          />
          <span className="font-mono text-[10.5px] text-gray-500">{rows.length}</span>
          <button
            type="button"
            onClick={() => setAssetId(null)}
            className="ml-auto rounded-md px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
          >
            Full book
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {rows.map(r => (
            <NavTile
              key={r.position.assetId}
              position={r.position}
              frame={r.frame}
              selected={r.position.assetId === selected.position.assetId}
              onSelect={() => setAssetId(r.position.assetId)}
            />
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <PositionDetailPane
          position={selected.position}
          frame={selected.frame}
          detail={detail}
          portfolioName={portfolio?.name ?? null}
          role={portfolio?.role ?? null}
          maxWeight={maxWeight}
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ header */

function BookHeader({
  portfolios, portfolio, book, rows, onSelect,
}: {
  portfolios: { id: string; name: string; role: 'pm' | 'analyst' | null }[]
  portfolio: { id: string; name: string; role: 'pm' | 'analyst' | null } | null
  book: ReturnType<typeof useBook>['book']
  rows: { position: Position; frame: PositionFrame }[]
  onSelect: (id: string) => void
}) {
  // The old sentence collapsed "unwritten", "unreviewed" and "outside its own
  // case" into one number, which is the same flattening the colour made. Both
  // halves come off the rows already in hand -- no second pass, no new model.
  const weightOf = (tone: SemanticTone) => rows
    .filter(r => toneForGap(gapOf(r.position, r.frame)) === tone)
    .reduce((s, r) => s + r.position.weightPct, 0)
  const brokenWeight = weightOf('critical')
  const workWeight = weightOf('review')

  // Geometry from weight, colour from meaning. The two are independent, and
  // the map is the one place a reader sees both at once.
  const cells: MapCell[] = rows.map(r => ({
    key: r.position.assetId,
    label: r.position.symbol ?? '?',
    weightPct: r.position.weightPct,
    tone: toneForGap(gapOf(r.position, r.frame)),
  }))

  return (
    <header className="px-6 pt-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <PortfolioSelector portfolios={portfolios} current={portfolio} onSelect={onSelect} />
        {portfolio?.role && (
          <span className="rounded-full bg-gray-100 px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.06em] text-gray-600 dark:bg-white/10 dark:text-gray-300">
            {portfolio.role === 'pm' ? 'Portfolio manager' : 'Analyst'}
          </span>
        )}
      </div>

      <p className="mt-1.5 max-w-[70ch] text-[12.5px] text-gray-600 dark:text-gray-400">
        Where this book and the written framework disagree. Ordered by whether
        the disagreement is live, then by how much capital is behind it.
      </p>

      {book && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[11.5px] text-gray-500">
          {/* Market value, deliberately not called AUM: it is the sum of the
              priced lines in the newest upload, which is not the same thing as
              the fund's assets under management. */}
          <span>
            <strong className="font-mono text-[13px] font-semibold text-gray-800 dark:text-gray-200">
              {bigMoney(book.totalValue)}
            </strong>{' '}
            market value
          </span>
          <span>
            <strong className="font-semibold text-gray-800 dark:text-gray-200">{book.positionCount}</strong> positions
          </span>
          {book.cashValue > 0 && (
            <span>
              <strong className="font-semibold text-gray-800 dark:text-gray-200">{book.cashPct.toFixed(1)}%</strong> cash
            </span>
          )}
          {book.asOf && <span>as of {new Date(book.asOf).toLocaleDateString()}</span>}
        </div>
      )}

      {cells.length > 1 && (
        <div className="mt-4">
          <BookMap cells={cells} />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-gray-500">
            {workWeight > 0 && (
              <span>
                <strong className="font-semibold text-amber-700 dark:text-amber-400">
                  {workWeight.toFixed(1)}%
                </strong>{' '}
                needs framework work
              </span>
            )}
            {brokenWeight > 0 && (
              <span>
                <strong className="font-semibold text-rose-700 dark:text-rose-400">
                  {brokenWeight.toFixed(1)}%
                </strong>{' '}
                is trading outside its own case
              </span>
            )}
            {workWeight === 0 && brokenWeight === 0 && (
              <span>Every position in this book has a current framework.</span>
            )}
          </div>
        </div>
      )}
    </header>
  )
}

function PortfolioSelector({
  portfolios, current, onSelect, compact,
}: {
  portfolios: { id: string; name: string }[]
  current: { id: string; name: string } | null
  onSelect: (id: string) => void
  /** Navigator variant: same control, sized for the column header. */
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

  // One book is not a choice, so it does not get a control.
  if (portfolios.length <= 1) {
    return compact
      ? <h2 className="min-w-0 truncate text-[12px] font-semibold">{current?.name ?? 'Book'}</h2>
      : <h1 className="text-[21px] font-semibold tracking-tight">{current?.name ?? 'Portfolio'}</h1>
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={clsx(
          'flex min-w-0 items-center gap-1.5 rounded-lg font-semibold tracking-tight hover:bg-gray-100 dark:hover:bg-white/[0.06]',
          compact ? 'px-1 py-0.5 text-[12px]' : 'px-1.5 py-0.5 text-[21px]',
        )}
      >
        <span className="min-w-0 truncate">{current?.name ?? 'Select a portfolio'}</span>
        <ChevronDown className={clsx('shrink-0 text-gray-500', compact ? 'h-3 w-3' : 'h-4 w-4')} />
      </button>
      {open && (
        <div role="listbox"
             className="absolute left-0 top-full z-20 mt-1 max-h-[60vh] w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-[#141a25]">
          {portfolios.map(p => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={p.id === current?.id}
              onClick={() => { onSelect(p.id); setOpen(false) }}
              className={clsx(
                'block w-full truncate px-3 py-1.5 text-left text-[12.5px]',
                p.id === current?.id
                  ? 'bg-blue-50 font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                  : 'hover:bg-gray-100 dark:hover:bg-white/[0.06]',
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- tiles */

function ScanTile({
  position, frame, maxWeight, portfolioName, onOpen,
}: {
  position: Position; frame: PositionFrame; maxWeight: number
  portfolioName?: string; onOpen: () => void
}) {
  const gap = gapOf(position, frame)
  const target = position.isCash ? null : targetFor(position, frame, portfolioName)
  const action = primaryActionFor(position, frame)

  return (
    <article
      data-testid="position-tile"
      data-gap={gap}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-white/[0.08] dark:bg-[#141a25]"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200/80 bg-gray-50/80 px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.03]">
        <span className={clsx(
          'rounded-full border px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.06em]',
          TONE_PILL[toneForGap(gap)],
        )}>
          {GAP_LABEL[gap]}
        </span>
        <span className="ml-auto font-mono text-[10.5px] text-gray-500">{bigMoney(position.marketValue)}</span>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 px-3.5 pt-2.5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="font-black text-[22px] leading-[1.05] tracking-[-0.035em]">
            {position.symbol ?? '—'}
          </span>
          {position.companyName && (
            <span className="min-w-0 truncate text-[12px] font-medium text-gray-500">{position.companyName}</span>
          )}
        </div>

        <p className="text-[12.5px] leading-snug text-gray-700 dark:text-gray-300">
          {whyItMatters(position, frame)}
        </p>

        <WeightBar weightPct={position.weightPct} max={maxWeight} />
      </div>

      <div className="mt-2 px-3.5 text-[9px] font-bold uppercase tracking-[0.11em] text-gray-500">Next</div>
      <div className="flex flex-wrap items-center gap-1 px-3.5 pb-2.5 pt-1">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 px-3.5 py-2 text-[12.5px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800"
        >
          {action.label}
          <ArrowRight className="h-3.5 w-3.5 opacity-70" />
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

function NavTile({
  position, frame, selected, onSelect,
}: { position: Position; frame: PositionFrame; selected: boolean; onSelect: () => void }) {
  const gap = gapOf(position, frame)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected && ref.current && typeof ref.current.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  return (
    <div
      ref={ref}
      data-testid="position-nav-tile"
      role="button"
      tabIndex={0}
      aria-current={selected}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={clsx(
        // flex:none — the navigator is a flex column, and the default shrink
        // crushes every tile to its chrome band.
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
        <span className="font-mono text-[13px] font-bold tracking-tight">{position.symbol ?? '—'}</span>
        <span className="ml-auto font-mono text-[11px] font-semibold tabular-nums">
          {position.weightPct.toFixed(1)}%
        </span>
      </div>
      <div className="px-2.5 py-2">
        <span className={clsx(
          'rounded-full border px-2 py-[2px] text-[9.5px] font-semibold uppercase tracking-[0.05em]',
          TONE_PILL[toneForGap(gap)],
        )}>
          {GAP_LABEL[gap]}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ states */

function Loading() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
      <div className="h-8 w-52 animate-pulse rounded bg-gray-200 dark:bg-white/10" />
      <SkeletonGrid />
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-3.5 px-6 pt-5 md:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div key={i} className="h-48 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-[#141a25]" />
      ))}
    </div>
  )
}

function Empty({ message }: { message: string }) {
  return (
    <div className="mx-6 mt-4 rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm dark:border-white/[0.08] dark:bg-[#141a25]">
      <Briefcase className="mx-auto h-7 w-7 text-gray-400" />
      <h2 className="mt-4 text-[16px] font-semibold">{message}</h2>
    </div>
  )
}
