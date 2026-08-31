/**
 * Desktop Portfolio — the book workspace.
 *
 * Portfolio-centred while browsing, position-centred once you are working:
 * pick a book, scan it for places the framework has come apart, open a
 * position into the full canvas, come back to the book.
 *
 * The book map and its totals are claims about the WHOLE book, so they live in
 * browse and nowhere else. Pinning them above an open position was the same
 * stacked-overview problem in miniature: a book-level answer taking space from
 * a position-level question.
 *
 * Portfolio owns no work. Every action it names is completed by the surface
 * that owns it -- Research for the case, Ideas V2 for the decision -- through
 * the typed seams those stages already established. There is no AI panel, no
 * chat system, no navigation registry and no attention engine here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Briefcase, ChevronDown } from 'lucide-react'
import {
  usePortfolioList, useBook, useBookFrames,
} from '../../hooks/useDesktopPortfolio'
import {
  gapOf, toneForGap, whyItMatters, comparePositions,
  GAP_LABEL, EMPTY_FRAME, type PositionFrame,
} from '../../lib/desktop-portfolio/model'
import type { SemanticTone } from '../../lib/semantic-tone'
import type { Position } from '../../lib/portfolio/holdings'
import {
  DesktopGallery, DesktopTile, TileState, TileIdentity, TileReason, TileFigure,
  TileVisual, TileBar, TileScale,
} from '../desktop/DesktopTile'
import { openAsset } from '../../lib/desktop-asset'
import { BookMap, bigMoney, type MapCell } from './PortfolioVisual'


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

  /**
   * Choosing a position leaves this surface.
   *
   * A position is an asset seen through a book -- weight, shares, cost and
   * unrealised are the projection, while the thesis, the framework and the
   * decision all attach to the asset itself. Stage 2D0 found no work that is
   * genuinely position-specific, and two implementations of the asset half.
   * So Portfolio stays the lens that finds a misaligned position, and the
   * asset workspace is where it gets worked on -- carrying this book as its
   * primary context, without hiding the others.
   */
  const open = useCallback((position: Position, frame: PositionFrame) => {
    const gap = gapOf(position, frame)
    openAsset({
      assetId: position.assetId,
      symbol: position.symbol,
      companyName: position.companyName,
      focus: 'position',
      portfolioId: position.portfolioId,
      portfolioName: portfolio?.name ?? null,
      issue: {
        title: GAP_LABEL[gap],
        detail: whyItMatters(position, frame),
        reason: `portfolio:${gap}`,
      },
      origin: 'portfolio',
    })
  }, [portfolio?.name])

  const maxWeight = rows[0] ? Math.max(...rows.map(r => r.position.weightPct)) : 0

  // Switching books must drop any pending selection: a position is
  // (asset, portfolio), and carrying the asset across would show one book's
  // line under another book's name.
  const selectBook = (id: string) => { setPortfolioId(id); setAssetId(null) }

  // A typed arrival names a position to work on, so it is forwarded to the
  // canonical destination rather than opened here.
  useEffect(() => {
    if (!assetId || !rows.length) return
    const found = rows.find(r => r.position.assetId === assetId)
    if (found) open(found.position, found.frame)
    setAssetId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, rows.length])

  if (listLoading) return <Loading />
  if (!portfolios.length) return <Empty message="No portfolios are visible to you." />

  if (bookLoading) return <div className="h-full bg-gray-50/60 dark:bg-[#0b0f16]"><SkeletonGrid /></div>
  if (!rows.length) {
    return (
      <div className="h-full overflow-y-auto bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
        <PortfolioSelector portfolios={portfolios} current={portfolio} onSelect={selectBook} />
        <Empty message="This book has no holdings on record." />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 pb-10 dark:bg-[#0b0f16]" data-testid="portfolio-lens">
      {/* The book map and its totals describe the WHOLE book, so they belong
          to browsing it -- and they are the reason this lens exists: where is
          capital, and where has the framework come apart. */}
      <BookHeader
        portfolios={portfolios} portfolio={portfolio}
        book={book} rows={rows} onSelect={selectBook}
      />
      <DesktopGallery title="Positions" count={rows.length}>
        {rows.map(r => (
          <PositionTile
            key={r.position.assetId}
            position={r.position}
            frame={r.frame}
            maxWeight={maxWeight}
            onOpen={() => open(r.position, r.frame)}
          />
        ))}
      </DesktopGallery>
    </div>
  )
}

/* ------------------------------------------------------------------ header */

function BookHeader({
  portfolios, portfolio, book, rows, onSelect,
}: {
  portfolios: { id: string; name: string; role: 'pm' | 'analyst' | null }[]
  portfolio: { id: string; name: string; role: 'pm' | 'analyst' | null } | null
  onSelect: (id: string) => void
  book: ReturnType<typeof useBook>['book']
  rows: { position: Position; frame: PositionFrame }[]
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
        {/* The book selector belongs to browsing the book. In detail the
            reader has already chosen; switching books there would silently
            change which book the open position belongs to. */}
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
  portfolios, current, onSelect,
}: {
  portfolios: { id: string; name: string }[]
  current: { id: string; name: string } | null
  onSelect: (id: string) => void
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
    return <h1 className="text-[21px] font-semibold tracking-tight">{current?.name ?? 'Portfolio'}</h1>
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-[21px] font-semibold tracking-tight hover:bg-gray-100 dark:hover:bg-white/[0.06]"
      >
        <span className="min-w-0 truncate">{current?.name ?? 'Select a portfolio'}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
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

/**
 * One position in the scan.
 *
 * Weight is the thing a reader compares positions by, so it gets a bar against
 * the book's largest rather than a bare number. Where a real ladder exists the
 * tile also shows whether spot has left the range the case defined -- the one
 * fact that turns a holding into a question, and the one that could never fit
 * in a rail.
 */
function PositionTile({
  position, frame, maxWeight, onOpen,
}: { position: Position; frame: PositionFrame; maxWeight: number; onOpen: () => void }) {
  const gap = gapOf(position, frame)
  const tone = toneForGap(gap)
  const rung = (name: string) => frame.ladder?.cases.find(c => c.name === name)?.price ?? null
  const bear = rung('Bear'), bull = rung('Bull')
  const showScale = !!frame.ladder?.valid && bear != null && bull != null && position.price > 0

  return (
    <DesktopTile
      testId="position-tile"
      dataAttrs={{ 'data-gap': gap }}
      // A position outside the case the desk wrote for it is the one state in
      // this gallery that should be visible from across the room. Everything
      // else -- including a position doing exactly what it should -- stays
      // quiet, so that one keeps meaning something.
      tone={tone}
      onOpen={onOpen}
      eyebrow={<>
        <TileState tone={tone}>{GAP_LABEL[gap]}</TileState>
        <TileFigure strong={tone === 'critical'}>{bigMoney(position.marketValue)}</TileFigure>
      </>}
    >
      <TileIdentity symbol={position.symbol} name={position.companyName} />
      <TileReason>{whyItMatters(position, frame)}</TileReason>
      <TileVisual>
        {showScale ? (
          <TileScale low={bear!} high={bull!} spot={position.price}
                     outside={gap === 'above-bull' || gap === 'below-bear'} />
        ) : (
          <TileBar
            pct={position.weightPct}
            max={maxWeight}
            label="Weight in book"
            tone={tone === 'critical' ? 'critical' : tone === 'review' ? 'attention' : 'neutral'}
          />
        )}
      </TileVisual>
    </DesktopTile>
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
