import { Lightbulb, X } from 'lucide-react'
import { QuickThoughtDetailPanel } from '../ideas/QuickThoughtDetailPanel'
import { PromptDetailView } from '../thoughts/PromptDetailView'
import type { AttentionEntry } from '../../hooks/useDesktopAttentionFeed'

/**
 * The contextual workspace.
 *
 * ── The division of labour ────────────────────────────────────────────────
 *
 *   the tile     what happened, and why should I care
 *   this pane    what do I know about it, and what can I do now
 *
 * So the pane is not a bigger copy of the tile. The tile keeps its contextual
 * objects because they are what make it triageable at a glance; the pane
 * answers the next question.
 *
 * ── Routing is by CANDIDATE IDENTITY, not by a scan lookup ────────────────
 *
 * An earlier pass resolved selection by matching `card.entity.id` against
 * `useIdeaScan`'s rows, which only ever matched trade ideas — thoughts and
 * prompts were silently inert. Selection now carries the entry, whose `family`
 * came from the producer that made it, so every candidate knows what it is
 * without being looked up in a table that only holds one kind.
 *
 * ── Families with no work surface yet ─────────────────────────────────────
 *
 * A stale target, a target hit, a conviction gap, a crowding finding and a
 * scenario gap are not trade ideas and must not be coerced into one. Each
 * deserves its own analytical surface and none exists as an embeddable panel
 * today. They are REPORTED here rather than routed into a generic text panel,
 * which is the same rule as the Explore producer gaps: name what is missing,
 * do not substitute something that looks similar.
 */
export function IdeasWorkPane({
  entry, onClose,
}: {
  entry: AttentionEntry | null
  onClose: () => void
}) {
  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        {/* Quiet. Half a screen of empty chrome, or a second dashboard invented
            to fill it, would both be worse than one line saying what to do. */}
        <div className="max-w-xs text-center">
          <Lightbulb className="mx-auto h-5 w-5 text-gray-300 dark:text-gray-600" />
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Select an item to work on it
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            The feed keeps its place while you do.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-5 py-3 dark:border-gray-700">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {entry.card.entity?.ticker ?? entry.card.surface}
          </p>
          <h2 className="truncate text-sm font-semibold text-gray-900 dark:text-white">
            {entry.card.headline}
          </h2>
        </div>
        <button
          onClick={onClose}
          aria-label="Close workspace"
          className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkSurface entry={entry} onClose={onClose} />
      </div>
    </div>
  )
}

function WorkSurface({ entry, onClose }: { entry: AttentionEntry; onClose: () => void }) {
  /*
   * Posts route by their own feed type. Every surface below already exists and
   * is already embeddable elsewhere in the product — this is routing, not a
   * new set of work surfaces.
   */
  if (entry.family === 'post' && entry.item) {
    const type = entry.item.type
    const isPrompt = type === 'quick_thought' &&
      ((entry.item as unknown as { idea_type?: string }).idea_type === 'prompt')

    if (isPrompt) return <PromptDetailView promptId={entry.item.id} onClose={onClose} />
    if (type === 'quick_thought' || type === 'note') {
      return <QuickThoughtDetailPanel quickThoughtId={entry.item.id} onClose={onClose} embedded />
    }
    /*
     * A trade idea's rich investment workspace — thesis, framework, exposure,
     * targets, price, maturity — is the one surface that is NOT embeddable
     * today: `IdeaDetail` takes the Dashboard's `IdeaRow` plus three enrichment
     * hooks, and mounting it here would either pull in the Dashboard's focus
     * seam or duplicate its data layer. Both were ruled out. Reported rather
     * than faked.
     */
    return (
      <NotYet
        what="This trade idea's investment workspace"
        why="Its thesis, framework, exposure and target surfaces are built around the Dashboard's Idea object and are not embeddable yet."
      />
    )
  }

  return (
    <NotYet
      what={`A work surface for ${FAMILY_LABEL[entry.family] ?? entry.family}`}
      why="This is a machine-derived finding, not a trade idea. It deserves its own analytical surface rather than being shown in one built for something else."
    />
  )
}

const FAMILY_LABEL: Record<string, string> = {
  stale_target: 'a stale target',
  target_hit: 'a target hit',
  conviction: 'a conviction gap',
  crowding: 'a crowded name',
  scenario_gap: 'a case-versus-price gap',
}

function NotYet({ what, why }: { what: string; why: string }) {
  return (
    <div className="px-5 py-6">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{what} is not wired up yet.</p>
      <p className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{why}</p>
    </div>
  )
}
