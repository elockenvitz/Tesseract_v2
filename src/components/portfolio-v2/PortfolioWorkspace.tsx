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
  type BenchmarkComparison,
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
/* Book minus index, for the panel behind the weight in the tile's corner. */
import type { ActiveWeight } from '../../lib/desktop-portfolio/benchmark'
/* The corner weight control, shared with Research. */
import { TileWeightChip } from '../desktop/TileWeightChip'
import {
  /* `TileFigure` went with the market value it carried: the corner states the
     weight now, and the dollars are one click behind it. */
  DesktopGallery, DesktopTile, TileState, TileIdentity, TileReason,
  TileTimeline,
  /* `TileMeta` and `TileHeroNumber` are both gone from this lens. They were
     two of the four ways it used to state what a position weighs; `WeightChip`
     in the tile's corner is the one way now. */
  TileBar, TileScale,
  sizeByRank, type TileSize,
} from '../desktop/DesktopTile'
/* The shared price chart -- the same object Decisions draws, not a sparkline
   reduction of it. */
import { TilePriceChart } from '../desktop/TilePriceChart'
/* The shared dated closes, so a position with no written case still has an
   object worth looking at. Keyed by symbol with a five-minute staleTime, so a
   gallery on the same name makes one request. */
import { useTileCloses } from '../../hooks/useTileCloses'
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

  /*
   * ── The default book is derived, not assigned in an effect ───────────────
   *
   * This was `useEffect(() => { if (!portfolioId && portfolios.length)
   * setPortfolioId(portfolios[0].id) })`, which costs a whole render pass in
   * between: the list has arrived, no book has been asked for yet, so
   * `useBook(null)` is disabled, `bookLoading` is false, `rows` is empty --
   * and the component falls all the way through to "This book has no holdings
   * on record."
   *
   * That is the hitch. Not a jump: a flash of a wrong and alarming sentence,
   * on every load, before the skeleton appears. Deriving the id during render
   * means the book query starts on the same pass the list lands, and that
   * state cannot be reached at all.
   */
  const activeBookId = portfolioId ?? portfolios[0]?.id ?? null

  useEffect(() => { if (selectedPortfolioId) setPortfolioId(selectedPortfolioId) }, [selectedPortfolioId])
  useEffect(() => { if (selectedAssetId) setAssetId(selectedAssetId) }, [selectedAssetId])

  const portfolio = portfolios.find(p => p.id === activeBookId) ?? null
  const { book, isLoading: bookLoading } = useBook(activeBookId)
  const { frames, pending: framesPending } = useBookFrames(book)
  const benchmark = useActiveWeights(book)
  const day = useDayPerformance(book, benchmark.rows)

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

  /*
   * One placeholder for the whole load, not three.
   *
   * The list, the book and the frames arrive in that order, and each used to
   * hand over to a different layout: a centred spinner, then a grid of boxes,
   * then the page. Three structures in sequence is three jolts, and the
   * reader reads them as the surface failing to settle.
   *
   * `SkeletonGrid` is the page's own shape, so it can stand for every one of
   * those waits and the last handover is the only visible change.
   */
  if (listLoading) {
    return <div className="h-full bg-gray-50/60 dark:bg-[#0b0f16]"><SkeletonGrid /></div>
  }
  if (!portfolios.length) return <Empty message="No portfolios are visible to you." />
  /*
   * The grid waits for the frames, not just the book.
   *
   * Tile height comes from what each frame carries -- a ladder, a timeline, a
   * reason -- so drawing the grid on the book alone renders twenty-three
   * short tiles and then re-lays every one of them out a moment later. That
   * reflow is the second half of the hitch, and it cannot be reserved per
   * tile because the height genuinely varies per position. One skeleton and
   * one paint is both calmer and honest about what is still arriving.
   */
  if (bookLoading || framesPending || !book) {
    return <div className="h-full bg-gray-50/60 dark:bg-[#0b0f16]"><SkeletonGrid /></div>
  }
  /*
   * `!book` joins the skeleton above rather than falling through to here.
   * "This book has no holdings on record" is a claim about a book that has
   * been read; a book that has not been read yet is still loading, and saying
   * the first about the second is the flash this pass removed.
   */
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
        benchmark={benchmark}
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
            /* Only where the file actually loaded: `state` distinguishes a
               book with no benchmark from one whose read failed, and neither
               may be shown as a zero index weight. */
            activeWeight={
              benchmark.state === 'ready'
                ? benchmark.rows.find(a => a.assetId === r.position.assetId) ?? null
                : null
            }
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
  portfolios, portfolio, book, rows, onSelect, benchmark, day, onOpenAsset,
}: {
  /** The book's decisions against its index -- or why there are none -- and how to open one. */
  benchmark: BenchmarkComparison
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
      {/*
        Side by side, on one baseline, at a height that does not move.

        ── Why they are a row and not a stack ───────────────────────────────
        *
        They answer one question in two halves -- what the book did, and which
        decisions it is carrying -- and stacked they read as two unrelated
        strips with the second one pushed below the fold. Level, they read as
        one instrument, and a reader comparing "we were up 0.33%" against
        "these are our five biggest bets" does not have to scroll between the
        two facts.
        *
        ── And why the height is fixed ──────────────────────────────────────
        *
        Each half waits on its own query while the book underneath is already
        drawn, so every arrival was landing as new height under a reader who
        had started reading. A stack made that worse: two panels, two jumps,
        a few hundred milliseconds apart.
        *
        The row reserves what it will occupy, so both arrivals are fades. The
        reservation is unconditional because a book with no benchmark file is
        a permanent state, not a loading one -- and a row that collapses for
        those books would move the grid on every book switch instead.
      */}
      <div
        data-testid="book-header-panels"
        /*
          The reservation follows the LAYOUT, which changes at xl.
          *
          It was a flat 210px inline, which is the height of one row of two
          panels. Below xl they stack, so the same 210 reserved half of what
          two panels need and the grid dropped ~200px when the second landed.
          Above xl it was 15px short of the day panel's real height, so the
          grid still stepped 5px -- measured, not estimated.
          *
          The panels no longer carry their own top margin either. A margin
          inside the row is height the row does not know about, and it was
          exactly the 15px the grid still stepped by after the first attempt
          at this -- measured, both times, rather than estimated.
          *
          400 stacked, 200 side by side, each a little over the tallest panel
          that layout can produce.
        */
        className="mt-5 grid min-h-[400px] grid-cols-1 items-start gap-x-10 gap-y-4 xl:min-h-[200px] xl:grid-cols-2"
      >
        {/*
          Each panel owns its column, present or not.
          *
          Both render null until their own query lands, and a null child takes
          no grid cell -- so the benchmark strip, which resolves first, was
          placed in column ONE and then slid across to column two the moment
          the day panel appeared beside it. Measured: x=24, then x=980.
          *
          `col-start` pins them, so an absent panel leaves its slot empty
          instead of letting the other move into it.
        */}
        <div className="min-w-0 xl:col-start-1"><DayPanel day={day} onOpen={onOpenAsset} /></div>
        <div className="min-w-0 xl:col-start-2"><ActiveWeights comparison={benchmark} onOpen={onOpenAsset} /></div>
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
             className="absolute left-0 top-full z-20 mt-1 max-h-viewport-60 w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-[#141a25]">
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
  position, frame, maxWeight, weights, size, activeWeight, onOpen,
}: {
  position: Position
  frame: PositionFrame
  maxWeight: number
  weights: number[]
  size: TileSize
  /** Book minus index for this name, where a benchmark file is loaded. */
  activeWeight: ActiveWeight | null
  /** The book being viewed, named beside the weight in the corner. */
  onOpen: () => void
}) {
  const gap = gapOf(position, frame)
  const tone = toneForGap(gap)
  /* Read for every tile, used where the card would otherwise show dashes or a
     weight bar the reader has already seen five times. Unconditional because
     it is a hook; cached by symbol, so the cost is one request per name. */
  const { data: closes } = useTileCloses(position.symbol)
  const rung = (name: string) => frame.ladder?.cases.find(c => c.name === name)?.price ?? null
  const bear = rung('Bear'), bull = rung('Bull')
  const showScale = !!frame.ladder?.valid && bear != null && bull != null && position.price > 0
  const outside = gap === 'above-bull' || gap === 'below-bear'

  /*
   * `leftHasContent` is gone with the two-column layout it governed. It
   * existed to decide whether the card should hold a second column open, and
   * a stacked card never has to ask: every block renders only when it has
   * something to show, and the chart takes whatever height is left.
   */

  return (
    <DesktopTile
      testId="position-tile"
      dataAttrs={{ 'data-gap': gap }}
      // A position outside the case the desk wrote for it is the one state in
      // this gallery that should be visible from across the room.
      tone={tone}
      size={size}
      onOpen={onOpen}
      /*
        The corner states the WEIGHT, not the market value.

        The dollars were there because they are concrete, but the question this
        lens asks is about size relative to the book -- "where this book and
        the written framework disagree" is a weighting argument. The dollars
        are one click away, with the shares, the price and the active weight,
        which is where they belong: useful when asked for, noise when not.
      */
      eyebrow={<>
        <TileState tone={tone}>{GAP_LABEL[gap]}</TileState>
        <WeightChip position={position} active={activeWeight} />
      </>}
    >
      <TileIdentity symbol={position.symbol} name={position.companyName} size={size} />

      {size === 'hero' || size === 'large' ? (
        /*
          ── Two columns, so the chart gets the width ────────────────────────

          This was one stacked column: the weight figure, a sentence, the
          standing-window timeline, and at the bottom a weight BAR -- which
          restated the figure at the top of the same card. The price chart, when
          it appeared at all, was squeezed under all of it.

          The record reads down the left. The right column carries the two
          things a reader compares across positions: what it weighs, at the
          top, and what the price has done, filling the rest. The weight bar
          is gone rather than moved -- the figure above it said the same thing,
          and its removal is most of the room the chart now has.
        */
        /*
          ── A grid, not flex, so the halves are actually halves ─────────────

          As flex this was `basis-[50%] shrink-0` on the left and `flex-1` on
          the right. `shrink-0` means the left column will not go below its
          content's minimum width -- so on a name whose left side happens to be
          wide (a scale with four-digit prices, a long company name, a date
          range that will not wrap) the left column held its ground and the
          right column absorbed the whole difference. The chart went narrow on
          those tiles and only those, which is why it looked arbitrary.

          `minmax(0, 1fr)` twice is the fix: each column is exactly half and
          the `0` minimum means content must shrink to fit rather than pushing
          its neighbour. Rows stretch by default, which is what lets the chart
          fill the height.
        */
        /*
          ── One column where there is nothing to put in the second ──────────

          Two columns is right when the left has a case to describe. On a
          position with no written thesis it has almost nothing: the sentence
          is suppressed (it only restated the ticker and the weight), there is
          no review date to draw a standing window from, and no ladder. What
          was left was a single line -- "Nothing written" -- at the top of a
          half-width column, and then nothing for the rest of the card's
          height, beside a full-height chart. That is the empty space, and it
          appeared on exactly the positions with least written about them.

          So the split is conditional on there being something to split. With
          nothing on the left the card runs full width: the absence on one
          line, the chart under it, using the whole tile.
        */
        /*
          ── Text across the top, chart across the bottom ────────────────────

          Not a left/right split. Splitting the card gave the chart half the
          width and left the record in a narrow column that wrapped more --
          worse for both, since a price line wants width and a short run of
          facts does not want a column. It also produced the dead space that
          took three passes to chase: whichever column was shorter left a void
          beside the other.

          Stacked, neither can happen. The record runs ACROSS the full width,
          the objects that describe the case sit on one wrapping row, and the
          chart takes the whole width beneath with all the height that is left.
        */
        <div className="mt-3 flex min-w-0 flex-1 flex-col gap-3">
          {tileReasonFor(position, frame) && (
            <p className="text-[13px] leading-snug text-gray-600 dark:text-gray-400">
              {tileReasonFor(position, frame)}
            </p>
          )}

          {/*
            The case's own objects, side by side on one row rather than stacked
            into a column: the standing window, and either the written ladder
            or the fact that nothing is written.

            "Where this book and the written framework disagree" is what this
            lens says it is for, and the disagreement has a duration -- which
            is what the timeline draws. Both already existed in the frame and
            both went undrawn before this.
          */}
          {(frame.thesisUpdatedAt || showScale || gap === 'no-framework') && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
              {frame.thesisUpdatedAt && (
                <div className="min-w-[180px] flex-1">
                  <TileTimeline
                    writtenAt={frame.thesisUpdatedAt}
                    newestAt={null}
                    count={frame.newEvidence}
                  />
                </div>
              )}
              {showScale ? (
                <div className="min-w-[200px] flex-1">
                  <TileScale low={bear!} high={bull!} spot={position.price} outside={outside} />
                </div>
              ) : gap === 'no-framework' ? (
                <ThesisSkeleton />
              ) : null}
            </div>
          )}

          {/*
            The chart: full width, and whatever height the record above did
            not use, so it ends flush with the bottom of the tile. `min-h-0`
            is required or the flex child refuses to shrink below its content.
          */}
          {closes && closes.length >= 2 && (
            <div className="min-h-0 min-w-0 flex-1">
              <TilePriceChart points={closes} fill height={size === 'hero' ? 176 : 148} />
            </div>
          )}
        </div>
      ) : size === 'medium' ? (
        /*
          Medium has no room for two columns, so the same ORDER runs down the
          card: what it weighs, why it matters, what the price did.

          The first pass put the weight on the same line as the reason,
          baseline-aligned. The reason wraps to two or three lines at this
          width, so the number ended up aligned to the first of them and
          floating beside a block of text -- which is why it read as unclear
          rather than as a heading. It gets its own line now.
        */
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {/* No weight figure in the body: the corner states it at every size,
              and saying it twice on one card is what this pass removed. */}

          {tileReasonFor(position, frame) && (
            <TileReason>{tileReasonFor(position, frame)}</TileReason>
          )}

          {/*
            ── The ladder AND the price, not one or the other ────────────────

            This was `showScale ? scale : chart : bar` -- a chain, so a medium
            tile with a written case showed its ladder and NO chart. That is
            why some names had a price and their neighbours did not: it was
            never the name, it was whether a ladder existed to win the slot.

            They answer different questions -- where spot sits inside the case
            we wrote, and what the price has actually done -- so a card with
            both shows both, the ladder compact above and the chart taking the
            rest. The weight bar stays the last resort, for a name we hold no
            prices for at all.
          */}
          {showScale && (
            <TileScale low={bear!} high={bull!} spot={position.price} outside={outside} />
          )}

          <div className="flex min-h-0 flex-1 flex-col justify-end">
            {closes && closes.length >= 2 ? (
              <div className="min-h-0 flex-1">
                <TilePriceChart points={closes} fill height={100} />
              </div>
            ) : !showScale ? (
              <TileBar
                pct={position.weightPct}
                max={maxWeight}
                population={weights}
                label="Weight in book"
                tone={tone === 'critical' ? 'critical' : tone === 'review' ? 'attention' : 'neutral'}
              />
            ) : null}
          </div>
        </div>
      ) : (
        /*
          Compact: what it weighs, how far outside its own case price has gone,
          and the price itself.

          The weight line alone is what made a run of these read as one tile
          repeated. Every lens here draws a share-of-book figure -- several draw
          two -- so on the smallest card it is the least differentiating thing
          available, and it was the only thing on it. The chart is what differs
          per name.
        */
        /*
          ── `flex-1`, because a compact tile is often taller than its content ─

          Tiles sit in a CSS grid and stretch to their ROW, so a compact card
          beside a medium one is as tall as the medium one -- 295px against the
          251px its own content needs. This wrapper was `flex: 0 1 auto`, so
          the content sat at the top and the difference showed as white space
          at the bottom. It appeared on some compact tiles and not others,
          which is exactly what made it look arbitrary: it is not the name, it
          is which row the tile landed in.

          Measured on a stretched META tile: content ended at y=239 inside a
          293px body.
        */
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {/*
            The weight is in the corner, so this line carries what is left:
            how far outside its own case the price has gone, or -- where it is
            inside one -- what state the case is in.

            Something, always. With the weight gone from the body this was the
            card's only text, and on a position that is neither outside its
            case nor missing one it rendered nothing: a ticker and a chart,
            which reads as a card that failed rather than one with nothing to
            report.
          */}
          <span className={clsx(
            'min-w-0 truncate text-[10px]',
            outside
              ? 'font-semibold text-rose-700 dark:text-rose-400'
              : 'text-gray-500',
          )}>
            {outside
              ? `${outsideBy(position, frame)?.value} ${outsideBy(position, frame)?.label}`
              : GAP_LABEL[gap]}
          </span>
          {closes && closes.length >= 2 && (
            <div className="min-h-0 flex-1">
              <TilePriceChart points={closes} fill height={76} />
            </div>
          )}
        </div>
      )}
    </DesktopTile>
  )
}

