/**
 * The browse gallery, and the tiles in it.
 *
 * ── Width was the point, and now there is all of it ──────────────────────
 *
 * The left rail failed because a 252px column could only hold a symbol, a pill
 * and a number, so the scan carried no investment content. The capped band
 * that replaced it was better but still rationed: 340px of vertical space
 * shared with a detail workspace underneath.
 *
 * The gallery now owns the surface while the reader is browsing. A tile can
 * show what a position weighs against the book, where spot sits relative to
 * the case written for it, or what the price did since a decision — the things
 * someone is actually comparing across when they ask which one to open.
 *
 * ── A tile answers four questions and stops ──────────────────────────────
 *
 * What is this, why does it matter, what kind of problem is it, and roughly
 * what would I do. Not the detail workspace compressed into a card: the reader
 * is choosing what to open, not reading it here.
 *
 * ── No call to action on a tile ──────────────────────────────────────────
 *
 * The original three-column landing pages each carried their own verb, so
 * every tile competed with the workspace for the same decision. Opening IS the
 * action; the detail workspace owns the verbs. The shell offers no footer slot,
 * so a surface cannot add one back.
 */

import { clsx } from 'clsx'
import type { SemanticTone } from '../../lib/semantic-tone'

/**
 * The editorial gallery.
 *
 * ── Why not equal rectangles ─────────────────────────────────────────────
 *
 * A grid of identical cards says every object matters equally. None of these
 * lenses believe that: three of them rank, and the fourth knows which records
 * actually remember something. A gallery that flattens its own model back to
 * uniform is throwing away the one thing it knows.
 *
 * ── Size means importance. Colour means condition. ───────────────────────
 *
 * These are separate axes and must stay separate. A 28% position with no
 * written case is HERO because of what it is worth, and amber because the work
 * is unfinished. A 2% genuine framework break is COMPACT and rose. Neither
 * axis may be derived from the other, and a tile is never promoted because it
 * happens to have a chart to draw.
 *
 * ── Reading order is semantic order ──────────────────────────────────────
 *
 * Tiles are emitted in rank order and placed by normal grid flow, never
 * `dense`. Dense backfills earlier gaps with later items, which would put rank
 * #7 above rank #4 the moment a row did not divide evenly -- the layout would
 * be quietly lying about priority. Spans are chosen so every row closes:
 *
 *   2xl (12 cols)  hero 6 x 2 rows | medium 3 | compact 3
 *   xl  (9 cols)   hero 5 x 2 rows | medium 4 | compact 3
 *   md  (6 cols)   hero 6 full     | medium 3 | compact 3
 *
 * At 2xl that yields exactly the intended composition: the hero holds the
 * upper-left two rows, two mediums sit beside it in row one, two more in row
 * two, and the compacts run on beneath.
 */

/**
 * How much room an object has earned. Never a severity.
 *
 * Four bands, not three. With only hero/medium/compact, ranks two through
 * eight rendered as one undifferentiated field of equal cards and the page
 * read as "one important thing, then a grid" -- which is not what any of these
 * lenses believe. `large` gives second place visible second place.
 */
export type TileSize = 'hero' | 'large' | 'medium' | 'compact'

/**
 * Flow discipline.
 *
 * `ranked` lets the hero occupy two rows, because rank #1 is always first and
 * a two-row block at the start of the grid leaves no hole.
 *
 * `chronological` cannot do that. A Decisions hero belongs wherever its date
 * puts it, and a mid-grid two-row block leaves gaps that normal flow never
 * backfills. So in that mode size drives composition and height inside an
 * equal column, and every tile keeps the same width. Chronology stays true and
 * the grid stays calm; the richer record still reads larger.
 */
export type TileFlow = 'ranked' | 'chronological'

