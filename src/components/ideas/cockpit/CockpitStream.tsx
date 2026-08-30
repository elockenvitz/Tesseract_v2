/**
 * The ranked stream, with two bands and no silos.
 *
 * ── Why two bands and not five sections ───────────────────────────────────
 *
 * The tempting layout is Attention / Your Scope / Portfolio / Discovery /
 * Recent. It reads well as a wireframe and it breaks the ranking: the moment a
 * row's section is decided by WHAT it is rather than HOW IMPORTANT it is, a
 * critical scope card and a routine one sit in the same box, and a genuinely
 * urgent unscoped item is filed under "Discovery" where nobody looks. Three
 * phases of work went into one canonical order; sectioning by attribute throws
 * it away and calls it information architecture.
 *
 * So there is exactly one ranked stream, split once, on the ranker's own
 * `tier` — the semantic partition the model already makes and already sorts by.
 * Tiers 0 and 1 are the two that describe a position: the price has left the
 * framework, or the framework is missing. Everything else is a look, a task or
 * a story. That line is `LEAD_TIER`, and it is the same line mobile draws for
 * the same reason.
 *
 * A thesis update and a signal therefore compete on importance. They can sit
 * next to each other in ATTENTION, or the thesis update can lead the stream
 * while the signal does not — which is the point of ranking them together.
 *
 * ── When the split disappears ─────────────────────────────────────────────
 *
 * If nothing is in the lead tier there is no ATTENTION band. An empty section
 * header is a promise the surface did not keep, and a reader who sees
 * "Attention" over nothing learns the heading means nothing.
 */

import { clsx } from 'clsx'
import { IdeaRow, type IdeaRowModel } from './IdeaRow'

/** The tier at or below which a row leads the stream. Mirrors `LEAD_TIER`. */
export const COCKPIT_LEAD_TIER = 1

export interface CockpitStreamProps {
  items: readonly IdeaRowModel[]
  onOpen?: (id: string) => void
  onSnooze?: (id: string) => void
  onDismiss?: (id: string) => void
  selectedId?: string | null
  /** Rendered under the stream — the infinite-scroll sentinel, a spinner. */
  footer?: React.ReactNode
}

function BandHeader({ title, count, hint }: { title: string; count: number; hint?: string }) {
  return (
    <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-gray-200 bg-gray-50/95 px-3 py-1 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-600 dark:text-gray-300">
        {title}
      </span>
      <span className="text-[10.5px] tabular-nums text-gray-400 dark:text-gray-500">{count}</span>
      {hint && (
        <span className="truncate text-[10.5px] text-gray-400 dark:text-gray-500">{hint}</span>
      )}
    </div>
  )
}

export function CockpitStream({
  items, onOpen, onSnooze, onDismiss, selectedId, footer,
}: CockpitStreamProps) {
  // Partitioned, never re-sorted. The canonical order inside each band is the
  // order the ranker produced; a band that re-sorted would be a second ranker.
  const attention = items.filter(i => i.tier <= COCKPIT_LEAD_TIER)
  const stream = items.filter(i => i.tier > COCKPIT_LEAD_TIER)

  const rows = (list: readonly IdeaRowModel[]) => list.map(model => (
    <IdeaRow
      key={model.id}
      model={model}
      onOpen={onOpen}
      onSnooze={onSnooze}
      onDismiss={onDismiss}
      selected={selectedId === model.id}
    />
  ))

  return (
    <div data-testid="cockpit-stream" className={clsx('bg-white dark:bg-gray-900')}>
      {attention.length > 0 && (
        <section data-testid="band-attention">
          <BandHeader
            title="Attention"
            count={attention.length}
            hint="a position has left its framework, or has none"
          />
          {rows(attention)}
        </section>
      )}

      {stream.length > 0 && (
        <section data-testid="band-stream">
          {/* Only labelled when there is something above it to distinguish it
              from. On a feed with no lead-tier rows this is just the feed. */}
          {attention.length > 0 && <BandHeader title="Next" count={stream.length} />}
          {rows(stream)}
        </section>
      )}

      {footer}
    </div>
  )
}
