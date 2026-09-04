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

import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Briefcase, ChevronDown } from 'lucide-react'
import {
  usePortfolioList, useBook, useBookFrames, usePositionDetail, useActiveWeights,
  type ActiveWeight,
} from '../../hooks/useDesktopPortfolio'
import type { DayPerformance } from '../../hooks/useDayPerformance'
import { ActiveWeights } from './ActiveWeights'
import { DayPanel } from './DayPanel'
import { useDayPerformance } from '../../hooks/useDayPerformance'
import {
  gapOf, toneForGap, whyItMatters, comparePositions,
  GAP_LABEL, EMPTY_FRAME, type PositionFrame,
} from '../../lib/desktop-portfolio/model'
import type { SemanticTone } from '../../lib/semantic-tone'
import type { Position } from '../../lib/portfolio/holdings'
import {
  DesktopGallery, DesktopTile, TileState, TileIdentity, TileReason, TileFigure,
  TileTimeline,
  TileBar, TileScale, TileMeta, TileHeroNumber,
  sizeByRank, type TileSize,
} from '../desktop/DesktopTile'
import { PositionDetailPane } from './PositionDetail'
import {
  openDashboardFocus, type RailCard,
} from '../../lib/dashboard/focus'
import { bigMoney } from './PortfolioVisual'


export interface PortfolioWorkspaceProps {
  selectedPortfolioId?: string | null
  selectedAssetId?: string | null
  /** Set by the Dashboard deck when this lens is the expanded workspace. */
  focusObjectId?: string | null
}

