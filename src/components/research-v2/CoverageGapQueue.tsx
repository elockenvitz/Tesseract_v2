/**
 * Research's queue over the reader's coverage research gaps.
 *
 * One summary line for the size of the gap, then the top names to start on,
 * grouped by what each needs, each with one action into that asset's existing
 * Research view. "View all" mounts the rest as the same compact rows -- never a
 * gallery of identical cards. Responsive: rows stack at phone width.
 */

import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { clsx } from 'clsx'
import type { CoverageResearchCandidate } from '../../lib/research/coverage-research-gaps'
import {
  buildGapQueue, gapContext, gapDetail, GAP_ACTION, GAP_QUEUE_LIMIT,
} from '../../lib/research/coverage-gap-queue'
import { openAsset } from '../../lib/desktop-asset'

export function CoverageGapQueue({
  candidates,
  /** Research above it already; the queue then reads as a section, not the page. */
  secondary = false,
}: {
  candidates: readonly CoverageResearchCandidate[]
  secondary?: boolean
}) {
  const [showAll, setShowAll] = useState(false)
  if (!candidates.length) return null
  const queue = buildGapQueue(candidates, { showAll })
  const mixed = queue.counts.length > 1

  return (
    <section
      data-testid="coverage-gap-queue"
      aria-label="Your coverage"
      className={clsx('px-4 sm:px-6', secondary ? 'pb-10 pt-2' : 'pb-10 pt-5')}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {secondary
          ? <h2 className="text-[15px] font-semibold tracking-tight">Your coverage</h2>
          : <h1 className="text-[19px] font-semibold tracking-tight">Research</h1>}
      </div>
      <p data-testid="coverage-gap-summary" className="mt-1 text-[14px] font-medium text-gray-900 dark:text-gray-100">
        {queue.summary}
      </p>
      {mixed && (
        <p data-testid="coverage-gap-counts" className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">
          {queue.counts.map(c => `${c.count} ${c.label.toLowerCase()}`).join(' · ')}
        </p>
      )}
      {!showAll && queue.hidden > 0 && (
        <p className="mt-0.5 text-[12px] text-gray-500">Start with these {GAP_QUEUE_LIMIT}.</p>
      )}

      <div className="mt-4 max-w-[980px] space-y-4">
        {queue.groups.map(group => (
          <div key={group.framing} data-testid="coverage-gap-group" data-framing={group.framing}>
            {/* One kind of gap: the summary already named it and counted it. */}
            {mixed && (
              <div className="mb-1.5 flex items-baseline gap-2 text-[10px] font-medium uppercase tracking-[0.08em] text-amber-700 dark:text-amber-500">
                <span>{group.label}</span>
                <span className="font-mono normal-case tracking-normal text-gray-500">{group.total}</span>
              </div>
            )}
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white dark:divide-white/[0.06] dark:border-white/[0.08] dark:bg-[#141a25]">
              {group.rows.map(c => <GapRow key={c.id} candidate={c} />)}
            </ul>
          </div>
        ))}
      </div>

      {queue.hidden > 0 && (
        <button
          type="button"
          data-testid="coverage-gap-view-all"
          onClick={() => setShowAll(true)}
          className="mt-3 inline-flex items-center rounded-md px-2 py-1 text-[12px] font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
        >
          View all {queue.total}
        </button>
      )}
      {showAll && queue.total > GAP_QUEUE_LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-3 inline-flex items-center rounded-md px-2 py-1 text-[12px] font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
        >
          Show top {GAP_QUEUE_LIMIT}
        </button>
      )}
    </section>
  )
}

function GapRow({ candidate: c }: { candidate: CoverageResearchCandidate }) {
  const context = gapContext(c)
  return (
    <li
      data-testid="coverage-gap-row"
      data-asset={c.assetId}
      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="min-w-0 sm:w-[220px] sm:shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[14px] font-semibold text-gray-900 dark:text-gray-100">{c.symbol}</span>
          {c.coverage === 'assigned' && (
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-gray-500">Assigned</span>
          )}
        </div>
        {c.companyName && <div className="truncate text-[12px] text-gray-600 dark:text-gray-400">{c.companyName}</div>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-gray-800 dark:text-gray-200">{gapDetail(c)}</div>
        {context && <div className="text-[12px] text-gray-500">{context}</div>}
      </div>
      <button
        type="button"
        data-testid="coverage-gap-action"
        onClick={() => openAsset(c.open)}
        className="inline-flex shrink-0 items-center gap-1 self-start rounded-md border border-gray-200 px-2.5 py-1.5 text-[12px] font-semibold text-gray-800 hover:bg-gray-50 sm:self-auto dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/[0.06]"
      >
        {GAP_ACTION[c.framing]}
        <ArrowUpRight className="h-3 w-3" />
      </button>
    </li>
  )
}
