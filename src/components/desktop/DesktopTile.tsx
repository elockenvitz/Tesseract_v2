/**
 * The scan layer: ranked visual tiles above the workspace they drive.
 *
 * ── Why this replaces the left rail ──────────────────────────────────────
 *
 * Stage 1 unified four navigators onto one flat, ruled, 27%-wide list. It was
 * coherent and it was the wrong model. A 252px column can hold a symbol, a
 * pill and a number — so every surface converged on the one shape that fits
 * there, and four investment workspaces started reading as back-office record
 * browsers. The weight bar, the framework scale, the since-review path: none of
 * them fit in a rail, so none of them were shown, so the scan carried no
 * investment content at all.
 *
 * Width is the whole point. A tile with the full page to work in can show what
 * a position weighs, where spot sits against its own case, or what the price
 * did since a decision — the things a reader is actually scanning for. So the
 * scan band runs across the top and the workspace sits beneath it, and both
 * regions get room rather than one starving the other.
 *
 * ── Still one selected object ────────────────────────────────────────────
 *
 * The failure the rail was correcting is still a failure: the old three-column
 * landing pages each carried their own call to action, so every tile competed
 * with the workspace for the same decision. Tiles here have NO action row.
 * Selecting is the action; the workspace owns the verbs. One object, one
 * workspace, one authoritative action row.
 *
 * ── Shared discipline, not shared content ────────────────────────────────
 *
 * This owns the shell: geometry, selected state, the header strip, spacing.
 * What a tile SAYS stays with the surface, because an idea, a case, a position
 * and a decision are not the same object and should not be made to look like
 * one.
 */

import { useEffect, useRef } from 'react'
import { clsx } from 'clsx'

/**
 * The band of tiles.
 *
 * Capped in height so the workspace beneath is always visible — the scan is a
 * region of the page, not the page. Roughly two rows are in view at once and
 * the rest scrolls, which is what "several at a glance" means in practice.
 */
export function DesktopScanBand({
  title, count, action, children,
}: {
  title: React.ReactNode
  count?: number
  /** A filter or selector for the whole scan. */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section
      data-testid="desktop-scan-band"
      className="shrink-0 border-b border-gray-200 bg-gray-50/60 dark:border-white/10 dark:bg-[#0b0f16]"
    >
      <div className="flex items-center gap-2 px-6 pt-4">
        <h2 className="min-w-0 truncate text-[13px] font-semibold tracking-tight">{title}</h2>
        {count != null && <span className="font-mono text-[10.5px] text-gray-500">{count}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {/* Two full rows of tiles at a glance, the rest a scroll away, and the
          workspace always visible beneath. Capped in vh as well as pixels so a
          short window does not give the scan the whole screen. */}
      <div className="max-h-[min(42vh,340px)] overflow-y-auto px-6 pb-4 pt-2.5">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {children}
        </div>
      </div>
    </section>
  )
}

/**
 * One tile.
 *
 * `eyebrow` carries the issue and any trailing figure; `children` is the body.
 * Deliberately no footer slot — a call to action here would rebuild the
 * duplicate-verb problem the rail was introduced to solve.
 */
export function DesktopTile({
  selected, onSelect, eyebrow, testId, dataAttrs, children,
}: {
  selected: boolean
  onSelect: () => void
  eyebrow: React.ReactNode
  testId?: string
  dataAttrs?: Record<string, string | undefined>
  children: React.ReactNode
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected && ref.current && typeof ref.current.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId ?? 'desktop-tile'}
      aria-current={selected}
      onClick={onSelect}
      {...Object.fromEntries(Object.entries(dataAttrs ?? {}).filter(([, v]) => v != null))}
      className={clsx(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border bg-white text-left transition-shadow dark:bg-[#141a25]',
        selected
          // The selected tile is the one the workspace below is showing, so it
          // is marked unmistakably rather than tinted.
          ? 'border-blue-600 shadow-[0_0_0_1px_theme(colors.blue.600)] dark:border-blue-500'
          : 'border-gray-200 shadow-sm hover:border-gray-300 hover:shadow-md dark:border-white/[0.08] dark:hover:border-white/20',
      )}
    >
      <div className={clsx(
        'flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5',
        selected
          ? 'border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/30'
          : 'border-gray-200/80 bg-gray-50/80 dark:border-white/10 dark:bg-white/[0.03]',
      )}>
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