/* ------------------------------------------------------------------ states */

/*
 * `Loading` is gone. It was a bar over the skeleton -- a fourth layout for the
 * first 250ms of a load that now has one, and the extra bar is exactly the
 * kind of element that makes a placeholder disagree with the page it stands
 * in for.
 */

/**
 * The loading state has to be the loaded page's shape, not a grid of boxes.
 *
 * ── The hitch, finally measured ──────────────────────────────────────────
 *
 * This drew six cards starting at the top of the page. The loaded lens has a
 * header above its grid -- the book name, the market-value line, the day
 * panel and the benchmark strip -- about 364px of it. So the placeholder put
 * the grid at y=68 and the real page put it at y=432, and every load ended
 * with the entire surface jumping down a third of the viewport.
 *
 * That is what "hitchy" was. Not the query waterfall, which two earlier
 * passes went after: the placeholder and the page simply had different
 * layouts. It was invisible in the harness until the stubs were given
 * latency, which is the thing those passes should have done first.
 *
 * So the skeleton reserves the header it knows is coming, in the same blocks
 * at the same heights. Nothing here is a spinner: a spinner tells a reader to
 * wait, and a shape tells them what they are waiting for.
 */
function SkeletonGrid() {
  const box = 'animate-pulse rounded-[3px] bg-gray-200/70 dark:bg-white/[0.06]'
  return (
    <div data-testid="portfolio-skeleton" className="px-6 pt-6">
      {/* Title, role chip, the two-line description, the stats row. */}
      <div className={`${box} h-[26px] w-[220px]`} />
      <div className={`${box} mt-3 h-[13px] w-[420px]`} />
      <div className={`${box} mt-1.5 h-[13px] w-[360px]`} />
      <div className={`${box} mt-3 h-[14px] w-[300px]`} />

      {/* The two header panels, in the same reservation the loaded row uses. */}
      <div className="mt-5 grid min-h-[400px] grid-cols-1 gap-x-10 gap-y-4 xl:min-h-[200px] xl:grid-cols-2">
        <div className={`${box} h-[186px]`} />
        <div className={`${box} h-[186px]`} />
      </div>

      {/* The gallery's own heading block: title, count, and the rule of
          space the grid hangs from. Measured against the loaded page rather
          than guessed -- the tile row lands within a couple of pixels. */}
      <div className={`${box} mt-5 h-[24px] w-[140px]`} />

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-6 xl:grid-cols-9 2xl:grid-cols-12">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            className={`${box} h-[120px] ${i === 0 ? 'md:col-span-6 xl:col-span-5 2xl:col-span-6' : 'md:col-span-3 xl:col-span-3'}`}
          />
        ))}
      </div>
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

