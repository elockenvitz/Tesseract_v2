import React from 'react'
import { clsx } from 'clsx'
import { useAssetWorkspace, primaryPosition } from '../../hooks/useAssetWorkspace'
import { useAnalystRatings } from '../../hooks/useAnalystRatings'

/**
 * UX1a — the persistent investment-context strip.
 *
 * A compact, always-visible row of the load-bearing numbers that today live
 * only inside the Snapshot tab: the firm's rating, its price target and the
 * implied upside, our exposure (attributed to a book), what work is open, and
 * how fresh the case is. It rides inside the asset header, which is already
 * sticky, so these facts stay on screen on every tab.
 *
 * It OWNS no data and adds no query path. It reads the same org-scoped hooks
 * the Snapshot already uses (`useAssetWorkspace`, `useAnalystRatings`), with
 * the same query keys, so React Query serves it from one shared cache and the
 * RLS boundary is unchanged. Nothing here edits anything.
 *
 * Two rules it keeps deliberately:
 *  - Firm vs. personal is never blurred. The rating cell states the FIRM
 *    consensus; the reader's own divergent rating is shown separately as
 *    "You: …", never merged into the consensus figure.
 *  - Absence is stated quietly. A missing rating or target is one muted dash
 *    with "No … yet", not a header full of "Not set".
 */

type Sub = 'snapshot' | 'research' | 'workflow' | 'decisions' | 'lists'

interface Props {
  assetId: string
  symbol: string | null
  /** Live quote price (from the header's StockQuote), preferred over the cached close for upside. */
  spot: number | null
  /** Reuses the page's existing sub-page navigation; no new routing. */
  onOpen?: (sub: Sub) => void
  /** UX2 Phase 1: 'band' renders navy cells + light text for the dark identity
   *  band. Presentation only — the data, hooks and query keys are identical. */
  variant?: 'default' | 'band'
  className?: string
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const signedPct = (n: number) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%'

function monthsSince(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.round((Date.now() - t) / (1000 * 60 * 60 * 24 * 30.44)))
}

const EYEBROW = 'block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'
const VALUE = 'text-[14px] font-semibold text-gray-900 dark:text-gray-100 leading-tight'
const SUB = 'text-[11px] text-gray-500 dark:text-gray-400 leading-tight mt-0.5 truncate'
const DASH = 'text-[14px] font-semibold text-gray-300 dark:text-gray-600 leading-tight'

function Cell({
  label, onClick, title, children, band, eyebrow, dimmed,
}: {
  label: string
  onClick?: () => void
  title?: string
  children: React.ReactNode
  band?: boolean
  eyebrow: string
  /** An absent metric (no rating / no target): kept in place but visually
   *  quieted so the metrics that DO carry data lead the row. */
  dimmed?: boolean
}) {
  const base = band ? 'bg-transparent' : 'bg-white dark:bg-gray-800'
  const hover = band
    ? 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
    : 'hover:bg-gray-50 dark:hover:bg-gray-700/60'
  // Band cells size to their content (a lean row); default cells share the row
  // equally (the tiled grid).
  const sizing = clsx(
    band ? 'flex-none px-4 py-1 first:pl-0' : 'flex-1 min-w-[132px] px-3 py-2',
    band && dimmed && 'opacity-55',
  )
  const inner = (
    <>
      <span className={eyebrow}>{label}</span>
      <div className={clsx(band ? 'mt-0.5' : 'mt-1', 'min-w-0')}>{children}</div>
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`${sizing} text-left ${base} ${hover} transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset`}
      >
        {inner}
      </button>
    )
  }
  return <div className={`${sizing} ${base}`}>{inner}</div>
}