/*
  Every row closes, at every width, in emitted order.

    2xl (12)   hero 6x2 | large 6 | medium 3 | compact 3
               -> row 1  hero + large
                  row 2  hero + medium + medium
                  row 3+ four compacts

    xl (9)     hero 5x2 | large 4 | medium 4 | compact 3
    md (6)     hero full | large full | medium 3 | compact 3

  Normal flow, never dense: dense backfills earlier gaps with later items,
  which would put rank #7 above rank #4 the moment a row did not divide.
*/
const SPAN: Record<TileFlow, Record<TileSize, string>> = {
  ranked: {
    hero: 'md:col-span-6 xl:col-span-5 xl:row-span-2 2xl:col-span-6',
    large: 'md:col-span-6 xl:col-span-4 2xl:col-span-6',
    medium: 'md:col-span-3 xl:col-span-4 2xl:col-span-3',
    compact: 'md:col-span-3 xl:col-span-3 2xl:col-span-3',
  },
  /*
    Chronological decks can use the same spans, because their order is fixed
    and the newest record is always first -- so a two-row block at index 0
    leaves no hole. What they must never do is REORDER to make a nicer page.
  */
  chronological: {
    hero: 'md:col-span-6 xl:col-span-5 xl:row-span-2 2xl:col-span-6',
    large: 'md:col-span-6 xl:col-span-4 2xl:col-span-6',
    medium: 'md:col-span-3 xl:col-span-3 2xl:col-span-3',
    compact: 'md:col-span-3 xl:col-span-3 2xl:col-span-3',
  },
}

