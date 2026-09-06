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

import { useRef, useState } from 'react'
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
  /*
   * ── `row-span-2` removed from the hero ───────────────────────────────────
   *
   * It guaranteed the hero two rows of height regardless of what it had to
   * say, and the second row's height came from whatever stacked beside it --
   * so the widest tile on Portfolio, Research and Decisions was routinely
   * 200-300px taller than its own contents, with the gap sitting in the
   * middle of the card between the prose and the bottom-pinned visual.
   *
   * Prominence was the reason for it, and prominence survives: the hero is
   * still the first tile and still the widest by a whole column. Width is a
   * claim the content can actually fill; height was one it could not.
   */
  ranked: {
    hero: 'md:col-span-6 xl:col-span-5 2xl:col-span-6',
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
    hero: 'md:col-span-6 xl:col-span-5 2xl:col-span-6',
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
      {/*
        Rows size to their content.

        This was `minmax(168px, auto)`, which is a FLOOR: a compact tile
        carrying a ticker and one figure got 168px and left about a hundred of
        them blank, and a hero spanning two rows was guaranteed 336px whether
        or not it had 336px to say. Measured across Portfolio, Research and
        Decisions that was the single largest quantity of white on each page,
        and no amount of restyling the contents fixes a card that is taller
        than its contents by construction.

        A small floor survives so a nearly-empty tile is still a tile rather
        than a sliver, and `row-span-2` still works: a hero taller than two
        content rows grows them, which is what grid does.
      */}
      <div
        className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-6 xl:grid-cols-9 2xl:grid-cols-12"
        style={{ gridAutoRows: 'minmax(88px, auto)', gridAutoFlow: 'row' }}
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
      /*
        The Ideas card, everywhere.

        ── What changed and why ─────────────────────────────────────────────
        *
        A drop shadow under every tile is what makes a field read as a stack
        of floating panels rather than as one instrument, and a large radius
        reads friendly where this surface is meant to read precise. Ideas took
        both out and the difference was the single most-noticed thing about
        it; the other four lenses kept `rounded-xl` and `shadow-sm`, so they
        went on looking like a different product one tab away.

        A hairline and the page's own ground do the work. Hover moves the
        border colour rather than lifting the card off the page.
      */
      className={clsx(
        SPAN[flow][size],
        'flex h-full min-w-0 flex-col overflow-hidden rounded-[3px] border bg-white text-left',
        'transition-colors duration-100',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
        'dark:bg-[#141a25]',
        tone === 'critical'
          ? 'border-rose-300 hover:border-rose-400 dark:border-rose-900/60'
          : 'border-gray-200 hover:border-gray-400 dark:border-white/[0.08] dark:hover:border-white/25',
      )}
    >
      {/*
        The eyebrow is a line ON the card, not a header above it.

        It was already untinted, but it was still a separate row with its own
        rule under it and its own padding -- which reads as a header band
        whatever colour it is, and is what made these lenses look like a queue
        of filed records beside Ideas' field of objects. Ideas puts the same
        words on the same ground as the ticker, directly above it, with
        nothing between them.

        The tint survives for `critical` only, where being loud is the point.
      */}
      <div className={clsx(
        'flex min-w-0 flex-1 flex-col',
        tone === 'critical' && 'bg-rose-50/60 dark:bg-rose-950/20',
        size === 'hero' ? 'gap-4 p-5' : size === 'large' ? 'gap-3 p-4'
          : size === 'medium' ? 'gap-2 p-4' : 'gap-1.5 p-3',
      )}>
        <div className="flex flex-wrap items-center gap-1.5">
          {eyebrow}
        </div>
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
      // The Ideas label rhythm: 10px bold with wide tracking was borrowed
      // from the phone, where a label sits alone on a large tile. Ten of
      // those on one desktop field reads as shouting.
      'text-[10px] font-medium uppercase tracking-[0.08em]',
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
      {/*
        Subordinate to the ticker, and inked.

        This was 44px in amber, which made it the largest and loudest thing on
        the page -- larger than the object it describes. Ideas' system file
        names that exactly: "a 26px +8% is a consumer app's hero stat", and a
        card that leads with a percentage instead of a name is a statistic
        rather than an investment object.

        The tone survives for a genuine break, where the number IS the
        finding. `review` does not qualify: a thesis due for review is a fact
        about the calendar, and painting its weight amber says the position is
        wrong when nobody has claimed that.
      */}
      <div className="flex items-baseline gap-1">
        <span className={clsx(
          'font-mono text-[30px] font-semibold leading-[0.95] tabular-nums tracking-[-0.03em]',
          tone === 'critical'
            ? 'text-rose-700 dark:text-rose-400'
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
      {/* Tone only for a genuine break, exactly as `TileHeroNumber` does it.
          `review` is a fact about the calendar; colouring the quantity amber
          claims the quantity is wrong, which nobody has said. */}
      <span className={clsx(
        'font-mono text-[26px] font-semibold leading-none tabular-nums tracking-[-0.02em]',
        tone === 'critical'
          ? 'text-rose-700 dark:text-rose-400'
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
  /*
   * Ten, not eight. At eight the bars are an eighth of the tile each and the
   * chart reads as a row of blocks rather than a distribution; the fallback
   * single mark is the honest drawing of a small set.
   */
  const bars = (population?.length ?? 0) >= 10
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
        // 56px, not 34: at 34 a 0.4% stake against a 7.4% ceiling was a single
        // pixel, which is a distribution nobody can read the bottom half of.
        <div className="mt-1.5 flex h-[56px] w-full items-end gap-px" data-testid="tile-population">
          {bars.map((w, i) => (
            <div
              key={i}
              data-mine={i === mine || undefined}
              className={clsx(
                // No width cap: the population threshold above already keeps
                // small sets out, and capping left a 22-name book clustered
                // in the first quarter of its own tile.
                'min-w-0 flex-1 rounded-t-[1px]',
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
  /*
   * The ladder reads, as it does on Ideas.
   *
   * A ladder IS a price axis: every x on it is a price, and "what would a 12%
   * drawdown put me at, and is that still inside what we underwrote" is the
   * question the picture exists to answer. Ideas' `RangeChart` was made
   * scrubbable for exactly that reason and this is the tile-sized version of
   * the same object, so it gets the same contract -- one piece of local
   * state, and the caption swapping in place so nothing moves.
   */
  const band = useRef<HTMLDivElement | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  if (!(high > low) || !(spot > 0)) return null
  const min = Math.min(low, spot), max = Math.max(high, spot)
  const pad = (max - min) * 0.1 || max * 0.05
  const lo = min - pad, hi = max + pad
  const at = (v: number) => ((v - lo) / (hi - lo)) * 100
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
          {scrub == null ? 'Spot vs case' : (
            <span className="font-mono tracking-normal normal-case text-gray-600 dark:text-gray-300">
              {scrub.toFixed(2)}{' '}
              {scrub < low ? 'below the case' : scrub > high ? 'above the case' : 'inside the case'}
            </span>
          )}
        </span>
        <span className={clsx(
          'ml-auto font-mono text-[10px] font-semibold',
          outside ? 'text-rose-600 dark:text-rose-400' : 'text-gray-500',
        )}>
          {outside ? 'outside' : 'inside'}
        </span>
      </div>
      {/*
        The tile-scale version of the Ideas ladder, in the same language.

        It was a 4px rounded pill with a rounded marker riding it. Ideas'
        `RangeChart` draws the underwritten span as a band running bear to
        bull -- the left edge is the desk's downside case and the right its
        upside, so the gradient states the direction of the range rather than
        decorating it -- and marks today with a square-ended rule. Same claim,
        same drawing, one twelfth the height.
      */}
      <div
        ref={band}
        data-testid="tile-scale"
        className="relative mt-1 h-[14px] cursor-crosshair"
        onPointerMove={e => {
          if (e.pointerType !== 'mouse' || !band.current) return
          const r = band.current.getBoundingClientRect()
          // A zero-width rect is real -- measured before layout, or inside a
          // collapsed container -- and dividing by it printed "NaN".
          if (r.width <= 0) return
          const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
          setScrub(lo + f * (hi - lo))
        }}
        onPointerLeave={() => setScrub(null)}
      >
        <div
          className="absolute inset-y-0 bg-gradient-to-r from-rose-500/[0.16] via-slate-400/[0.10] to-emerald-500/[0.16] dark:from-rose-400/[0.18] dark:via-white/[0.07] dark:to-emerald-400/[0.18]"
          style={{ left: `${at(low)}%`, width: `${Math.max(0, at(high) - at(low))}%` }}
        />
        <i className={clsx(
          'absolute inset-y-[-2px] w-[2px]',
          outside ? 'bg-rose-600' : 'bg-blue-600',
        )} style={{ left: `${at(spot)}%` }} />
        {scrub != null && (
          <span
            className="pointer-events-none absolute inset-y-[-3px] w-px bg-slate-900 dark:bg-white"
            style={{ left: `${at(scrub)}%` }}
          />
        )}
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

/**
 * The case's age, and the evidence that arrived after it.
 *
 * ── Why this is shared, and why it is a timeline ─────────────────────────
 *
 * Written for Research, which asks where the case needs work. A price path
 * answers a different lens's question, and that scan deliberately never loads
 * one -- it reads timestamps and counts, and pulling a series per tile would
 * move megabytes to draw a line nobody came there for.
 *
 * It lives here because Portfolio asks the same question in different words:
 * "where this book and the written framework disagree" IS "how long has this
 * case been standing, and how much has landed since". Both lenses already
 * hold `thesisUpdatedAt`, the newest evidence date and the count between
 * them, and both were drawing three sentences of prose above eighty pixels
 * of nothing.
 *
 * What it does hold is exactly the shape of the problem: the date the case
 * was last written, the date the newest evidence landed, and how many items
 * arrived in between. That was three separate sentences of prose on a card
 * with three hundred pixels of nothing under them. As a line it is one
 * glance: how long the case has been standing, and how much of the window
 * since has produced work nobody has folded in.
 *
 * Same vocabulary as every other visual on the desktop -- an open ring for
 * where we started, a solid mark for the latest print, a shaded span for the
 * distance between them, and the window named underneath.
 */
export function TileTimeline({
  writtenAt, newestAt, count,
}: { writtenAt: string | null; newestAt: string | null; count: number }) {
  const track = useRef<HTMLDivElement | null>(null)
  const [pick, setPick] = useState<number | null>(null)
  const written = writtenAt ? new Date(writtenAt).getTime() : null
  if (!written || Number.isNaN(written)) return null
  const now = Date.now()
  const span = now - written
  // A case written today has no window to draw yet, and a zero-width span
  // would put both marks on top of each other at 0%.
  if (span < 86_400_000) return null

  /*
   * The track reads: pointing at it says which date that is and how long ago.
   *
   * "How long has this case been standing" is the question the line draws,
   * and the two labelled ends only answer it at the ends. Every x between
   * them is a date, exactly as every x on a ladder is a price.
   */
  const newest = newestAt ? new Date(newestAt).getTime() : null
  const at = newest && newest > written && newest <= now
    ? ((newest - written) / span) * 100
    : null
  const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

  return (
    <div>
      <div className="flex items-baseline justify-between text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        <span>Case written</span>
        <span className="font-mono tracking-normal normal-case text-gray-500">
          {pick != null
            ? `${day(pick)} · ${Math.max(0, Math.round((now - pick) / 86_400_000))}d ago`
            : count > 0 ? `${count} new since` : 'nothing new since'}
        </span>
      </div>

      <div
        ref={track}
        data-testid="tile-timeline"
        className="relative mt-2 h-[22px] w-full cursor-crosshair"
        onPointerMove={e => {
          if (e.pointerType !== 'mouse' || !track.current) return
          const r = track.current.getBoundingClientRect()
          if (r.width <= 0) return
          const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
          setPick(written + f * span)
        }}
        onPointerLeave={() => setPick(null)}
      >
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-200 dark:bg-white/10" />
        {pick != null && (
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-slate-900 dark:bg-white"
            style={{ left: `${((pick - written) / span) * 100}%` }}
          />
        )}
        {/* The stretch that produced work the case has not answered. */}
        {at != null && count > 0 && (
          <div
            className="absolute top-1/2 h-[3px] -translate-y-1/2 bg-amber-500/80 dark:bg-amber-400/70"
            style={{ left: 0, width: `${at}%` }}
          />
        )}
        {/* Where the case was written. */}
        <span
          className="absolute left-0 top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2px] border-slate-500 bg-white dark:border-slate-400 dark:bg-[#141a25]"
        />
        {/* The newest thing nobody has folded in. */}
        {at != null && (
          <span
            className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-600 ring-[2.5px] ring-white dark:bg-amber-400 dark:ring-[#141a25]"
            style={{ left: `${at}%` }}
          />
        )}
        {/* Today. A rule, because it is a boundary rather than an event. */}
        <span className="absolute right-0 top-1/2 h-[14px] w-[2px] -translate-y-1/2 bg-slate-400 dark:bg-slate-500" />
      </div>

      <div className="mt-1 flex items-baseline justify-between text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        <span className="font-mono tracking-normal normal-case">{day(written)}</span>
        {at != null && (
          <span className="font-mono tracking-normal normal-case text-amber-700 dark:text-amber-500">
            newest {day(newest!)}
          </span>
        )}
        <span className="font-mono tracking-normal normal-case">today</span>
      </div>
    </div>
  )
}
