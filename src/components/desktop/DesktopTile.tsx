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

/**
 * The gallery.
 *
 * A responsive grid across the whole workspace — three or four columns on a
 * desktop, two on a laptop, one only where the viewport forces it. No height
 * cap, because nothing is sharing the canvas with it any more.
 */
export function DesktopGallery({
  title, count, action, note, children,
}: {
  title: React.ReactNode
  count?: number
  /** A filter or selector for the whole gallery. */
  action?: React.ReactNode
  /** One quiet line beneath the heading: a summary, a caveat. */
  note?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div data-testid="desktop-gallery" className="px-6 pb-10 pt-5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h1 className="min-w-0 truncate text-[19px] font-semibold tracking-tight">{title}</h1>
        {count != null && <span className="font-mono text-[11px] text-gray-500">{count}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {note && <div className="mt-1.5">{note}</div>}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {children}
      </div>
    </div>
  )
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
  onOpen, eyebrow, testId, dataAttrs, children,
}: {
  onOpen: () => void
  eyebrow: React.ReactNode
  testId?: string
  dataAttrs?: Record<string, string | undefined>
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-testid={testId ?? 'desktop-tile'}
      onClick={onOpen}
      {...Object.fromEntries(Object.entries(dataAttrs ?? {}).filter(([, v]) => v != null))}
      className={clsx(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-sm',
        'transition-shadow hover:border-gray-300 hover:shadow-md',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
        'active:shadow-sm dark:border-white/[0.08] dark:bg-[#141a25] dark:hover:border-white/20',
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200/80 bg-gray-50/80 px-3 py-1.5 dark:border-white/10 dark:bg-white/[0.03]">
        {eyebrow}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5">{children}</div>
    </button>
  )
}

/* ------------------------------------------------------------ tile pieces */

/** Object identity: the symbol, and the name where it fits. */
export function TileIdentity({ symbol, name }: { symbol: string | null; name?: string | null }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="font-black text-[19px] leading-none tracking-[-0.03em]">{symbol ?? '—'}</span>
      {name && <span className="min-w-0 truncate text-[11px] font-medium text-gray-500">{name}</span>}
    </div>
  )
}

/** Why it matters. Two lines at most — the workspace carries the rest. */
export function TileReason({ children }: { children: React.ReactNode }) {
  return (
    <p className="line-clamp-2 text-[11.5px] leading-snug text-gray-700 dark:text-gray-300">
      {children}
    </p>
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
      'ml-auto shrink-0 font-mono text-[10.5px] tabular-nums',
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
  pct, max, label, tone = 'neutral',
}: {
  pct: number
  max?: number
  label: string
  tone?: 'neutral' | 'attention' | 'critical'
}) {
  const ceiling = Math.max(max ?? 0, pct, 1)
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[8.5px] font-semibold uppercase tracking-[0.08em] text-gray-500">{label}</span>
        <span className="ml-auto font-mono text-[11px] font-semibold tabular-nums">{pct.toFixed(1)}%</span>
      </div>
      <div className="mt-0.5 h-[5px] w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
        <div
          className={clsx(
            'h-full rounded-full',
            tone === 'critical' ? 'bg-rose-500' : tone === 'attention' ? 'bg-amber-500' : 'bg-blue-600',
          )}
          style={{ width: `${Math.min(100, (pct / ceiling) * 100)}%` }}
        />
      </div>
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
        <span className="text-[8.5px] font-semibold uppercase tracking-[0.08em] text-gray-500">
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
        <span className="text-[8.5px] font-semibold uppercase tracking-[0.08em] text-gray-500">{label}</span>
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