export function AssetContextStrip({ assetId, symbol, spot, onOpen, variant = 'default', className }: Props) {
  const { data, isLoading } = useAssetWorkspace(assetId, symbol, 'overview')
  const { consensus, ratings, myRating } = useAnalystRatings({ assetId })

  const band = variant === 'band'
  // Band variant swaps the cell text to the light-on-navy tokens; default keeps
  // the existing light-surface styling. Logic below is identical either way.
  const EYEBROW_C = band
    ? 'block text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ux2-ink-2)]'
    : EYEBROW
  const VALUE_C = band
    ? 'text-[13.5px] font-semibold tabular-nums tracking-tight text-[color:var(--ux2-ink)] leading-tight'
    : VALUE
  const SUB_C = band
    ? 'text-[11px] text-[color:var(--ux2-ink-2)] leading-tight mt-0.5 truncate'
    : SUB
  const DASH_C = band
    ? 'text-[14px] font-semibold text-[color:var(--ux2-ink-2)] leading-tight'
    : DASH
  // Band variant (the asset header): a compact inline context ROW — thin
  // dividers between facts, no boxed cells, no outer frame — so it supports the
  // page rather than dominating it as five equal tiles. Default keeps the tiled
  // grid used elsewhere.
  const wrapC = band
    ? 'flex flex-nowrap overflow-x-auto items-stretch divide-x divide-[color:var(--ux2-band-line)]'
    : 'flex flex-nowrap overflow-x-auto gap-px rounded-lg bg-gray-200 dark:bg-gray-700 border border-gray-200 dark:border-gray-700'

  const ws = data ?? null
  const price = spot ?? ws?.spot ?? null

  // ── Firm rating (consensus) vs. the reader's own ──────────────────────────
  const topRating = consensus && consensus.length > 0 ? consensus[0] : null
  const totalRaters = ratings?.length ?? 0
  const myDiffers =
    !!myRating && !!topRating && myRating.rating_value !== topRating.value

  // ── Target + implied upside (firm official target) ────────────────────────
  const target = ws?.target ?? null
  const upside = target != null && price != null && price > 0 ? (target - price) / price : null

  // ── Exposure, attributed to a specific book ───────────────────────────────
  const positions = ws?.positions ?? []
  const primary = primaryPosition(positions, null)
  const bookCount = positions.length

  // ── Open work ─────────────────────────────────────────────────────────────
  const openWork = ws?.liveIdeas?.length ?? 0
  const topIdea = ws?.liveIdeas?.[0] ?? null

  // ── Case freshness ────────────────────────────────────────────────────────
  const age = monthsSince(ws?.caseWrittenAt ?? null)
  const newSince = ws?.evidence?.filter(e => e.isNewSinceReview).length ?? 0
  const stale = age != null && age >= 6

  if (isLoading && !ws) {
    return (
      <div
        className={`${wrapC} ${className ?? ''}`}
        aria-hidden="true"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex-1 min-w-[132px] bg-white dark:bg-gray-800 px-3 py-2">
            <div className="h-2 w-12 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
            <div className="h-3.5 w-16 rounded bg-gray-100 dark:bg-gray-700 mt-2 animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      role="group"
      aria-label="Investment context"
      className={`${wrapC} ${className ?? ''}`}
    >
      {/* Firm rating */}
      <Cell label="Firm rating" onClick={onOpen ? () => onOpen('research') : undefined} title="Firm consensus rating" band={band} eyebrow={EYEBROW_C} dimmed={!topRating}>
        {topRating ? (
          <>
            <div className={VALUE_C + ' truncate'}>{topRating.value}</div>
            <div className={SUB_C}>
              {myDiffers
                ? <span className="text-primary-600 dark:text-primary-400 font-medium">You: {myRating!.rating_value}</span>
                : `${topRating.count} of ${totalRaters}`}
            </div>
          </>
        ) : (
          <>
            <div className={DASH_C}>—</div>
            <div className={SUB_C}>No rating yet</div>
          </>
        )}
      </Cell>

      {/* Price target + upside */}
      <Cell label="Price target" onClick={onOpen ? () => onOpen('research') : undefined} title="Firm price target" band={band} eyebrow={EYEBROW_C} dimmed={target == null}>
        {target != null ? (
          <>
            <div className={VALUE_C + ' tabular-nums flex items-baseline gap-1.5'}>
              {money(target)}
              {upside != null && (
                <span className={`text-[11px] font-semibold ${upside >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {signedPct(upside)}
                </span>
              )}
            </div>
            <div className={SUB_C}>firm target</div>
          </>
        ) : (
          <>
            <div className={DASH_C}>—</div>
            <div className={SUB_C}>No target yet</div>
          </>
        )}
      </Cell>

      {/* Exposure, attributed to a book */}
      <Cell label="Exposure" onClick={onOpen ? () => onOpen('decisions') : undefined} title="Our position" band={band} eyebrow={EYEBROW_C}>
        {primary && primary.weightPct != null ? (
          <>
            <div className={VALUE_C + ' tabular-nums'}>{primary.weightPct.toFixed(1)}%</div>
            <div className={SUB_C}>
              {primary.portfolioName}{bookCount > 1 ? ` · +${bookCount - 1} book${bookCount - 1 > 1 ? 's' : ''}` : ''}
            </div>
          </>
        ) : (
          <>
            <div className={VALUE_C + ' text-gray-500 dark:text-gray-400'}>Not held</div>
            <div className={SUB_C}>no book you can see</div>
          </>
        )}
      </Cell>

      {/* Open work */}
      <Cell label="Active work" onClick={onOpen ? () => onOpen('decisions') : undefined} title="Open ideas and decisions" band={band} eyebrow={EYEBROW_C}>
        {openWork > 0 ? (
          <>
            <div className={VALUE_C}>{openWork} open</div>
            <div className={SUB_C}>
              {[topIdea?.action, topIdea?.portfolioName].filter(Boolean).join(' · ') || 'in play'}
            </div>
          </>
        ) : (
          <>
            <div className={VALUE_C + ' text-gray-500 dark:text-gray-400'}>None open</div>
            <div className={SUB_C}>nothing waiting</div>
          </>
        )}
      </Cell>

      {/* Case freshness */}
      <Cell label="Case freshness" onClick={onOpen ? () => onOpen('research') : undefined} title="How current the investment case is" band={band} eyebrow={EYEBROW_C}>
        {age != null ? (
          <>
            <div className={VALUE_C + (stale ? ' text-amber-700 dark:text-amber-400' : '')}>
              {age === 0 ? 'This month' : `${age} mo old`}
            </div>
            {/* Evidence freshness is a SEPARATE fact from the case's age: an old
                case with no newer research is still old, never "up to date". */}
            <div className={SUB_C}>
              {newSince > 0 ? `${newSince} new item${newSince > 1 ? 's' : ''} since` : 'no new research since'}
            </div>
          </>
        ) : (
          <>
            <div className={DASH_C}>—</div>
            <div className={SUB_C}>No case yet</div>
          </>
        )}
      </Cell>
    </div>
  )
}