/**
 * ── Three rows of dashes said it three times ─────────────────────────────
 *
 * This drew a labelled row per missing section, each ending in an em dash.
 * The finding is real -- a large position with nothing written behind it is
 * the strongest thing this lens produces -- but stating it three times is not
 * three findings, and the rows LOOK like content: a reader scans them before
 * discovering every one is empty.
 *
 * Worse, it occupied the tile's only visual slot. So the card that most needs
 * to make someone curious enough to open it was the card showing the least.
 *
 * The absence now gets one line that names all three parts, and the space
 * goes to the price -- the object that actually helps decide whether this is
 * worth investigating today.
 */
/**
 * The tile's sentence, or nothing where the sentence says nothing new.
 *
 * ── Why the tile differs from the rail and the detail pane ───────────────
 *
 * `whyItMatters` is written to stand alone. In a rail card or a detail header
 * it is the only thing describing the position, so naming the weight and the
 * ticker inside it is right.
 *
 * On a tile it is not alone. The ticker is the headline, the weight is the
 * figure in the right column, and "Nothing written" already states the absent
 * case -- so for those gaps the sentence is three facts the reader has already
 * read, set as prose, which is how a card ends up looking full of content and
 * saying nothing:
 *
 *   no-framework  "5.6% of the book in GOOGL, with no thesis behind it."
 *   aligned       "5.6% of the book, nothing outstanding."   (no thesis)
 *   large-cash    "5.6% of the book is in cash."
 *
 * Those get no sentence. Every other gap says something the tile does not
 * otherwise carry -- how far spot is outside the case, how many notes have
 * landed, how long since a review -- and keeps it.
 */