export function PortfolioWorkspace({
  selectedPortfolioId, selectedAssetId, focusObjectId,
}: PortfolioWorkspaceProps = {}) {
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
  const active = useActiveWeights(book)
  const day = useDayPerformance(book, active)

  const rows = useMemo(() => {
    if (!book) return []
    return book.positions
      .map(position => ({ position, frame: frames[position.assetId] ?? EMPTY_FRAME }))
      .sort(comparePositions)
  }, [book, frames])

  /**
   * Selection lives in the deck. The lens draws the book and says which card
   * was chosen; the shell holds what is expanded and where Back returns to.
   */
  const activeId = focusObjectId ?? assetId ?? null
  const selected = activeId ? rows.find(r => r.position.assetId === activeId) ?? null : null
  const { detail } = usePositionDetail(selected?.position ?? null)
  const maxWeight = rows[0] ? Math.max(...rows.map(r => r.position.weightPct)) : 0
  /*
   * The book's own shape, so a tile draws the set it sits in rather than a
   * bar filled against its largest member -- which is 100% full for that
   * largest member, the one a reader is most likely to be looking at.
   */
  /*
   * Positions only. Cash is not one.
   *
   * The first version filtered on `w > 0`, which let a 57.5% cash line into
   * the distribution: it became the ceiling, and all twenty-two real holdings
   * drew as indistinguishable slivers against it. The lens already knows the
   * difference -- `isCash` -- and the rest of this file is careful about it,
   * which is exactly why the bar looked broken rather than wrong.
   */
  const weights = rows
    .filter(r => !r.position.isCash && r.position.weightPct > 0)
    .map(r => r.position.weightPct)

  // Switching books drops the selection: a position is (asset, portfolio), and
  // carrying the asset across would show one book's line under another's name.
  const selectBook = (id: string) => { setPortfolioId(id); setAssetId(null) }

  const open = (position: Position, frame: PositionFrame) => openDashboardFocus({
    target: {
      originLens: 'portfolio',
      workspaceLens: 'portfolio',
      objectType: 'position',
      objectId: position.assetId,
      symbol: position.symbol,
      label: position.companyName,
      portfolioId: position.portfolioId,
      portfolioName: portfolio?.name ?? null,
      issue: GAP_LABEL[gapOf(position, frame)],
      origin: 'portfolio',
    },
    // Named for the book, because that is where the reader returns.
    backLabel: portfolio?.name ?? 'Portfolio',
    rail: rows.map(toRailCard),
  })

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

  if (selected) {
    return (
      <PositionDetailPane
        position={selected.position}
        frame={selected.frame}
        detail={detail}
        portfolioName={portfolio?.name ?? null}
        role={portfolio?.role ?? null}
        maxWeight={maxWeight}
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto pb-10" data-testid="portfolio-lens">
      {/* The book map and its totals describe the WHOLE book, so they belong
          to browsing it -- and they are why this lens exists: where is
          capital, and where has the framework come apart. */}
      <BookHeader
        portfolios={portfolios} portfolio={portfolio}
        book={book} rows={rows} onSelect={selectBook}
        active={active}
        day={day}
        onOpenAsset={id => {
          const r = rows.find(x => x.position.assetId === id)
          if (r) open(r.position, r.frame)
        }}
      />
      <DesktopGallery title="Positions" count={rows.length}>
        {rows.map((r, i) => (
          <PositionTile
            key={r.position.assetId}
            position={r.position}
            frame={r.frame}
            maxWeight={maxWeight}
            weights={weights}
            // `comparePositions` already ranks the book by how much the
            // framework has come apart, weighted by size. Room follows it.
            size={sizeByRank(i, rows.length)}
            onOpen={() => open(r.position, r.frame)}
          />
        ))}
      </DesktopGallery>
    </div>
  )
}

/**
 * How far spot sits outside the case, as a percentage of the rung it broke.
 *
 * Only computed where a valid ladder and a real price exist, and only when
 * spot is actually outside -- a position inside its case has no distance worth
 * stating, and inventing one would make every card look broken.
 */
function outsideBy(
  position: Position, frame: PositionFrame,
): { value: string; label: string } | null {
  const rung = (n: string) => frame.ladder?.cases.find(c => c.name === n)?.price ?? null
  const bear = rung('Bear'), bull = rung('Bull')
  const spot = position.price
  if (!frame.ladder?.valid || !(spot > 0)) return null
  if (bear != null && spot < bear) {
    return { value: `${(((bear - spot) / bear) * 100).toFixed(1)}%`, label: 'below bear' }
  }
  if (bull != null && spot > bull) {
    return { value: `${(((spot - bull) / bull) * 100).toFixed(1)}%`, label: 'above bull' }
  }
  return null
}

/**
 * A position as a rail card.
 *
 * Weight leads, because materiality is what makes a framework state worth
 * reading: a name with no written case is a different problem at 28% than at
 * 0.4%. Colour is the condition, never the size.
 */
export function toRailCard(r: { position: Position; frame: PositionFrame }): RailCard {
  const gap = gapOf(r.position, r.frame)
  return {
    id: r.position.assetId,
    workspaceLens: 'portfolio',
    objectType: 'position',
    symbol: r.position.symbol,
    reason: GAP_LABEL[gap],
    tone: toneForGap(gap),
    figure: `${r.position.weightPct.toFixed(1)}%`,
    figureLabel: 'of book',
    // How far outside the case, where there IS a case and spot is outside it.
    // Never a bare price move -- that is not what this lens is asking about.
    secondary: outsideBy(r.position, r.frame),
    detail: whyItMatters(r.position, r.frame),
    portfolioId: r.position.portfolioId,
    issue: GAP_LABEL[gap],
  }
}

/* ------------------------------------------------------------------ header */

function BookHeader({
  portfolios, portfolio, book, rows, onSelect, active, day, onOpenAsset,
}: {
  /** The book's decisions against its index, and how to open one. */
  active: ActiveWeight[]
  /** The last close, against the index, and what drove it. */
  day: DayPerformance | null
  onOpenAsset: (assetId: string) => void
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


  return (
    <header className="px-6 pt-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        {/* The book selector belongs to browsing the book. In detail the
            reader has already chosen; switching books there would silently
            change which book the open position belongs to. */}
        <PortfolioSelector portfolios={portfolios} current={portfolio} onSelect={onSelect} />
        {portfolio?.role && (
          <span className="rounded-full bg-gray-100 px-2 py-[3px] text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:bg-white/10 dark:text-gray-300">
            {portfolio.role === 'pm' ? 'Portfolio manager' : 'Analyst'}
          </span>
        )}
      </div>

      <p className="mt-1.5 max-w-[70ch] text-[12px] text-gray-600 dark:text-gray-400">
        Where this book and the written framework disagree. Ordered by whether
        the disagreement is live, then by how much capital is behind it.
      </p>

      {book && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[11px] text-gray-500">
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

      {/*
        The decisions, before the positions.

        "How are we doing against the benchmark and what is driving it" is the
        first question anybody asks about a fund, and this lens opened with a
        list ordered by weight -- a fact about the book rather than about any
        decision. Owning 5.8% of Microsoft is a big position and a small bet,
        and the page drew the 5.8 and hid the bet.
      */}
      {/*
        What the book did, then why, then the decisions behind it.

        A portfolio lens that cannot say what the fund did on its last day and
        which names were responsible is a list of holdings, and this one was.
      */}
      {/*
        Reserved height, so the header cannot grow under the reader.

        These two panels each wait on their own query, and the book is already
        drawn by the time either resolves -- so the Positions grid was being
        pushed down twice, a few hundred milliseconds apart, after the reader
        had started looking at it. Reserving the space they will occupy turns
        two jumps into two fades.

        Only while the book itself has loaded and the panels have not: a book
        that genuinely has no benchmark file must not hold 320px of nothing
        open forever.
      */}
      <div
        data-testid="book-header-panels"
        style={{ minHeight: day == null && active.length === 0 ? 320 : undefined }}
      >
        <DayPanel day={day} onOpen={onOpenAsset} />
        <ActiveWeights rows={active} onOpen={onOpenAsset} />
      </div>

      {/*
        ── The book map is gone ─────────────────────────────────────────────
        *
        Reported as: "I don't understand the yellow and red position bar and
        what that's supposed to be helping with."
        *
        Fair, and the honest answer is that it was helping with very little.
        It drew every line in the book as a slab sized by weight and coloured
        by framework state -- so its dominant feature was always a cash block
        taking half the width, its second was a run of amber whose length
        restated a number printed directly underneath it, and the one thing
        worth seeing (a position outside its own case) was a sliver.
        *
        Three horizontal strips now stack in this header, and this was the
        only one that could not be read. The two facts it legended are exact,
        they are already written in words, and words are what they were doing
        the work as. The strip goes; the sentences stay.
      */}
      {rows.length > 1 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-500">
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
                'block w-full truncate px-3 py-1.5 text-left text-[12px]',
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
/**
 * One position in the book.
 *
 * ── Weight is the fact, and it is allowed to be large ────────────────────
 *
 * A position's materiality is what makes its framework state worth reading:
 * a name with no written case is a different problem at 28% than at 0.4%. On a
 * hero that number leads at 44px. Burying it in the eyebrow, as this did,
 * meant the gallery's most useful fact was also its smallest.
 *
 * ── Size is materiality, colour is condition ─────────────────────────────
 *
 * The two are independent. A 28% position with no case is HERO and amber --
 * big because of what it is worth, amber because the work is unfinished. A 2%
 * genuine break is COMPACT and rose. Neither axis derives from the other.
 *
 * ── No fabricated chart ──────────────────────────────────────────────────
 *
 * The scale is drawn only from a real ladder against a real price. Where the
 * desk has written no framework, the hero is a number and a stated absence --
 * which is the honest answer to why the tile is there.
 */
function PositionTile({
  position, frame, maxWeight, weights, size, onOpen,
}: {
  position: Position
  frame: PositionFrame
  maxWeight: number
  weights: number[]
  size: TileSize
  onOpen: () => void
}) {
  const gap = gapOf(position, frame)
  const tone = toneForGap(gap)
  const rung = (name: string) => frame.ladder?.cases.find(c => c.name === name)?.price ?? null
  const bear = rung('Bear'), bull = rung('Bull')
  const showScale = !!frame.ladder?.valid && bear != null && bull != null && position.price > 0
  const outside = gap === 'above-bull' || gap === 'below-bear'

  return (
    <DesktopTile
      testId="position-tile"
      dataAttrs={{ 'data-gap': gap }}
      // A position outside the case the desk wrote for it is the one state in
      // this gallery that should be visible from across the room.
      tone={tone}
      size={size}
      onOpen={onOpen}
      eyebrow={<>
        <TileState tone={tone}>{GAP_LABEL[gap]}</TileState>
        <TileFigure strong={tone === 'critical'}>{bigMoney(position.marketValue)}</TileFigure>
      </>}
    >
      <TileIdentity symbol={position.symbol} name={position.companyName} size={size} />

      {size === 'hero' || size === 'large' ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <TileHeroNumber
            figure={position.weightPct.toFixed(1)}
            unit="%"
            label={<>of this book</>}
            tone={tone}
          />
          <p className="mt-2 text-[13px] text-gray-600 dark:text-gray-400">
            {whyItMatters(position, frame)}
          </p>
          {/*
            The hero shows what the issue actually is: a broken framework gets
            the ladder, a missing one gets the shape of what is missing. It used
            to get a weight bar in both cases, which said nothing new after the
            number directly above it.
          */}
          {/*
            How long this position's case has been standing.

            "Where this book and the written framework disagree" is what this
            lens says it is for, and the disagreement has a duration: the date
            the case was last written, and what has landed since. Both are
            already in the frame and both went undrawn, which is why the
            widest tile on the page carried eighty pixels of nothing under a
            single sentence. The same primitive Research uses, because it is
            the same question asked in different words.
          */}
          {frame.thesisUpdatedAt && (
            <div className="mt-3">
              <TileTimeline
                writtenAt={frame.thesisUpdatedAt}
                newestAt={null}
                count={frame.newEvidence}
              />
            </div>
          )}

          <div className={size === 'hero' ? 'mt-auto pt-5' : 'mt-auto pt-3'}>
            {showScale ? (
              <TileScale low={bear!} high={bull!} spot={position.price} outside={outside} />
            ) : gap === 'no-framework' ? (
              <ThesisSkeleton />
            ) : (
              <TileBar
                pct={position.weightPct} max={maxWeight} population={weights}
                label="Weight, against the whole book"
              />
            )}
          </div>
        </div>
      ) : size === 'medium' ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <TileReason>{whyItMatters(position, frame)}</TileReason>
          <div className="mt-auto pt-3">
            {showScale
              ? <TileScale low={bear!} high={bull!} spot={position.price} outside={outside} />
              : <TileBar
                  pct={position.weightPct}
                  max={maxWeight}
                  population={weights}
                  label="Weight in book"
                  tone={tone === 'critical' ? 'critical' : tone === 'review' ? 'attention' : 'neutral'}
                />}
          </div>
        </div>
      ) : (
        /* Compact: the weight, and -- where the case is broken -- how far
           outside it price has gone. A four-pixel scale says nothing. */
        <TileMeta>
          <span className="font-mono text-[15px] font-semibold text-gray-900 dark:text-gray-100">
            {position.weightPct.toFixed(1)}%
          </span>
          <span>of book</span>
          {outsideBy(position, frame) && (
            <span className="font-semibold text-rose-700 dark:text-rose-400">
              {outsideBy(position, frame)!.value} {outsideBy(position, frame)!.label}
            </span>
          )}
        </TileMeta>
      )}
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


/**
 * The shape of a thesis that was never written.
 *
 * A position held at 28% with nothing behind it is the strongest finding this
 * lens produces, and it was rendering as a weight bar -- the same visual an
 * ordinary position gets. Three named rows show what is absent instead.
 *
 * Every row is a dash by construction: this only renders for `no-framework`,
 * which is defined as having no core section written at all. It states a fact
 * the frame already proves rather than reading a field that does not exist.
 */
const THESIS_PARTS = ['Thesis', 'Where we differ', 'Risks'] as const

function ThesisSkeleton() {
  return (
    <ul className="flex flex-col gap-1.5">
      {THESIS_PARTS.map(label => (
        <li key={label} className="flex items-baseline gap-3 text-[13px]">
          <span className="text-gray-400">{label}</span>
          <span aria-hidden className="mb-1 flex-1 border-b border-dashed border-gray-200 dark:border-white/10" />
          <span className="font-mono text-[12px] text-gray-300 dark:text-gray-600">—</span>
        </li>
      ))}
    </ul>
  )
}