export function DesktopGallery({
  title, count, action, note, flow = 'ranked', children,
}: {
  title: React.ReactNode
  count?: number
  /** A filter or selector for the whole gallery. */
  action?: React.ReactNode
  /** One quiet line beneath the heading: a summary, a caveat. */
  note?: React.ReactNode
  flow?: TileFlow
  children: React.ReactNode
}) {
  return (
    <div data-testid="desktop-gallery" data-flow={flow} className="px-6 pb-10 pt-5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h1 className="min-w-0 truncate text-[19px] font-semibold tracking-tight">{title}</h1>
        {count != null && <span className="font-mono text-[11px] text-gray-500">{count}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {note && <div className="mt-1.5">{note}</div>}
      <div
        className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-6 xl:grid-cols-9 2xl:grid-cols-12"
        style={{ gridAutoRows: 'minmax(168px, auto)', gridAutoFlow: 'row' }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Rank to size, for the three lenses that rank.
 *
 * The top of the list gets the room, and richness never demotes it: a sparse
 * rank #1 is still HERO, and states its case with a number and typography
 * rather than a fabricated chart. Cutoffs scale with the population so a book
 * of four positions does not render three heroes.
 */
export function sizeByRank(index: number, total: number): TileSize {
  if (total <= 2) return index === 0 ? 'hero' : 'large'
  if (index === 0) return 'hero'
  if (index === 1) return 'large'
  // Two mediums fill the row beside the hero's second line; everything after
  // that is a scanning unit. A page of forty does not get ten mediums.
  if (index <= 3) return 'medium'
  return 'compact'
}

/**
 * Chronological decks: newest carries the most weight, history gets denser.
 *
 * This is NOT a ranking. The order is the order; what changes is how much room
 * each record gets, which is the same thing a newspaper does with today's front
 * page and last week's briefs. Nothing is reordered to make a nicer layout.
 */
export function sizeByRecency(index: number): TileSize {
  if (index === 0) return 'hero'
  if (index === 1) return 'large'
  if (index <= 3) return 'medium'
  return 'compact'
}

/**
 * One tile.
 *
 * A real `<button>`, so it focuses, takes Enter and Space, and announces
 * itself — never a div wearing an onClick.
 *
 * There is no persistent selected ring. Stage 2A needed one to tie a tile to
 * the workspace beneath it; nothing sits beneath it now, and the moment a tile
 * is opened the gallery is gone. Hover and focus are what a reader needs here.
 *
 * `eyebrow` carries the issue and any trailing figure; `children` is the body.
 * Deliberately no footer slot — a call to action here would rebuild the
 * duplicate-verb problem this model exists to avoid.
 */
export function DesktopTile({
  onOpen, eyebrow, tone = 'neutral', size = 'compact', flow = 'ranked',
  testId, dataAttrs, children,
}: {
  onOpen: () => void
  eyebrow: React.ReactNode
  /** How much room this object earned. Importance, never severity. */
  size?: TileSize
  flow?: TileFlow
  /**
   * How loud this tile is allowed to be.
   *
   * Only the eyebrow band and, at `critical`, the border carry it -- never the
   * body ground, which would make the text harder to read to say something the
   * badge already says. `neutral` is the default and most tiles keep it: a
   * gallery where everything is coloured says nothing.
   */
  tone?: SemanticTone
  testId?: string
  dataAttrs?: Record<string, string | undefined>
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-testid={testId ?? 'desktop-tile'}
      data-tone={tone}
      data-size={size}
      onClick={onOpen}
      {...Object.fromEntries(Object.entries(dataAttrs ?? {}).filter(([, v]) => v != null))}
      className={clsx(
        SPAN[flow][size],
        'flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-white text-left shadow-sm',
        'transition-shadow hover:shadow-md',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
        'active:shadow-sm dark:bg-[#141a25]',
        tone === 'critical'
          ? 'border-rose-300 hover:border-rose-400 dark:border-rose-900/60'
          : 'border-gray-200 hover:border-gray-300 dark:border-white/[0.08] dark:hover:border-white/20',
      )}
    >
      {/*
        The eyebrow is a line, not a band.

        Every card used to wear a tinted strip across its top, so a lens of
        fifteen review-due names read as fifteen alerts stacked in a queue.
        Condition now reads through the state label's own colour and a hairline
        rule; the tint is reserved for a genuine break, where being loud is the
        point.
      */}
      <div className={clsx(
        'flex flex-wrap items-center gap-1.5 border-b border-gray-200/70 dark:border-white/[0.06]',
        tone === 'critical' && 'bg-rose-50/60 dark:bg-rose-950/20',
        size === 'hero' ? 'px-5 py-2' : size === 'large' ? 'px-4 py-2' : 'px-3 py-1.5',
      )}>
        {eyebrow}
      </div>
      <div className={clsx(
        'flex min-w-0 flex-1 flex-col',
        size === 'hero' ? 'gap-4 px-5 py-4'
          : size === 'large' ? 'gap-3 px-4 py-3.5'
          : size === 'medium' ? 'gap-2 px-4 py-3'
          : 'gap-1.5 px-3 py-2.5',
      )}>
        {children}
      </div>
    </button>
  )
}

/**
 * The tile's state badge. One per tile, always first in the eyebrow.
 *
 * Exists so four workspaces stop hand-rolling the same rounded-full span with
 * the same four class strings and drifting apart by a pixel each time.
 */
export function TileState({ tone, children }: { tone: SemanticTone; children: React.ReactNode }) {
  return (
    <span className={clsx(
      'text-[10px] font-semibold uppercase tracking-wider',
      STATE_INK[tone],
    )}>
      {children}
    </span>
  )
}

/** Condition, as ink on the label. The lightest treatment that still reads. */
const STATE_INK: Record<SemanticTone, string> = {
  critical: 'text-rose-700 dark:text-rose-400',
  review: 'text-amber-700 dark:text-amber-500',
  info: 'text-blue-700 dark:text-blue-400',
  neutral: 'text-gray-500',
}

/* ------------------------------------------------------------ tile pieces */

/** Object identity: the symbol, and the name where it fits. */
export function TileIdentity({
  symbol, name, size = 'compact',
}: { symbol: string | null; name?: string | null; size?: TileSize }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className={clsx(
        'font-black leading-none tracking-[-0.03em]',
        size === 'hero' ? 'text-[30px]'
          : size === 'large' ? 'text-[24px]'
          : size === 'medium' ? 'text-[20px]'
          : 'text-[17px]',
      )}>{symbol ?? '—'}</span>
      {name && (
        <span className={clsx(
          'min-w-0 truncate font-medium text-gray-500',
          size === 'hero' ? 'text-[13px]' : 'text-[11px]',
        )}>{name}</span>
      )}
    </div>
  )
}

/**
 * The one number that IS the finding.
 *
 * For tiles whose most important fact is a quantity: what a position is worth
 * to a book, how much arrived, how long since anyone looked. Set at a size that
 * reads across the gallery, because burying it in 11px metadata is how a page
 * of investment facts ends up looking like a list of labels.
 *
 * This is what earns a hero its space when there is no honest chart to draw.
 */
export function TileHeroNumber({
  figure, unit, label, tone = 'neutral',
}: {
  figure: React.ReactNode
  unit?: string
  label: React.ReactNode
  tone?: SemanticTone
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1">
        <span className={clsx(
          'font-mono text-[44px] font-semibold leading-[0.95] tabular-nums tracking-[-0.035em]',
          tone === 'critical' ? 'text-rose-700 dark:text-rose-400'
            : tone === 'review' ? 'text-amber-700 dark:text-amber-400'
            : 'text-gray-900 dark:text-gray-100',
        )}>
          {figure}
        </span>
        {unit && <span className="text-[15px] font-semibold text-gray-500">{unit}</span>}
      </div>
      <div className="mt-1 text-[12px] leading-snug text-gray-600 dark:text-gray-400">{label}</div>
    </div>
  )
}

/** Why it matters. Two lines at most — the workspace carries the rest. */
export function TileReason({ children }: { children: React.ReactNode }) {
  return (
    <p className="line-clamp-2 text-[11px] leading-snug text-gray-700 dark:text-gray-300">
      {children}
    </p>
  )
}

/**
 * The claim itself, set as the centre of the tile.
 *
 * `TileReason` is a caption -- one system-generated sentence explaining why an
 * object surfaced. This is different: it is what a person actually wrote, and
 * on a tile whose whole content is a belief it should be the largest thing
 * there, ahead of every pill and count around it.
 */
export function TileClaim({
  children, size = 'compact',
}: { children: React.ReactNode; size?: TileSize }) {
  return (
    <p className={clsx(
      'text-gray-900 dark:text-gray-100',
      size === 'hero' ? 'line-clamp-5 text-[17px] leading-[1.5]'
        : size === 'large' ? 'line-clamp-4 text-[15px] leading-[1.5]'
        : size === 'medium' ? 'line-clamp-3 text-[13px] leading-[1.5]'
        : 'line-clamp-2 text-[12px] leading-[1.45]',
    )}>
      {children}
    </p>
  )
}

/**
 * Someone's recorded words, quoted as words.
 *
 * Only ever for text a human wrote. A machine-generated string set in quotes
 * would claim an author it does not have -- the distinction Decisions V1
 * established, carried onto the tile.
 */
export function TileQuote({
  children, size = 'compact',
}: { children: React.ReactNode; size?: TileSize }) {
  return (
    <blockquote className={clsx(
      'border-l-[2.5px] border-gray-400 italic text-gray-900 dark:border-white/25 dark:text-gray-100',
      size === 'hero' ? 'line-clamp-6 pl-4 text-[17px] leading-[1.5]'
        : size === 'large' ? 'line-clamp-5 pl-3.5 text-[15px] leading-[1.5]'
        : size === 'medium' ? 'line-clamp-4 pl-3 text-[13px] leading-[1.5]'
        : 'line-clamp-3 pl-2.5 text-[12px] leading-[1.45]',
    )}>
      {children}
    </blockquote>
  )
}

/**
 * One figure large enough to read across the gallery, with what it counts.
 *
 * For tiles whose most useful fact is a quantity rather than a sentence -- how
 * much arrived, how long since anyone looked. The figure carries tone only
 * where the quantity itself is the problem.
 */
export function TileLead({
  figure, unit, label, tone = 'neutral',
}: {
  figure: React.ReactNode
  unit?: string
  label: React.ReactNode
  tone?: SemanticTone
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={clsx(
        'font-mono text-[26px] font-semibold leading-none tabular-nums tracking-[-0.02em]',
        tone === 'critical' ? 'text-rose-700 dark:text-rose-400'
          : tone === 'review' ? 'text-amber-700 dark:text-amber-400'
          : 'text-gray-900 dark:text-gray-100',
      )}>
        {figure}
      </span>
      {unit && <span className="text-[11px] font-semibold text-gray-500">{unit}</span>}
      <span className="min-w-0 text-[11px] leading-tight text-gray-600 dark:text-gray-400">{label}</span>
    </div>
  )
}

/**
 * Which parts of a structure exist, and which do not.
 *
 * A presence strip, never a completion score: "3 of 5 sections" invites a
 * reader to finish a form, when the question is whether the case makes its
 * argument. Names the missing parts so the absence is specific.
 */
export function TileSections({ present, all }: { present: readonly string[]; all: readonly string[] }) {
  const have = new Set(present)
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-1">
      {all.map(name => (
        <span
          key={name}
          className={clsx(
            'text-[10px] font-bold uppercase tracking-widest',
            have.has(name)
              ? 'text-gray-700 dark:text-gray-300'
              : 'text-gray-300 line-through decoration-1 dark:text-gray-600',
          )}
        >
          {name}
        </span>
      ))}
    </div>
  )
}

/** Muted context beneath the reason: a book, an actor, a date. */
export function TileMeta({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[10px] text-gray-500">
      {children}
    </div>
  )
}

/** Right-aligned figure in the eyebrow: a weight, an age, a value. */
export function TileFigure({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span className={clsx(
      'ml-auto shrink-0 font-mono text-[10px] tabular-nums',
      strong ? 'font-semibold text-gray-800 dark:text-gray-200' : 'text-gray-500',
    )}>
      {children}
    </span>
  )
}

/**
 * A compact visual, only where the data earns one.
 *
 * Kept short so a tile stays a tile. A surface that has nothing honest to draw
 * renders nothing here rather than a decorative sparkline.
 */
export function TileVisual({ children }: { children: React.ReactNode }) {
  return <div className="mt-auto pt-1">{children}</div>
}

/**
 * A magnitude bar, scaled against the largest in view.
 *
 * Against the field rather than against 100, because a book of forty names
 * would otherwise draw forty indistinguishable slivers. The number is always
 * printed beside it: the bar is for comparison, the figure is the fact.
 */
export function TileBar({
  pct, max, label, tone = 'neutral', population,
}: {
  pct: number
  max?: number
  label: string
  tone?: 'neutral' | 'attention' | 'critical'
  /**
   * Every peer's weight, so the bar can draw a distribution instead of a
   * meter. Optional: without it this falls back to the single mark.
   */
  population?: number[]
}) {
  const ceiling = Math.max(max ?? 0, pct, 1)

  /*
   * ── Why this stopped being a progress bar ────────────────────────────────
   *
   * It filled to `pct / max`, where `max` is the largest position among the
   * peers on screen. For that largest position -- which is exactly the one a
   * reader is most likely to be looking at -- the bar is 100% full, every
   * time, and says nothing. Ideas had the identical defect and it was fixed
   * the same way: draw the population, and ink the one you are on.
   *
   * The shape carries three answers the bar could not: how big this stake is,
   * how big it is RELATIVE TO the rest, and whether the set is concentrated
   * or flat. A 7.4% top position among peers that decay to 0.3% is a
   * different fact from a 7.4% top position among peers that all sit above
   * 6%, and the bar drew both identically.
   *
   * Rounded pill fills go with it. A fat rounded bar is the most
   * consumer-looking mark a desk tool can carry, and it was reading as
   * progress toward a limit this product does not have -- there is no policy
   * or constraint table anywhere in the schema for it to be a fraction of.
   */
  /*
   * A distribution needs a population to be a distribution.
   *
   * With four members `flex-1` gives each bar a quarter of the tile and the
   * chart becomes four fat blocks -- less legible than the bar it replaced,
   * and claiming a shape that four numbers do not have. Below the threshold
   * this falls back to the single mark, which is an honest way to show one
   * value against one comparator.
   */
  const bars = (population?.length ?? 0) >= 8
    ? [...population!].sort((a, b) => b - a)
    : null
  // Ties are real (two 1.2% stakes), so the inked bar is the FIRST unclaimed
  // match rather than every bar of the same height.
  const mine = bars ? bars.findIndex(w => w === pct) : -1

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">{label}</span>
        <span className="ml-auto font-mono text-[11px] font-semibold tabular-nums">{pct.toFixed(1)}%</span>
      </div>

      {bars ? (
        <div className="mt-1.5 flex h-[34px] w-full items-end gap-px" data-testid="tile-population">
          {bars.map((w, i) => (
            <div
              key={i}
              data-mine={i === mine || undefined}
              className={clsx(
                // Capped, so a ten-name set does not stretch into blocks
                // while a forty-name set still fills the width.
                'min-w-0 max-w-[14px] flex-1 rounded-t-[1px]',
                i === mine
                  ? tone === 'critical' ? 'bg-rose-600 dark:bg-rose-400'
                    : tone === 'attention' ? 'bg-amber-600 dark:bg-amber-400'
                    : 'bg-slate-900 dark:bg-white'
                  : 'bg-slate-300/90 dark:bg-white/20',
              )}
              // A floor of 2%: a tail position is still a position, and a bar
              // of zero height reads as a set that ends early.
              style={{ height: `${Math.max(2, (w / ceiling) * 100)}%` }}
            />
          ))}
        </div>
      ) : (
        <div className="mt-1.5 h-[3px] w-full bg-gray-200 dark:bg-white/10">
          <div
            className={clsx(
              'h-full',
              tone === 'critical' ? 'bg-rose-600' : tone === 'attention' ? 'bg-amber-600' : 'bg-slate-900 dark:bg-white',
            )}
            style={{ width: `${Math.min(100, (pct / ceiling) * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Spot against a two-or-more-rung ladder, at tile scale.
 *
 * The same claim the workspace's full scale makes, reduced to the one thing
 * worth seeing at a glance: whether spot sits inside the range the case
 * defined, or outside it. Renders nothing without a real range.
 */
export function TileScale({
  low, high, spot, outside,
}: { low: number; high: number; spot: number; outside: boolean }) {
  if (!(high > low) || !(spot > 0)) return null
  const min = Math.min(low, spot), max = Math.max(high, spot)
  const pad = (max - min) * 0.1 || max * 0.05
  const at = (v: number) => ((v - (min - pad)) / ((max + pad) - (min - pad))) * 100
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">
          Spot vs case
        </span>
        <span className={clsx(
          'ml-auto font-mono text-[10px] font-semibold',
          outside ? 'text-rose-600 dark:text-rose-400' : 'text-gray-500',
        )}>
          {outside ? 'outside' : 'inside'}
        </span>
      </div>
      <div className="relative mt-1 h-[10px]">
        <div className="absolute top-[3px] h-[4px] rounded-full bg-gray-200 dark:bg-white/15"
             style={{ left: `${at(low)}%`, width: `${Math.max(0, at(high) - at(low))}%` }} />
        <i className={clsx(
          'absolute top-0 h-[10px] w-[2px] rounded',
          outside ? 'bg-rose-600' : 'bg-blue-600',
        )} style={{ left: `${at(spot)}%` }} />
      </div>
    </div>
  )
}

/**
 * Today's price against a stated target, and the distance between them.
 *
 * Typographic rather than drawn: two prices and a percentage is the whole
 * fact, and a two-point chart would add pixels without adding information.
 * The distance is never graded -- a 40% gap to target is a statement about the
 * desk's own view, not about whether the idea is working.
 */
export function TileGap({ spot, target, label }: { spot: number; target: number; label: string }) {
  if (!(spot > 0) || !(target > 0)) return null
  const gap = ((target - spot) / spot) * 100
  return (
    <div>
      <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">{label}</span>
      <div className="mt-0.5 flex items-baseline gap-1.5 font-mono tabular-nums">
        <span className="text-[13px] font-semibold">{spot.toFixed(2)}</span>
        <span className="text-[11px] text-gray-400">&rarr;</span>
        <span className="text-[13px] font-semibold">{target.toFixed(2)}</span>
        <span className="ml-auto text-[11px] font-semibold text-gray-600 dark:text-gray-400">
          {gap >= 0 ? '+' : ''}{gap.toFixed(0)}%
        </span>
      </div>
    </div>
  )
}

/** A price path, one ink, at tile scale. Never graded by direction. */
export function TileSpark({ series, label }: { series: number[]; label: string }) {
  if (series.length < 2) return null
  const W = 200, H = 22
  const min = Math.min(...series), max = Math.max(...series)
  const span = (max - min) || 1
  const d = series
    .map((v, i) => `${((i * W) / (series.length - 1)).toFixed(1)},${(H - 2 - (H - 4) * ((v - min) / span)).toFixed(1)}`)
    .join(' L')
  const change = ((series[series.length - 1] - series[0]) / series[0]) * 100
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">{label}</span>
        <span className="ml-auto font-mono text-[11px] font-semibold tabular-nums">
          {change >= 0 ? '+' : ''}{change.toFixed(1)}%
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-0.5 w-full" style={{ height: H }}
           role="img" aria-label={`${label}, ${change.toFixed(1)} percent`}>
        <path d={`M${d} L${W},${H} L0,${H} Z`} className="fill-slate-500 opacity-[0.09]" />
        <path d={`M${d}`} fill="none" strokeWidth={1.4} strokeLinejoin="round"
              className="stroke-slate-500 dark:stroke-slate-400" />
      </svg>
    </div>
  )
}
