import { clsx } from 'clsx'

export interface PeerActiveWeight {
  symbol: string
  /** Portfolio weight, percent. */
  weightPct: number
  /** Benchmark weight, percent. */
  benchmarkPct: number
  /** weightPct - benchmarkPct. */
  activePct: number
}

interface ActiveWeightPeersProps {
  /** The name this card is about, highlighted in the ranking. */
  subject: string
  /** Held names, ranked by absolute active weight. */
  peers: PeerActiveWeight[]
  /** Index constituents the portfolio does not hold at all. */
  notHeldCount: number
  /** Their combined active weight, always negative. */
  notHeldActivePct: number
  /** Total held names, so truncation is visible. */
  heldCount: number
  /** Detail mode: show every peer supplied rather than the top five. */
  full?: boolean
}

/**
 * The portfolio's largest active bets, ranked.
 *
 * Active risk was measured as a single row and found thin: 486px of dead space,
 * 58% of a 390px viewport. The claim was never weak — a 4.4% underweight in the
 * index's largest constituent is a real position — it was *uncomparable*. One
 * active weight in isolation says nothing about whether it is the portfolio's
 * biggest bet or its fifth.
 *
 * ── Two things this pane refuses to conflate ──────────────────────────────
 *
 * Direction is preserved. Ranking by absolute size puts the largest bets first,
 * which is right, but rendering them as bare magnitudes would merge two
 * opposite decisions. An underweight is a decision to own less of something the
 * index owns; an overweight is a decision to fund that from somewhere. They get
 * opposite colours and signed numbers.
 *
 * "Does not hold" is not a decision. US Core Equity holds 69 names against
 * SPY's 504. The other 435 contribute -41.09% of active weight between them —
 * almost exactly cancelling the +41.12% across held names, as it must — but
 * that is one decision (run a concentrated book), not 435. Listing them by size
 * would fill the pane with names nobody chose to underweight. They are reported
 * as a single line, with their count and their combined weight, so the number
 * is visible without pretending to be a ranking.
 */
/**
 * As many rows as a detail region can show at 390x844 with room to spare.
 *
 * Measured twice, and the second measurement is the instructive one. Eight rows
 * put the last one 23px under the action bar locally. Six cleared it locally by
 * 20px — and still failed on CI by 28px, because row height is a function of
 * the platform's fonts: 15px on this machine, closer to 20px on the Linux
 * runner, so six rows are roughly 30px taller there than here.
 *
 * The lesson is not "six was one too many". It is that a row count tuned to the
 * remaining margin on one machine is not a bound at all. Four leaves ~60px
 * locally, which absorbs that difference and any comparable one, and the stated
 * remainder means nothing is hidden — only deferred to the asset page.
 */
const MAX_FULL_PEERS = 4

export function ActiveWeightPeers({
  subject, peers, notHeldCount, notHeldActivePct, heldCount, full,
}: ActiveWeightPeersProps & { full?: boolean }) {
  if (!peers.length) return null
  /**
   * Bounded even in `full` mode, because a pane is a box now.
   *
   * `full` used to mean "every peer", and every peer was 313px of rows inside a
   * 177px pane. The overflow was invisible rather than scrollable — the card
   * owns no vertical gesture — so six of them simply rendered under the action
   * bar. A stated remainder is honest; a silently truncated list is not.
   */
  const cap = full ? MAX_FULL_PEERS : 5
  const shown = peers.slice(0, cap)
  const hidden = peers.length - shown.length
  const max = Math.max(...shown.map(p => Math.abs(p.activePct)), 0.01)

  return (
    <div className={clsx('flex flex-col overflow-hidden', full ? '' : 'min-h-[92px] flex-1')} data-testid="active-weight-peers">
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 overflow-hidden">
        {shown.map(p => {
          const over = p.activePct >= 0
          const frac = Math.abs(p.activePct) / max
          const isSubject = p.symbol === subject
          return (
            <div key={p.symbol} className="flex items-center gap-2" data-testid="peer-row">
              <span className={clsx(
                'w-[46px] shrink-0 truncate text-[10px] font-bold uppercase tracking-wide',
                isSubject ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400',
              )}>
                {p.symbol}
              </span>
              {/* Centre line: overweights extend right, underweights left. The
                  axis is the benchmark, which is what "active" means. */}
              <div className="relative h-[10px] flex-1 min-w-0">
                <div className="absolute inset-y-0 left-1/2 w-px bg-gray-200 dark:bg-gray-700" />
                <div
                  className={clsx(
                    'absolute inset-y-0 rounded-full',
                    over ? 'bg-emerald-500/70' : 'bg-rose-500/70',
                    isSubject && 'ring-1 ring-gray-900 dark:ring-white',
                  )}
                  style={
                    over
                      ? { left: '50%', width: `${Math.max(frac * 50, 2)}%` }
                      : { right: '50%', width: `${Math.max(frac * 50, 2)}%` }
                  }
                />
              </div>
              <span className={clsx(
                'w-[46px] shrink-0 text-right text-[10px] font-bold tabular-nums',
                over ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
              )}>
                {over ? '+' : ''}{p.activePct.toFixed(2)}%
              </span>
            </div>
          )
        })}

        {/* Truncation and the not-held line, both stated. Neither is allowed to
            be inferred from an absence. */}
        <div className="mt-1 flex shrink-0 flex-wrap items-center gap-x-2 text-[10px] font-semibold text-gray-400">
          {heldCount > shown.length && <span>{heldCount - shown.length} more held</span>}
          <span data-testid="not-held-line" className="text-gray-500 dark:text-gray-400">
            {notHeldCount} index names not held · {notHeldActivePct.toFixed(1)}% combined
          </span>
        </div>
        {hidden > 0 && (
          <p className="shrink-0 text-[10px] font-medium text-gray-400" data-testid="peers-truncated">
            +{hidden} more held name{hidden === 1 ? '' : 's'}
          </p>
        )}
      </div>
    </div>
  )
}
