import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { longestRun, type ComposeTraceRow } from '../../lib/signals/feed-compose'
import type { ComposeScope } from '../../lib/signals/feed-compose'

/**
 * Why every card is where it is, and what the ordering pass cost to put it
 * there.
 *
 * ── Why this is not optional ──────────────────────────────────────────────
 *
 * The feed has now shipped an ordering pass whose effect nobody could see.
 * `diversify` ran, worked, and was thrown away by the tier split on the next
 * line — for as long as the function has existed — and it took a
 * reconstruction of the pipeline outside React to notice, because the only
 * place the ORDER was observable was a phone screen behind a login.
 *
 * The fix for that is not more careful reading. It is that the sequence has to
 * be able to explain itself: what ranked where, what moved, what it cost, and
 * how long the worst run is. Every number here is one `composeFeed` actually
 * read.
 *
 * ── Gating ────────────────────────────────────────────────────────────────
 *
 * `import.meta.env.DEV` AND `?feedrank=1` — the convention
 * `OverflowAuditOverlay` established, `ChartGeometryOverlay` reused and
 * `FeedFunnelOverlay` reused again. The build gate means it cannot exist in
 * production; the URL flag is what makes it readable from a phone.
 *
 * Scrollable and pointer-enabled, unlike the funnel: this is a list of up to
 * forty rows, and a diagnostic you cannot scroll answers only the first
 * question you have.
 */

export interface FeedRankTrace {
  scope: ComposeScope
  /** One row per composed card, in composed order. */
  rows: ComposeTraceRow[]
  /** The ranking as it stood BEFORE the ordering pass. */
  rankedOrder: {
    rank: number
    id: string
    family: string | null
    category: string | null
    subject: string | null
    tier: number
    total: number
  }[]
}

/** How many rows to render. Enough to read the opening and the first turn. */
const SHOWN = 40

export function FeedRankOverlay({ trace }: { trace: FeedRankTrace | null }) {
  const [on, setOn] = useState(false)

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return
    setOn(new URLSearchParams(window.location.search).get('feedrank') === '1')
  }, [])

  if (!import.meta.env.DEV || !on || !trace) return null

  const { rows, rankedOrder, scope } = trace

  /**
   * The two metrics the whole pass exists to move, measured the same way the
   * tests measure them.
   */
  const beforeFamily = longestRun(rankedOrder, r => r.family)
  const afterFamily = longestRun(rows, r => r.family)
  const beforeSubject = longestRun(rankedOrder, r => r.subject)
  const afterSubject = longestRun(rows, r => r.subject)

  const moved = rows.filter(r => Math.abs(r.rankAfter - r.rankBefore) > 3).length
  const costs = rows.map(r => -r.priorityCost).filter(c => c > 0).sort((a, b) => a - b)
  const worstCost = costs.length ? costs[costs.length - 1] : 0
  const medianCost = costs.length ? costs[Math.floor(costs.length / 2)] : 0

  const Head = ({ children }: { children: React.ReactNode }) => (
    <div className="mb-1 border-b border-white/25 pb-1 text-[10px] font-bold">{children}</div>
  )

  return createPortal(
    <div className="fixed inset-0 z-[9999] overflow-y-auto bg-black/90 px-2 py-2 text-[9px] font-medium text-white"
      style={{ fontVariantNumeric: 'tabular-nums' }}
      data-slot="feed-rank-overlay"
    >
      <Head>
        feed rank · scope {scope} · {rows.length} cards
      </Head>

      <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
        <span className="opacity-70">longest family run</span>
        <span className="font-bold">{beforeFamily} → {afterFamily}</span>
        <span className="opacity-70">longest asset run</span>
        <span className="font-bold">{beforeSubject} → {afterSubject}</span>
        <span className="opacity-70">moved &gt; 3 places</span>
        <span className="font-bold">{moved}</span>
        <span className="opacity-70">largest priority drop</span>
        <span className="font-bold">{worstCost.toFixed(3)}</span>
        <span className="opacity-70">median priority drop</span>
        <span className="font-bold">{medianCost.toFixed(3)}</span>
      </div>

      <Head>first {Math.min(SHOWN, rows.length)} composed</Head>
      <div className="mb-2" data-slot="rank-rows">
        {rows.slice(0, SHOWN).map(r => (
          <div key={r.id} className="flex gap-1.5 leading-[1.35]" data-slot="rank-row">
            <span className="w-[46px] shrink-0 opacity-70">
              {r.rankBefore}→{r.rankAfter}
            </span>
            <span className="w-[42px] shrink-0 truncate">{r.subject ?? '—'}</span>
            <span className="w-[104px] shrink-0 truncate">{r.family ?? '—'}</span>
            <span className="w-[16px] shrink-0 opacity-70">t{r.tier}</span>
            <span className="w-[34px] shrink-0">{r.total.toFixed(2)}</span>
            <span className="w-[38px] shrink-0 opacity-70">
              {r.priorityCost ? r.priorityCost.toFixed(2) : '—'}
            </span>
            <span className="min-w-0 flex-1 truncate opacity-80">
              {r.reason}
              {r.reason !== 'head' ? ` (${r.competitors} alt)` : ''}
            </span>
          </div>
        ))}
      </div>

      {/* The components behind the score, for the top of the feed only. The
          question this answers is the other half of "why is this here": the
          rows above say what MOVED it, and these say what ranked it. */}
      <Head>components · top 8</Head>
      <div>
        {rows.slice(0, 8).map(r => (
          <div key={`c-${r.id}`} className="leading-[1.35]">
            <span className="opacity-70">{r.subject ?? '—'} </span>
            {Object.entries(r.components)
              .filter(([, v]) => v !== 0)
              .map(([k, v]) => `${k.slice(0, 4)} ${v >= 0 ? '+' : ''}${v.toFixed(2)}`)
              .join(' ')}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )
}
