import { Lightbulb, X } from 'lucide-react'
import { QuickThoughtDetailPanel } from '../ideas/QuickThoughtDetailPanel'
import { PromptDetailView } from '../thoughts/PromptDetailView'
import { IdeaDetail } from '../ideas-v2/IdeaDetail'
import { AssetWorkspacePane } from '../asset-v2/AssetWorkspace'
import { useTradeIdeaWorkspace } from '../../hooks/useTradeIdeaWorkspace'
import { assetFocusFor, type IdeasSelection } from '../../lib/desktop-ideas/selection'
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
  selection, entry, onClose,
}: {
  /** Stable identity. Survives the feed reranking underneath. */
  selection: IdeasSelection | null
  /** Presentation only, for the header. May be stale; never routed on. */
  entry: AttentionEntry | null
  onClose: () => void
}) {
  if (!selection) {
    return (
      <div className="relative flex h-full items-center justify-center px-8">
        {/* The empty region is still a region, and it still has to be
            dismissible — it is now reachable by clearing a selection, not only
            before one is made, so the collapse control cannot live in the
            header that only a selected item renders. */}
        <button
          onClick={onClose}
          aria-label="Close workspace"
          className="absolute right-3 top-3 rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <X className="h-4 w-4" />
        </button>
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
      {/*
        Why you are here, carried from the candidate.

        Deterministic — the headline and reason the builder already computed.
        Nothing is regenerated, and no model is asked for a fact the finding
        knows. This is what makes the surface below feel entered FROM an
        attention event rather than dropped into cold.
      */}
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-5 py-3 dark:border-gray-700">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {selection.symbol ?? entry?.card.surface}
          </p>
          <h2 className="truncate text-sm font-semibold text-gray-900 dark:text-white">
            {selection.why.headline}
          </h2>
          {selection.why.reason && (
            <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-gray-400">
              {selection.why.reason}
            </p>
          )}
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
        <WorkSurface selection={selection} onClose={onClose} />
      </div>
    </div>
  )
}

function WorkSurface({ selection, onClose }: { selection: IdeasSelection; onClose: () => void }) {
  /*
   * Posts route by their own feed type. Every surface below already exists and
   * is already used elsewhere — this is routing, not new work surfaces.
   */
  if (selection.family === 'post') {
    if (selection.postType === 'prompt') {
      return <PromptDetailView promptId={selection.objectId!} onClose={onClose} />
    }
    if (selection.postType === 'thought') {
      return <QuickThoughtDetailPanel quickThoughtId={selection.objectId} onClose={onClose} embedded />
    }
    if (selection.postType === 'trade_idea') return <TradeIdeaSurface selection={selection} />
    return (
      <NotYet
        what={`A work surface for a ${selection.postType ?? 'post'}`}
        why="This post family has no dedicated work surface yet."
      />
    )
  }

  /*
   * Every machine-derived family here is an ASSET-level finding, and the
   * finding is the reason the reader arrived rather than the thing they work
   * on. So the workspace opens the underlying asset, focused on the part the
   * finding is about — a target argument lands on research, a sizing argument
   * on the position, a case-versus-price gap on the framework.
   *
   * `AssetWorkspacePane` already takes an `issue`, which is how the attention
   * event travels in with the reader. `openAsset` was rejected: it dispatches
   * a tab and would eject them from Ideas entirely, which is the flow this
   * application exists to replace.
   */
  if (selection.assetId) {
    return (
      <AssetWorkspacePane
        asset={{ id: selection.assetId, symbol: selection.symbol }}
        focus={assetFocusFor(selection.family)}
        portfolioId={selection.portfolioId}
        portfolioName={selection.portfolioName}
        issue={selection.why.headline}
        origin="ideas"
      />
    )
  }

  return (
    <NotYet
      what={`A work surface for ${FAMILY_LABEL[selection.family] ?? selection.family}`}
      why="This finding does not name an asset, so there is no underlying object to open. Its attention tile is still useful; the work surface is not."
    />
  )
}

function TradeIdeaSurface({ selection }: { selection: IdeasSelection }) {
  const { idea, detail, exposure } = useTradeIdeaWorkspace(selection.item ?? null)
  if (!idea) {
    return <NotYet what="This trade idea" why="Its underlying row is no longer in the loaded feed." />
  }
  return (
    <IdeaDetail
      idea={idea}
      detail={detail}
      exposure={exposure}
      /* The attention event, preserved in the surface's own vocabulary. */
      arrivedFor={selection.why.headline}
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