function tileReasonFor(p: Position, f: PositionFrame): string | null {
  const gap = gapOf(p, f)

  /*
   * ── Shortened, not removed ───────────────────────────────────────────────
   *
   * These three sentences led with the weight and the ticker, which the card
   * already carries -- so they were suppressed entirely. That was right while
   * the weight was a figure in the body; once it moved to the corner it left
   * some cards with NO words at all, just a ticker and a chart, which reads as
   * a card that failed to load rather than one with nothing to report.
   *
   * So the restatement goes and the meaning stays. Each keeps the half the
   * card does not already show:
   *
   *   aligned, no review  "5.6% of the book, nothing outstanding."
   *   large-cash          "5.6% of the book is in cash."
   *
   * `no-framework` is the exception and still returns null, because the
   * missing-parts line says it better and says it right there.
   */
  if (gap === 'no-framework') return null
  if (gap === 'large-cash') return 'Held in cash.'
  if (gap === 'aligned' && !f.thesisUpdatedAt) return 'Nothing outstanding.'
  return whyItMatters(p, f)
}

/**
 * What the position weighs, said the same way at every size.
 *
 * ── Why this is one component ────────────────────────────────────────────
 *
 * The four sizes each rendered this figure their own way: a shared
 * `TileHeroNumber` on hero and large, a hand-rolled span on medium, and a
 * `TileMeta` row on compact -- three type scales, two label wordings ("of this
 * book" / "of book") and the tone ink applied in two of the three. Scanning a
 * gallery that mixes them, the same fact looked like three different facts.
 *
 * One component, one wording, one ink rule, three sizes of the same thing.
 */
/**
 * The weight, in the tile's top-right corner, and what is behind it on a click.
 *
 * ── Why a control and not a figure ───────────────────────────────────────
 *
 * "6.4%" answers one question and raises three: how many dollars is that,
 * how does it compare to the index, and how many shares. Putting all four on
 * the card would bury the one that matters; putting none of them there sends
 * the reader to the detail pane for a number they wanted in passing.
 *
 * So the corner states the weight and opens the rest in place. Nothing here
 * is computed: the dollars and the shares are the position's own, and the
 * active weight is the benchmark comparison the book header already draws.
 *
 * `data-no-portal` on the control and the panel, because the tile shell treats
 * an unhandled click as "open this record" -- reading a number is not a
 * decision to leave the gallery.
 */
function WeightChip({ position, active }: {
  position: Position
  /** The book-minus-index row for this name, where a benchmark is loaded. */
  active: ActiveWeight | null
}) {
  /*
   * The drawing is `desktop/TileWeightChip`, shared with Research. This is the
   * Portfolio-shaped call: the book holds the whole position, so it can answer
   * every question the weight raises.
   *
   * Active weight only where a benchmark file actually loaded. An index weight
   * of zero for a name the file does not hold is NOT the same as a name the
   * index holds at zero, and this lens is careful about that elsewhere -- so
   * where there is no comparison it says so rather than printing the book's
   * own weight as though it were active.
   */
  return (
    <TileWeightChip
      pct={position.weightPct}
      testId="position-weight"
      /* Just "weight". This page is scoped to one book -- the selector names
         it at the top -- so repeating that name on every tile says nothing
         and is the longest thing in the corner. */
      caption="weight"
      details={[
        { label: 'Market value', value: bigMoney(position.marketValue) },
        {
          label: 'Shares',
          value: position.shares.toLocaleString(undefined, { maximumFractionDigits: 0 }),
        },
        { label: 'Price', value: `$${position.price.toFixed(2)}` },
        active == null
          ? { label: 'Active weight', value: 'no benchmark' }
          : {
              label: 'Active weight',
              value: `${active.activePct >= 0 ? '+' : ''}${active.activePct.toFixed(2)} pp`,
              sign: active.activePct,
            },
        ...(active != null
          ? [{ label: 'Index weight', value: `${active.benchPct.toFixed(2)}%` }]
          : []),
      ]}
    />
  )
}

/*
 * `WeightFigure` is gone: the weight is stated once, in the tile's corner, by
 * `WeightChip`. It briefly existed to say the same thing at four sizes in the
 * card body, which is a problem that disappears when the fact has one home.
 *
 * Its one hard-won rule moved into that chip: only a genuine break inks this
 * number. A thesis due for review is a fact about the CALENDAR, and colouring
 * a position's weight amber for it claims the position is wrong when nobody
 * has said so. Size is importance, colour is condition.
 */

/**
 * Text only. The chart that briefly lived in here is now the right column's,
 * where every hero and large tile gets one rather than only the ones with no
 * written case -- and where it has the width to be read.
 */
function ThesisSkeleton() {
  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <span className="font-semibold text-amber-700 dark:text-amber-500">Nothing written</span>
      <span className="min-w-0 truncate text-gray-500">
        no {THESIS_PARTS.map(p => p.toLowerCase()).join(', no ')}
      </span>
    </div>
  )
}
